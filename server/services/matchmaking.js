import { withTransaction, pool, audit } from '../db.js';
import { createMatch } from './matches.js';
import { games } from '../games/index.js';
function err(status,message,code){const e=new Error(message);e.status=status;e.code=code;return e;}
export async function joinQueue(userId,gameKey){
  if(!games.has(gameKey))throw err(400,'Game này chưa hỗ trợ PvP online','UNSUPPORTED_GAME');const cfg=(await pool.query('SELECT enabled FROM game_configs WHERE game_key=$1',[gameKey])).rows[0];if(!cfg?.enabled)throw err(423,'Game đang tắt','GAME_DISABLED');const active=await pool.query("SELECT 1 FROM matches WHERE status='active' AND (player1_id=$1 OR player2_id=$1) LIMIT 1",[userId]);if(active.rowCount)throw err(409,'Bạn đang có trận chưa kết thúc','ACTIVE_MATCH');
  const result=await withTransaction(async client=>{await client.query('DELETE FROM match_queue WHERE user_id=$1',[userId]);const opponent=(await client.query(`SELECT q.user_id FROM match_queue q JOIN users u ON u.id=q.user_id WHERE q.game_key=$1 AND q.user_id<>$2 AND u.status='active' ORDER BY q.joined_at ASC LIMIT 1 FOR UPDATE`,[gameKey,userId])).rows[0];if(!opponent){await client.query('INSERT INTO match_queue(user_id,game_key) VALUES($1,$2)',[userId,gameKey]);return {matched:false};}await client.query('DELETE FROM match_queue WHERE user_id IN ($1,$2)',[userId,opponent.user_id]);const matchId=await createMatch(client,gameKey,userId,opponent.user_id);return {matched:true,matchId,opponentId:opponent.user_id};});
  await audit(userId,'matchmaking.join',result.matchId||null,{gameKey,matched:result.matched});return result;
}
export async function leaveQueue(userId){await pool.query('DELETE FROM match_queue WHERE user_id=$1',[userId]);return {ok:true};}
export async function queueStatus(){const {rows}=await pool.query('SELECT game_key,COUNT(*) waiting FROM match_queue GROUP BY game_key');return rows.map(r=>({...r,waiting:Number(r.waiting)}));}
export async function queueUsers(){const {rows}=await pool.query(`SELECT q.game_key,q.joined_at,u.id,u.display_name name,u.avatar_url FROM match_queue q JOIN users u ON u.id=q.user_id WHERE u.status='active' ORDER BY q.joined_at ASC LIMIT 30`);return rows;}

export async function myQueueState(userId,gameKey=null){
  const active=await pool.query(`SELECT id,game_key,created_at FROM matches WHERE status='active' AND (player1_id=$1 OR player2_id=$1) ${gameKey?'AND game_key=$2':''} ORDER BY created_at DESC LIMIT 1`,gameKey?[userId,gameKey]:[userId]);
  if(active.rows[0])return {queued:false,matched:true,matchId:active.rows[0].id,gameKey:active.rows[0].game_key};
  const queued=await pool.query(`SELECT game_key,joined_at FROM match_queue WHERE user_id=$1 ${gameKey?'AND game_key=$2':''} LIMIT 1`,gameKey?[userId,gameKey]:[userId]);
  if(queued.rows[0])return {queued:true,matched:false,gameKey:queued.rows[0].game_key,joinedAt:queued.rows[0].joined_at};
  return {queued:false,matched:false};
}
