import crypto from 'node:crypto';
import { pool, withTransaction, audit } from '../db.js';
import { getGame } from '../games/index.js';
import { GameRuleError } from '../games/common.js';
import { rewardPvpResult, rewardPvpResultForHuman, evaluateAchievements } from './rewards.js';
import { AI_PLAYER_ID, isAiPlayer, computeAiMove } from './ai.js';

function httpError(status,message,code='ERROR'){const e=new Error(message);e.status=status;e.code=code;return e;}
const userPublic=(row,prefix)=>({id:row[`${prefix}_id`],name:row[`${prefix}_name`],avatarUrl:row[`${prefix}_avatar`],officeId:row[`${prefix}_office_id`],officeName:row[`${prefix}_office_name`]});

export async function createMatch(client,gameKey,player1Id,player2Id){
  if(player1Id===player2Id)throw httpError(400,'Không thể tự đấu với chính mình');
  const game=getGame(gameKey); const state=game.create();
  const [p1,p2]=crypto.randomInt(2)===0?[player1Id,player2Id]:[player2Id,player1Id];
  const id=crypto.randomUUID();
  await client.query('INSERT INTO matches(id,game_key,player1_id,player2_id,state) VALUES($1,$2,$3,$4,$5)',[id,gameKey,p1,p2,JSON.stringify(state)]);
  return id;
}

export async function createAiMatch(userId,gameKey){
  const game=getGame(gameKey);
  // Check game enabled
  const {rows:cfgRows}=await pool.query('SELECT enabled FROM game_configs WHERE game_key=$1',[gameKey]);
  if(!cfgRows[0]?.enabled)throw httpError(423,'Game đang được admin ẩn','GAME_DISABLED');
  // Check no active match for user
  const {rowCount:activeCount}=await pool.query(`SELECT id FROM matches WHERE status='active' AND (player1_id=$1 OR player2_id=$1)`,[userId]);
  if(activeCount)throw httpError(409,'Bạn đang có trận đang đấu','ACTIVE_MATCH');
  // Verify AI player exists
  const {rowCount:aiExists}=await pool.query('SELECT id FROM users WHERE id=$1',[AI_PLAYER_ID]);
  if(!aiExists)throw httpError(500,'AI player not configured','AI_NOT_CONFIGURED');
  // Random position assignment
  const [p1,p2]=crypto.randomInt(2)===0?[userId,AI_PLAYER_ID]:[AI_PLAYER_ID,userId];

  const matchId=await withTransaction(async(client)=>{
    const state=game.create();
    const id=crypto.randomUUID();
    await client.query('INSERT INTO matches(id,game_key,player1_id,player2_id,state,is_ai) VALUES($1,$2,$3,$4,$5,1)',[id,gameKey,p1,p2,JSON.stringify(state)]);

    // If AI goes first, compute opening move
    const aiIndex=p1===AI_PLAYER_ID?0:1;
    if(state.turn===aiIndex){
      const aiResult=await computeAiMove(state,gameKey,aiIndex);
      if(aiResult.action){
        await client.query('UPDATE matches SET state=$2,version=1 WHERE id=$1',[id,JSON.stringify(aiResult.state)]);
        await client.query('INSERT INTO match_events(match_id,version,actor_id,client_action_id,action_type,action) VALUES($1,1,$2,$3,$4,$5)',[id,AI_PLAYER_ID,`ai-open-${id}`,'move',JSON.stringify(aiResult.action)]);
      }
    }
    return id;
  });
  return matchId;
}

export function isAiMatch(matchRow){return Boolean(matchRow.is_ai);}

export async function getMatchForUser(matchId,userId){
  const {rows}=await pool.query(`
    SELECT m.*,
      p1.id p1_id,p1.display_name p1_name,p1.avatar_url p1_avatar,p1.office_group_id p1_office_id,o1.name p1_office_name,
      p2.id p2_id,p2.display_name p2_name,p2.avatar_url p2_avatar,p2.office_group_id p2_office_id,o2.name p2_office_name
    FROM matches m
    JOIN users p1 ON p1.id=m.player1_id LEFT JOIN office_groups o1 ON o1.id=p1.office_group_id
    JOIN users p2 ON p2.id=m.player2_id LEFT JOIN office_groups o2 ON o2.id=p2.office_group_id
    WHERE m.id=$1 AND ($2=m.player1_id OR $2=m.player2_id)
  `,[matchId,userId]);
  if(!rows[0])throw httpError(404,'Không tìm thấy trận','MATCH_NOT_FOUND');
  return viewMatch(rows[0],userId);
}

