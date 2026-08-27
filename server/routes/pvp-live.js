import express from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, rateLimit } from '../middleware/auth.js';
import { allGameMap } from '../catalog.js';
import { getMatchForUser, checkMatchTimeout, getPublicMatchResult } from '../services/matches.js';
import { getProfileProgress } from '../services/rewards.js';

const router=express.Router();
const AI_ID='00000000-0000-0000-0000-000000000000';
const MATCH_DURATION_MS=25*60*1000;
const uuid=z.string().uuid();
const spectatorRooms=new Map();
let spectatorTicker=null,spectatorBusy=false;
let deadlineTicker=null;
let deadlineBusy=false;

router.use(requireAuth);
router.use(rateLimit({prefix:'pvp-live-api',limit:360,windowSeconds:60,keyFn:req=>req.session.userId}));

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const number=v=>Number.isFinite(Number(v))?Number(v):0;
function player(row,prefix){return {id:row[`${prefix}_id`],name:row[`${prefix}_name`],avatarUrl:row[`${prefix}_avatar`],officeName:row[`${prefix}_office_name`]||'',isTest:Number(row[`${prefix}_is_test`]||0)===1};}
function stateObject(row){return row?.state&&typeof row.state==='object'?row.state:{};}
function timing(row){
  const state=stateObject(row),serverNowMs=Date.now(),elapsedMs=Math.max(0,number(row.elapsed_us)/1000);
  const turnDeadline=number(state.turnDeadline);
  return {
    serverNowMs,
    matchDurationMs:MATCH_DURATION_MS,
    matchRemainingMs:row.status==='active'?Math.max(0,MATCH_DURATION_MS-elapsedMs):0,
    turnRemainingMs:row.status==='active'&&turnDeadline>0?Math.max(0,turnDeadline-serverNowMs):null,
    turnDeadlineMs:turnDeadline>0?turnDeadline:null
  };
}
async function viewerMode(userId,session){
  const row=(await pool.query('SELECT role,is_test FROM users WHERE id=$1',[userId])).rows[0];
  if(row?.role==='admin')return 'admin';
  if(Number(row?.is_test)===1&&session?.testSession===true)return 'test';
  return 'normal';
}
function visibleMatchSql(mode){
  if(mode==='admin')return '1=1';
  if(mode==='test')return 'u1.is_test=1 AND u2.is_test=1';
  return 'u1.is_test=0 AND u2.is_test=0';
}
function sanitizeState(row){
  const source=stateObject(row),gameKey=String(row.game_key||'');
  if(gameKey==='rps'){
    const picks=Array.isArray(source.picks)?source.picks:[null,null];
    return {turn:source.turn??null,lastMove:source.lastMove??null,done:row.status==='finished',picks:row.status==='finished'?picks:picks.map(v=>v?'locked':null)};
  }
  if(gameKey==='battleship'){
    return {size:Number(source.size||8),turn:source.turn??null,lastMove:source.lastMove??null,hits:Array.isArray(source.hits)?source.hits:[0,0],shots:Array.isArray(source.shots)?source.shots.map(a=>Array.isArray(a)?a.slice():[]):[[],[]]};
  }
  try{return JSON.parse(JSON.stringify(source));}catch{return {};}
}
function snapshotFromRow(row){
  const players=[player(row,'p1'),player(row,'p2')],state=sanitizeState(row),t=timing(row);
  const turnIndex=state?.turn==null?null:Number(state.turn);
  return {
    id:row.id,gameKey:row.game_key,status:row.status,winnerId:row.winner_id||null,isAi:Boolean(Number(row.is_ai)),version:Number(row.version||0),
    players,state,createdAt:row.created_at,finishedAt:row.finished_at||null,
    turnIndex:Number.isInteger(turnIndex)?turnIndex:null,
    turnPlayerId:Number.isInteger(turnIndex)?players[turnIndex]?.id||null:null,
    timing:t
  };
}
async function rawSnapshot(matchId){
  const {rows}=await pool.query(`SELECT m.*,
    TIMESTAMPDIFF(MICROSECOND,m.created_at,UTC_TIMESTAMP()) elapsed_us,
    p1.id p1_id,p1.display_name p1_name,p1.avatar_url p1_avatar,p1.is_test p1_is_test,o1.name p1_office_name,
    p2.id p2_id,p2.display_name p2_name,p2.avatar_url p2_avatar,p2.is_test p2_is_test,o2.name p2_office_name
    FROM matches m
    JOIN users p1 ON p1.id=m.player1_id LEFT JOIN office_groups o1 ON o1.id=p1.office_group_id
    JOIN users p2 ON p2.id=m.player2_id LEFT JOIN office_groups o2 ON o2.id=p2.office_group_id
    WHERE m.id=$1 LIMIT 1`,[matchId]);
  return rows[0]?snapshotFromRow(rows[0]):null;
}
async function spectatorSnapshot(matchId,userId,session){
  const mode=await viewerMode(userId,session),where=visibleMatchSql(mode);
  const {rows}=await pool.query(`SELECT m.*,
    TIMESTAMPDIFF(MICROSECOND,m.created_at,UTC_TIMESTAMP()) elapsed_us,
    p1.id p1_id,p1.display_name p1_name,p1.avatar_url p1_avatar,p1.is_test p1_is_test,o1.name p1_office_name,
    p2.id p2_id,p2.display_name p2_name,p2.avatar_url p2_avatar,p2.is_test p2_is_test,o2.name p2_office_name
    FROM matches m
    JOIN users p1 ON p1.id=m.player1_id LEFT JOIN office_groups o1 ON o1.id=p1.office_group_id
    JOIN users p2 ON p2.id=m.player2_id LEFT JOIN office_groups o2 ON o2.id=p2.office_group_id
    WHERE m.id=$1 AND ${where} LIMIT 1`,[matchId]);
  return rows[0]?snapshotFromRow(rows[0]):null;
}

