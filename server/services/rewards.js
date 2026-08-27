import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { getSetting } from './site.js';
import { eligibleAchievementKeys, rankFromLevel } from './progression-v2.js';

export function xpForLevel(level){
  level=Math.max(1,Math.min(100,Number(level)||1));
  if(level<=1)return 0;
  const n=level-1;
  return Math.round(220*Math.pow(n,1.78)+90*n);
}
export function levelFromXp(xp){xp=Math.max(0,Number(xp)||0);let level=1;while(level<100&&xp>=xpForLevel(level+1))level++;return level;}
export function progressFromXp(xp){const level=levelFromXp(xp),from=xpForLevel(level),to=xpForLevel(Math.min(100,level+1));return {level,xp:Number(xp),levelStartXp:from,nextLevelXp:level>=100?from:to,progress:level>=100?1:(Number(xp)-from)/(to-from)};}

function dayStartUtc(timeZone=config.timezone){
  const now=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const guess=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),0,0,0));
  const tzPart=new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'longOffset',hour:'2-digit'}).formatToParts(guess).find(p=>p.type==='timeZoneName')?.value||'GMT+00:00';
  const m=tzPart.match(/GMT([+-])(\d{2}):(\d{2})/);const offset=m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3])):0;
  return new Date(guess.getTime()-offset*60_000);
}

async function insertReward(client,userId,sourceType,sourceId,xp,points,metadata={}){
  const ins=await client.query(`INSERT IGNORE INTO reward_events(user_id,source_type,source_id,xp,points,metadata) VALUES($1,$2,$3,$4,$5,$6)`,[userId,sourceType,String(sourceId),xp,points,JSON.stringify(metadata)]);
  if(!ins.rowCount)return false;
  await client.query('UPDATE users SET xp=xp+$2,points=points+$3,total_games=total_games+CASE WHEN $4=1 THEN 1 ELSE 0 END WHERE id=$1',[userId,xp,points,metadata.countGame?1:0]);
  return true;
}
async function unlock(client,userId,key){
  const def=(await client.query('SELECT * FROM achievement_defs WHERE achievement_key=$1',[key])).rows[0];if(!def)return null;
  const ins=await client.query('INSERT IGNORE INTO user_achievements(user_id,achievement_key) VALUES($1,$2)',[userId,key]);if(!ins.rowCount)return null;
  await client.query('UPDATE users SET xp=xp+$2,points=points+$3 WHERE id=$1',[userId,def.xp_reward,def.point_reward]);
  return {key:def.achievement_key,name:def.name,description:def.description,icon:def.icon,tier:def.tier,category:def.category||'Tân binh',categoryOrder:Number(def.category_order||0),xpReward:Number(def.xp_reward),pointReward:Number(def.point_reward)};
}