export function viewMatch(row,userId){
  const playerIndex=row.player1_id===userId?0:row.player2_id===userId?1:-1;
  if(playerIndex<0)throw httpError(403,'Bạn không thuộc trận này','NOT_MATCH_PLAYER');
  const game=getGame(row.game_key);
  return {
    id:row.id,gameKey:row.game_key,gameName:game.name,version:row.version,status:row.status,
    winnerId:row.winner_id,playerIndex,turn:row.state?.turn??null,
    players:[userPublic(row,'p1'),userPublic(row,'p2')],
    state:game.view(row.state,playerIndex),createdAt:row.created_at,finishedAt:row.finished_at
  };
}

async function updateRatings(client,row,winnerIndex){
  const ids=[row.player1_id,row.player2_id];
  await client.query('INSERT IGNORE INTO ratings(user_id,game_key) VALUES($1,$3),($2,$3)',[ids[0],ids[1],row.game_key]);
  const locked=await client.query('SELECT * FROM ratings WHERE user_id IN ($1,$2) AND game_key=$3 ORDER BY user_id FOR UPDATE',[ids[0],ids[1],row.game_key]);
  const map=new Map(locked.rows.map(r=>[r.user_id,r]));const a=map.get(ids[0]),b=map.get(ids[1]);
  const expectedA=1/(1+10**((b.rating-a.rating)/400)), expectedB=1-expectedA;
  const scoreA=winnerIndex==null?0.5:winnerIndex===0?1:0,scoreB=1-scoreA,K=32;
  const ra=Math.round(a.rating+K*(scoreA-expectedA)),rb=Math.round(b.rating+K*(scoreB-expectedB));
  const stats=(idx)=>winnerIndex==null?[0,0,1]:winnerIndex===idx?[1,0,0]:[0,1,0];
  for(const [idx,rating] of [[0,ra],[1,rb]]){const [w,l,d]=stats(idx);await client.query(`UPDATE ratings SET rating=$3,played=played+1,wins=wins+$4,losses=losses+$5,draws=draws+$6,updated_at=UTC_TIMESTAMP() WHERE user_id=$1 AND game_key=$2`,[ids[idx],row.game_key,rating,w,l,d]);}
}