router.get('/pvp/time',async(req,res)=>res.json({serverNowMs:Date.now(),matchDurationMs:MATCH_DURATION_MS}));

// Enhanced participant match endpoint. Mounted before the legacy api router so the existing UI
// receives authoritative timing metadata without changing its match payload shape.
router.get('/matches/:id',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  await checkMatchTimeout(id).catch(()=>{});
  const match=await getMatchForUser(id,req.session.userId);
  const row=(await pool.query(`SELECT state,status,TIMESTAMPDIFF(MICROSECOND,created_at,UTC_TIMESTAMP()) elapsed_us FROM matches WHERE id=$1`,[id])).rows[0]||{};
  res.json({match,timing:timing(row)});
});

router.get('/pvp/history',async(req,res)=>{
  const page=Math.max(1,Number(req.query.page)||1),pageSize=clamp(Number(req.query.pageSize)||10,5,25),offset=(page-1)*pageSize;
  const gameKey=String(req.query.gameKey||'').slice(0,40),result=String(req.query.result||'all');
  if(gameKey&&gameKey!=='all'&&!allGameMap.has(gameKey))return res.status(400).json({error:'BAD_GAME'});
  const params=[req.session.userId],where=['(m.player1_id=$1 OR m.player2_id=$1)'];
  if(gameKey&&gameKey!=='all'){params.push(gameKey);where.push(`m.game_key=$${params.length}`);}
  if(result==='active')where.push("m.status='active'");
  else if(result==='win')where.push("m.status='finished' AND m.winner_id=$1");
  else if(result==='loss')where.push("m.status='finished' AND m.winner_id IS NOT NULL AND m.winner_id<>$1");
  else if(result==='draw')where.push("m.status='finished' AND m.winner_id IS NULL");
  const count=(await pool.query(`SELECT COUNT(*) n FROM matches m WHERE ${where.join(' AND ')}`,params)).rows[0];
  params.push(pageSize,offset);const limitIdx=params.length-1,offsetIdx=params.length;
  const {rows}=await pool.query(`SELECT m.id,m.game_key,m.status,m.winner_id,m.version,m.created_at,m.finished_at,m.is_ai,
    TIMESTAMPDIFF(MICROSECOND,m.created_at,UTC_TIMESTAMP()) elapsed_us,
    p1.id p1_id,p1.display_name p1_name,p1.avatar_url p1_avatar,p1.is_test p1_is_test,o1.name p1_office_name,
    p2.id p2_id,p2.display_name p2_name,p2.avatar_url p2_avatar,p2.is_test p2_is_test,o2.name p2_office_name,
    m.state
    FROM matches m
    JOIN users p1 ON p1.id=m.player1_id LEFT JOIN office_groups o1 ON o1.id=p1.office_group_id
    JOIN users p2 ON p2.id=m.player2_id LEFT JOIN office_groups o2 ON o2.id=p2.office_group_id
    WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,params);
  const total=Number(count?.n||0),pages=Math.max(1,Math.ceil(total/pageSize));
  res.json({matches:rows.map(snapshotFromRow),pagination:{page:Math.min(page,pages),pageSize,total,pages},serverNowMs:Date.now()});
});

router.get('/pvp/live-matches',async(req,res)=>{
  const gameKey=String(req.query.gameKey||'').slice(0,40);if(gameKey&&gameKey!=='all'&&!allGameMap.has(gameKey))return res.status(400).json({error:'BAD_GAME'});
  const mode=await viewerMode(req.session.userId,req.session),where=["m.status='active'",visibleMatchSql(mode)];const params=[];
  if(gameKey&&gameKey!=='all'){params.push(gameKey);where.push(`m.game_key=$${params.length}`);}
  const {rows}=await pool.query(`SELECT m.id,m.game_key,m.status,m.winner_id,m.version,m.created_at,m.finished_at,m.is_ai,m.state,
    TIMESTAMPDIFF(MICROSECOND,m.created_at,UTC_TIMESTAMP()) elapsed_us,
    p1.id p1_id,p1.display_name p1_name,p1.avatar_url p1_avatar,p1.is_test p1_is_test,o1.name p1_office_name,
    p2.id p2_id,p2.display_name p2_name,p2.avatar_url p2_avatar,p2.is_test p2_is_test,o2.name p2_office_name
    FROM matches m
    JOIN users p1 ON p1.id=m.player1_id LEFT JOIN office_groups o1 ON o1.id=p1.office_group_id
    JOIN users p2 ON p2.id=m.player2_id LEFT JOIN office_groups o2 ON o2.id=p2.office_group_id
    WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT 60`,params);
  res.json({matches:rows.map(snapshotFromRow),serverNowMs:Date.now()});
});

router.get('/pvp/live/:id',async(req,res)=>{
  const id=uuid.parse(req.params.id);await checkMatchTimeout(id).catch(()=>{});
  const match=await spectatorSnapshot(id,req.session.userId,req.session);if(!match)return res.status(404).json({error:'MATCH_NOT_FOUND'});
  res.json({match,viewers:spectatorRooms.get(id)?.size||0});
});

function roomSet(matchId){let set=spectatorRooms.get(matchId);if(!set){set=new Set();spectatorRooms.set(matchId,set);}return set;}
function leaveRoom(socket,matchId){if(!matchId)return;socket.leave(`spectate:${matchId}`);const set=spectatorRooms.get(matchId);if(set){set.delete(socket.id);if(!set.size)spectatorRooms.delete(matchId);}}

export function installPvpLiveSockets(io){
  io.on('connection',socket=>{
    const userId=socket.request.session?.userId;if(!userId)return;
    socket.on('spectate:join',async(payload,ack=()=>{})=>{try{
      const id=uuid.parse(payload?.matchId);const snapshot=await spectatorSnapshot(id,userId,socket.request.session);if(!snapshot)return ack({ok:false,error:'MATCH_NOT_FOUND'});
      if(socket.data.spectatingMatchId&&socket.data.spectatingMatchId!==id)leaveRoom(socket,socket.data.spectatingMatchId);
      socket.data.spectatingMatchId=id;socket.join(`spectate:${id}`);const set=roomSet(id);set.add(socket.id);
      ack({ok:true,match:snapshot,viewers:set.size});io.to(`spectate:${id}`).emit('spectate:viewers',{matchId:id,viewers:set.size});
    }catch(e){ack({ok:false,error:'BAD_MATCH',message:e.message});}});
    socket.on('spectate:leave',payload=>{const id=String(payload?.matchId||socket.data.spectatingMatchId||'');leaveRoom(socket,id);if(socket.data.spectatingMatchId===id)socket.data.spectatingMatchId=null;});
    socket.on('disconnect',()=>{const id=socket.data.spectatingMatchId;leaveRoom(socket,id);});
  });
  if(!spectatorTicker)spectatorTicker=setInterval(async()=>{
    if(spectatorBusy)return;spectatorBusy=true;try{
      for(const [matchId,set] of [...spectatorRooms.entries()]){
        if(!set.size){spectatorRooms.delete(matchId);continue;}
        try{const match=await rawSnapshot(matchId);if(match)io.to(`spectate:${matchId}`).emit('spectate:update',{match,viewers:set.size});}
        catch{}
      }
    }finally{spectatorBusy=false;}
  },350);
}

async function notifyTimedOut(io,matchId){
  const row=(await pool.query('SELECT player1_id,player2_id FROM matches WHERE id=$1',[matchId])).rows[0];if(!row)return;
  for(const id of [row.player1_id,row.player2_id]){
    if(!id||id===AI_ID)continue;
    try{io.to(`user:${id}`).emit('match:update',{match:await getMatchForUser(matchId,id)});io.to(`user:${id}`).emit('progress:update',{progress:await getProfileProgress(id)});}catch{}
  }
  try{const result=await getPublicMatchResult(matchId);if(result)io.emit('arena:result',{result});}catch{}
  try{const match=await rawSnapshot(matchId);const viewers=spectatorRooms.get(matchId)?.size||0;if(match)io.to(`spectate:${matchId}`).emit('spectate:update',{match,viewers});}catch{}
}

export function startPvpDeadlineWatch(io){
  if(deadlineTicker)return;
  deadlineTicker=setInterval(async()=>{
    if(deadlineBusy)return;deadlineBusy=true;
    try{
      const now=Date.now();
      const {rows}=await pool.query(`SELECT id FROM matches WHERE status='active' AND (
        created_at<=UTC_TIMESTAMP()-INTERVAL 25 MINUTE OR
        (JSON_EXTRACT(state,'$.turnDeadline') IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(state,'$.turnDeadline')) AS UNSIGNED)<=$1)
      ) ORDER BY created_at ASC LIMIT 80`,[now]);
      for(const r of rows){try{const result=await checkMatchTimeout(r.id);if(result)await notifyTimedOut(io,r.id);}catch(e){console.error(JSON.stringify({level:'error',event:'pvp_deadline_watch',matchId:r.id,message:e.message}));}}
    }finally{deadlineBusy=false;}
  },250);
}

export default router;