async function readAchievementMetrics(client,userId){
  const u=(await client.query('SELECT xp,points,total_games,COALESCE(progress_reset_at,created_at) progress_reset_at FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
  if(!u)return null;
  const resetAt=u.progress_reset_at;
  const match=(await client.query(`SELECT
    COUNT(*) total_matches,
    SUM(CASE WHEN is_ai=0 THEN 1 ELSE 0 END) pvp,
    SUM(CASE WHEN winner_id=$1 THEN 1 ELSE 0 END) all_wins,
    SUM(CASE WHEN is_ai=0 AND winner_id=$1 THEN 1 ELSE 0 END) pvp_wins
    FROM matches WHERE status='finished' AND (player1_id=$1 OR player2_id=$1) AND COALESCE(finished_at,created_at)>=$2`,[userId,resetAt])).rows[0]||{};
  const solo=Number((await client.query("SELECT COUNT(*) n FROM solo_runs WHERE user_id=$1 AND status='finished' AND COALESCE(finished_at,started_at)>=$2",[userId,resetAt])).rows[0]?.n||0);
  const chats=Number((await client.query('SELECT COUNT(*) n FROM chat_messages WHERE user_id=$1 AND deleted_at IS NULL AND created_at>=$2',[userId,resetAt])).rows[0]?.n||0);
  const bestScore=Number((await client.query('SELECT COALESCE(MAX(best_score),0) n FROM game_scores WHERE user_id=$1',[userId])).rows[0]?.n||0);
  const maxRating=Number((await client.query('SELECT COALESCE(MAX(rating),1000) n FROM ratings WHERE user_id=$1',[userId])).rows[0]?.n||1000);
  const recent=(await client.query("SELECT winner_id FROM matches WHERE status='finished' AND is_ai=0 AND (player1_id=$1 OR player2_id=$1) AND COALESCE(finished_at,created_at)>=$2 ORDER BY COALESCE(finished_at,created_at) DESC LIMIT 12",[userId,resetAt])).rows;
  let winStreak=0;for(const r of recent){if(r.winner_id===userId)winStreak++;else break;}
  return {xp:Number(u.xp),points:Number(u.points),totalGames:Number(u.total_games),level:levelFromXp(u.xp),pvp:Number(match.pvp||0),allWins:Number(match.all_wins||0),pvpWins:Number(match.pvp_wins||0),solo,chats,bestScore,maxRating,winStreak};
}

export async function evaluateAchievements(userId){return withTransaction(async client=>{
  const out=[];
  for(let round=0;round<4;round++){
    const metrics=await readAchievementMetrics(client,userId);if(!metrics)return out;
    const keys=eligibleAchievementKeys(metrics);let opened=0;
    for(const key of keys){const ach=await unlock(client,userId,key);if(ach){out.push(ach);opened++;}}
    if(!opened)break;
  }
  return out;
});}

export async function rewardSolo({userId,runId,gameKey,score,multiplier=1,pointMultiplier=1}){
  const economy=await getSetting('economy')||{};const start=dayStartUtc();
  const awarded=await withTransaction(async client=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const today=await client.query(`SELECT COALESCE(SUM(xp),0) xp,COALESCE(SUM(points),0) points FROM reward_events WHERE user_id=$1 AND source_type='solo' AND created_at>=$2`,[userId,start]);
    const used=today.rows[0]||{xp:0,points:0},safeScore=Math.max(0,Number(score)||0);
    let xp=Math.round(Math.min(65,8+Math.sqrt(safeScore)*0.45)*Number(multiplier||1));
    let points=Math.round(Math.min(10,1+Math.sqrt(safeScore)/45)*Number(pointMultiplier||1));
    xp=Math.max(0,Math.min(xp,Math.max(0,Number(economy.soloDailyXpCap??650)-Number(used.xp))));
    points=Math.max(0,Math.min(points,Math.max(0,Number(economy.soloDailyPointCap??100)-Number(used.points))));
    const inserted=await insertReward(client,userId,'solo',runId,xp,points,{gameKey,score:safeScore,countGame:true});
    return inserted?{xp,points}:{xp:0,points:0};
  });
  const achievements=await evaluateAchievements(userId);
  return {...awarded,achievements};
}

function pvpReward(economy,win,draw){
  return {
    xp:Number(draw?(economy.pvpDrawXp??42):win?(economy.pvpWinXp??85):(economy.pvpLoseXp??22)),
    points:Number(draw?(economy.pvpDrawPoints??7):win?(economy.pvpWinPoints??16):(economy.pvpLosePoints??3))
  };
}
export async function rewardPvpResult(matchId){
  const economy=await getSetting('economy')||{};
  return withTransaction(async client=>{
    const row=(await client.query("SELECT * FROM matches WHERE id=$1 AND status='finished' FOR UPDATE",[matchId])).rows[0];if(!row)return null;
    const ids=[row.player1_id,row.player2_id],results=[];
    for(const id of ids){const draw=!row.winner_id,win=row.winner_id===id,{xp,points}=pvpReward(economy,win,draw);const inserted=await insertReward(client,id,'pvp',matchId,xp,points,{gameKey:row.game_key,result:draw?'draw':win?'win':'loss',countGame:true});results.push({userId:id,xp:inserted?xp:0,points:inserted?points:0});}
    return results;
  });
}
export async function rewardPvpResultForHuman(matchId,humanId){
  const economy=await getSetting('economy')||{};
  return withTransaction(async client=>{
    const row=(await client.query("SELECT * FROM matches WHERE id=$1 AND status='finished' FOR UPDATE",[matchId])).rows[0];if(!row)return null;
    const draw=!row.winner_id,win=row.winner_id===humanId,base=pvpReward(economy,win,draw);
    const xp=Math.max(0,Math.round(base.xp*.65)),points=Math.max(0,Math.round(base.points*.5));
    const inserted=await insertReward(client,humanId,'pvp',matchId,xp,points,{gameKey:row.game_key,result:draw?'draw':win?'win':'loss',countGame:true,isAi:true});
    return [{userId:humanId,xp:inserted?xp:0,points:inserted?points:0}];
  });
}

export async function getProfileProgress(userId){
  const {rows}=await pool.query('SELECT xp,points,total_games FROM users WHERE id=$1',[userId]);if(!rows[0])return null;
  const achievements=(await pool.query(`SELECT a.achievement_key,a.name,a.description,a.icon,a.tier,a.category,a.category_order,a.xp_reward,a.point_reward,ua.unlocked_at
    FROM achievement_defs a LEFT JOIN user_achievements ua ON ua.achievement_key=a.achievement_key AND ua.user_id=$1
    ORDER BY a.category_order,a.sort_order,a.achievement_key`,[userId])).rows;
  const base=progressFromXp(rows[0].xp),rank=rankFromLevel(base.level);
  return {...base,rank,points:Number(rows[0].points),totalGames:Number(rows[0].total_games),achievementCount:achievements.length,achievements:achievements.map(a=>({key:a.achievement_key,name:a.name,description:a.description,icon:a.icon,tier:a.tier,category:a.category||'Tân binh',categoryOrder:Number(a.category_order||0),xpReward:Number(a.xp_reward),pointReward:Number(a.point_reward),unlockedAt:a.unlocked_at}))};
}