export async function applyMatchAction({matchId,userId,clientActionId,expectedVersion,action}){
  if(typeof clientActionId!=='string'||clientActionId.length<8||clientActionId.length>80)throw httpError(400,'clientActionId không hợp lệ','BAD_ACTION_ID');
  if(!Number.isInteger(expectedVersion)||expectedVersion<0)throw httpError(400,'expectedVersion không hợp lệ','BAD_VERSION');
  if(!action||typeof action!=='object'||Array.isArray(action))throw httpError(400,'Action không hợp lệ','BAD_ACTION');
  let finished=false;
  const matchIdOut=await withTransaction(async(client)=>{
    const {rows}=await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[matchId]);const row=rows[0];
    if(!row)throw httpError(404,'Không tìm thấy trận','MATCH_NOT_FOUND');
    const playerIndex=row.player1_id===userId?0:row.player2_id===userId?1:-1;if(playerIndex<0)throw httpError(403,'Bạn không thuộc trận','NOT_MATCH_PLAYER');
    const duplicate=await client.query('SELECT 1 FROM match_events WHERE match_id=$1 AND actor_id=$2 AND client_action_id=$3',[matchId,userId,clientActionId]);
    if(duplicate.rowCount)return matchId;
    if(row.status!=='active')throw httpError(409,'Trận đã kết thúc','MATCH_FINISHED');
    if(row.version!==expectedVersion)throw httpError(409,'State của bạn đã cũ','STALE_VERSION');

    // --- Surrender branch ---
    if(action.type==='surrender'){
      const opponentId=playerIndex===0?row.player2_id:row.player1_id;
      const nextVersion=row.version+1;
      await client.query(`UPDATE matches SET status='finished',winner_id=$2,version=$3,finished_at=UTC_TIMESTAMP() WHERE id=$1`,[matchId,opponentId,nextVersion]);
      await client.query('INSERT INTO match_events(match_id,version,actor_id,client_action_id,action_type,action) VALUES($1,$2,$3,$4,$5,$6)',[matchId,nextVersion,userId,clientActionId,'surrender',JSON.stringify(action)]);
      if(!row.is_ai){
        await updateRatings(client,row,playerIndex===0?1:0);
      }
      finished=true;
      return matchId;
    }

    // --- Draw offer branch (PvP only, not AI) ---
    if(action.type==='draw_offer'){
      if(row.is_ai)throw httpError(400,'Không thể cầu hòa với AI','DRAW_NOT_ALLOWED');
      const nextVersion=row.version+1;
      const newState=typeof row.state==='object'?{...row.state,drawOffer:playerIndex}:row.state;
      await client.query(`UPDATE matches SET state=$2,version=$3 WHERE id=$1`,[matchId,JSON.stringify(newState),nextVersion]);
      await client.query('INSERT INTO match_events(match_id,version,actor_id,client_action_id,action_type,action) VALUES($1,$2,$3,$4,$5,$6)',[matchId,nextVersion,userId,clientActionId,'draw_offer',JSON.stringify(action)]);
      return matchId;
    }

    // --- Draw accept branch ---
    if(action.type==='draw_accept'){
      if(row.is_ai)throw httpError(400,'Không thể cầu hòa với AI','DRAW_NOT_ALLOWED');
      const gameState=typeof row.state==='object'?row.state:{};
      if(gameState.drawOffer==null||gameState.drawOffer===playerIndex)throw httpError(400,'Không có lời cầu hòa','NO_DRAW_OFFER');
      const nextVersion=row.version+1;
      await client.query(`UPDATE matches SET status='finished',winner_id=NULL,version=$2,finished_at=UTC_TIMESTAMP() WHERE id=$1`,[matchId,nextVersion]);
      await client.query('INSERT INTO match_events(match_id,version,actor_id,client_action_id,action_type,action) VALUES($1,$2,$3,$4,$5,$6)',[matchId,nextVersion,userId,clientActionId,'draw_accept',JSON.stringify(action)]);
      await updateRatings(client,row,null);
      finished=true;
      return matchId;
    }

    // --- Draw decline branch ---
    if(action.type==='draw_decline'){
      const gameState=typeof row.state==='object'?row.state:{};
      if(gameState.drawOffer==null)throw httpError(400,'Không có lời cầu hòa','NO_DRAW_OFFER');
      const nextVersion=row.version+1;
      const newState={...gameState};delete newState.drawOffer;
      await client.query(`UPDATE matches SET state=$2,version=$3 WHERE id=$1`,[matchId,JSON.stringify(newState),nextVersion]);
      await client.query('INSERT INTO match_events(match_id,version,actor_id,client_action_id,action_type,action) VALUES($1,$2,$3,$4,$5,$6)',[matchId,nextVersion,userId,clientActionId,'draw_decline',JSON.stringify(action)]);
      return matchId;
    }

    const game=getGame(row.game_key);let applied;
    try{applied=game.apply(row.state,action,playerIndex);}catch(error){if(error instanceof GameRuleError)throw httpError(400,error.message,error.code);throw error;}
    const nextVersion=row.version+1; let winnerId=null,status='active';
    if(applied.result){status='finished';finished=true;winnerId=applied.result.winnerIndex==null?null:(applied.result.winnerIndex===0?row.player1_id:row.player2_id);}
    await client.query(`UPDATE matches SET state=$2,version=$3,status=$4,winner_id=$5,finished_at=CASE WHEN $4='finished' THEN UTC_TIMESTAMP() ELSE finished_at END WHERE id=$1`,[matchId,JSON.stringify(applied.state),nextVersion,status,winnerId]);
    await client.query('INSERT INTO match_events(match_id,version,actor_id,client_action_id,action_type,action) VALUES($1,$2,$3,$4,$5,$6)',[matchId,nextVersion,userId,clientActionId,String(action.type||'move').slice(0,40),JSON.stringify(action)]);
    if(applied.result&&!row.is_ai)await updateRatings(client,row,applied.result.winnerIndex);
    return matchId;
  });
  if(finished){
    const r=await pool.query('SELECT player1_id,player2_id,is_ai FROM matches WHERE id=$1',[matchIdOut]);
    const matchRow=r.rows[0];
    if(matchRow&&matchRow.is_ai){
      // AI match: reward only the human player, achievements for human only
      const humanId=isAiPlayer(matchRow.player1_id)?matchRow.player2_id:matchRow.player1_id;
      await rewardPvpResultForHuman(matchIdOut,humanId);
      await evaluateAchievements(humanId);
    }else if(matchRow){
      // Human match: reward both players normally
      await rewardPvpResult(matchIdOut);
      for(const id of [matchRow.player1_id,matchRow.player2_id].filter(Boolean))await evaluateAchievements(id);
    }
  }
  await audit(userId,'match.action',matchIdOut,{finished});
  return {matchId:matchIdOut,finished};
}

