import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { getSetting } from './site.js';
export function levelFromXp(xp){xp=Math.max(0,Number(xp)||0);let level=1;while(level<100&&xp>=xpForLevel(level+1))level++;return level;}
export function xpForLevel(level){if(level<=1)return 0;return Math.round(120*Math.pow(level-1,1.62));}
export function progressFromXp(xp){const level=levelFromXp(xp),from=xpForLevel(level),to=xpForLevel(level+1);return {level,xp:Number(xp),levelStartXp:from,nextLevelXp:to,progress:level>=100?1:(Number(xp)-from)/(to-from)};}
function dayStartUtc(timeZone=config.timezone){
  const now=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const guess=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),0,0,0));
  const tzPart=new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'longOffset',hour:'2-digit'}).formatToParts(guess).find(p=>p.type==='timeZoneName')?.value||'GMT+00:00';
  const m=tzPart.match(/GMT([+-])(\d{2}):(\d{2})/);const offset=m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3])):0;
  return new Date(guess.getTime()-offset*60_000);
}
async function insertReward(client,userId,sourceType,sourceId,xp,points,metadata={}){
  const ins=await client.query(`INSERT IGNORE INTO reward_events(user_id,source_type,source_id,xp,points,metadata) VALUES($1,$2,$3,$4,$5,$6)`,[userId,sourceType,String(sourceId),xp,points,JSON.stringify(metadata)]);
  if(!ins.rowCount)return false;await client.query('UPDATE users SET xp=xp+$2,points=points+$3,total_games=total_games+CASE WHEN $4=1 THEN 1 ELSE 0 END WHERE id=$1',[userId,xp,points,metadata.countGame?1:0]);return true;
}
async function unlock(client,userId,key){
  const def=(await client.query('SELECT * FROM achievement_defs WHERE achievement_key=$1',[key])).rows[0];if(!def)return null;
  const ins=await client.query('INSERT IGNORE INTO user_achievements(user_id,achievement_key) VALUES($1,$2)',[userId,key]);if(!ins.rowCount)return null;
  await client.query('UPDATE users SET xp=xp+$2,points=points+$3 WHERE id=$1',[userId,def.xp_reward,def.point_reward]);return {key:def.achievement_key,name:def.name,description:def.description,icon:def.icon,tier:def.tier,xpReward:def.xp_reward,pointReward:def.point_reward};
}
export async function evaluateAchievements(userId,extra={}){return withTransaction(async client=>{
  const u=(await client.query('SELECT xp,total_games FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];if(!u)return[];
  const pvp=Number((await client.query("SELECT COUNT(*) n FROM matches WHERE status='finished' AND (player1_id=$1 OR player2_id=$1)",[userId])).rows[0].n),wins=Number((await client.query("SELECT COUNT(*) n FROM matches WHERE status='finished' AND winner_id=$1",[userId])).rows[0].n),chats=Number((await client.query('SELECT COUNT(*) n FROM chat_messages WHERE user_id=$1 AND deleted_at IS NULL',[userId])).rows[0].n),level=levelFromXp(u.xp);
  const keys=[];if(Number(u.total_games)>=1)keys.push('first_game');if(wins>=1)keys.push('first_win');if(pvp>=10)keys.push('pvp_10');if(pvp>=50)keys.push('pvp_50');if(level>=5)keys.push('level_5');if(level>=10)keys.push('level_10');if(chats>=25)keys.push('chat_25');if(Number(extra.score)>=1000)keys.push('score_1000');const out=[];for(const key of keys){const a=await unlock(client,userId,key);if(a)out.push(a);}return out;
});}
export async function rewardSolo({userId,runId,gameKey,score,multiplier=1,pointMultiplier=1}){
  const economy=await getSetting('economy')||{};const start=dayStartUtc();
  const awarded=await withTransaction(async client=>{await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);const today=await client.query(`SELECT COALESCE(SUM(xp),0) xp,COALESCE(SUM(points),0) points FROM reward_events WHERE user_id=$1 AND source_type='solo' AND created_at>=$2`,[userId,start]);const used=today.rows[0]||{xp:0,points:0};let xp=Math.round(Math.min(100,15+Math.sqrt(Math.max(score,0))*1.8)*Number(multiplier||1));let points=Math.round(Math.min(25,3+Math.sqrt(Math.max(score,0))/8)*Number(pointMultiplier||1));xp=Math.max(0,Math.min(xp,Math.max(0,Number(economy.soloDailyXpCap??1800)-Number(used.xp))));points=Math.max(0,Math.min(points,Math.max(0,Number(economy.soloDailyPointCap??400)-Number(used.points))));const inserted=await insertReward(client,userId,'solo',runId,xp,points,{gameKey,score,countGame:true});return inserted?{xp,points}:{xp:0,points:0};});const achievements=await evaluateAchievements(userId,{score});return {...awarded,achievements};
}
export async function rewardPvpResult(matchId){const economy=await getSetting('economy')||{};return withTransaction(async client=>{const row=(await client.query("SELECT * FROM matches WHERE id=$1 AND status='finished' FOR UPDATE",[matchId])).rows[0];if(!row)return null;const ids=[row.player1_id,row.player2_id],results=[];for(const id of ids){const draw=!row.winner_id,win=row.winner_id===id;const xp=draw?(economy.pvpDrawXp??75):win?(economy.pvpWinXp??120):(economy.pvpLoseXp??60),points=draw?(economy.pvpDrawPoints??18):win?(economy.pvpWinPoints??35):(economy.pvpLosePoints??10);const inserted=await insertReward(client,id,'pvp',matchId,xp,points,{gameKey:row.game_key,result:draw?'draw':win?'win':'loss',countGame:true});results.push({userId:id,xp:inserted?xp:0,points:inserted?points:0});}return results;});}
export async function getProfileProgress(userId){
  const {rows}=await pool.query('SELECT xp,points,total_games FROM users WHERE id=$1',[userId]);if(!rows[0])return null;
  const achievements=(await pool.query(`SELECT a.achievement_key,a.name,a.description,a.icon,a.tier,a.xp_reward,a.point_reward,ua.unlocked_at FROM achievement_defs a LEFT JOIN user_achievements ua ON ua.achievement_key=a.achievement_key AND ua.user_id=$1 ORDER BY a.sort_order,a.achievement_key`,[userId])).rows;
  return {...progressFromXp(rows[0].xp),points:Number(rows[0].points),totalGames:Number(rows[0].total_games),achievements:achievements.map(a=>({key:a.achievement_key,name:a.name,description:a.description,icon:a.icon,tier:a.tier,xpReward:Number(a.xp_reward),pointReward:Number(a.point_reward),unlockedAt:a.unlocked_at}))};
}