export async function listRecentMatches(userId,limit=30){
  const {rows}=await pool.query(`
    SELECT m.id,m.game_key,m.status,m.winner_id,m.version,m.created_at,m.finished_at,
      p1.id p1_id,p1.display_name p1_name,p1.avatar_url p1_avatar,p1.office_group_id p1_office_id,o1.name p1_office_name,
      p2.id p2_id,p2.display_name p2_name,p2.avatar_url p2_avatar,p2.office_group_id p2_office_id,o2.name p2_office_name
    FROM matches m JOIN users p1 ON p1.id=m.player1_id LEFT JOIN office_groups o1 ON o1.id=p1.office_group_id
    JOIN users p2 ON p2.id=m.player2_id LEFT JOIN office_groups o2 ON o2.id=p2.office_group_id
    WHERE $1=m.player1_id OR $1=m.player2_id ORDER BY m.created_at DESC LIMIT $2
  `,[userId,Math.min(100,limit)]);
  return rows.map(r=>({id:r.id,gameKey:r.game_key,status:r.status,winnerId:r.winner_id,version:r.version,createdAt:r.created_at,finishedAt:r.finished_at,players:[userPublic(r,'p1'),userPublic(r,'p2')]}));
}

export async function getPublicMatchResult(matchId){
  const {rows}=await pool.query(`SELECT m.id,m.game_key,m.winner_id,m.finished_at,p1.id p1_id,p1.display_name p1_name,p1.avatar_url p1_avatar,p2.id p2_id,p2.display_name p2_name,p2.avatar_url p2_avatar FROM matches m JOIN users p1 ON p1.id=m.player1_id JOIN users p2 ON p2.id=m.player2_id WHERE m.id=$1 AND m.status='finished'`,[matchId]);
  const r=rows[0];if(!r)return null;return {id:r.id,gameKey:r.game_key,winnerId:r.winner_id,finishedAt:r.finished_at,players:[{id:r.p1_id,name:r.p1_name,avatarUrl:r.p1_avatar},{id:r.p2_id,name:r.p2_name,avatarUrl:r.p2_avatar}]};
}

const MATCH_TIMEOUT_MS=25*60*1000;
export async function checkMatchTimeout(matchId){
  const {rows}=await pool.query(`SELECT * FROM matches WHERE id=$1 AND status='active' FOR UPDATE`,[matchId]);
  const row=rows[0];if(!row)return null;
  const elapsed=Date.now()-new Date(row.created_at).getTime();
  if(elapsed<MATCH_TIMEOUT_MS)return null;
  // Match timed out — draw
  await pool.query(`UPDATE matches SET status='finished',winner_id=NULL,finished_at=UTC_TIMESTAMP() WHERE id=$1 AND status='active'`,[matchId]);
  if(!row.is_ai){
    await withTransaction(async client=>{await updateRatings(client,row,null);});
    await rewardPvpResult(matchId);
    for(const id of [row.player1_id,row.player2_id])await evaluateAchievements(id);
  }else{
    const humanId=isAiPlayer(row.player1_id)?row.player2_id:row.player1_id;
    await rewardPvpResultForHuman(matchId,humanId);
    await evaluateAchievements(humanId);
  }
  return {matchId,draw:true};
}
