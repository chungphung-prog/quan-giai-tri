import crypto from 'node:crypto';
import { pool, withTransaction, audit } from '../db.js';
import { allGameMap } from '../catalog.js';
import { rewardSolo } from './rewards.js';
function err(status,message,code){const e=new Error(message);e.status=status;e.code=code;return e;}
export async function startSoloRun(userId,gameKey){
  if(!allGameMap.has(gameKey))throw err(400,'Game không hợp lệ','BAD_GAME');if(allGameMap.get(gameKey)?.pvp)throw err(400,'Game PvP phải chơi qua matchmaking server-authoritative','PVP_MATCH_REQUIRED');
  const cfg=(await pool.query('SELECT * FROM game_configs WHERE game_key=$1',[gameKey])).rows[0];if(!cfg?.enabled)throw err(423,'Game đang được admin tắt','GAME_DISABLED');
  const id=crypto.randomUUID(),nonce=crypto.randomBytes(24).toString('base64url'),seed=crypto.randomInt(1,2_000_000_000),ttl=30*60,now=new Date(),expires=new Date(now.getTime()+ttl*1000);
  await pool.query('INSERT INTO solo_runs(id,user_id,game_key,nonce,seed,started_at,expires_at,client_meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,userId,gameKey,nonce,seed,now,expires,'{}']);
  return {runId:id,nonce,seed,startedAt:now,expiresAt:expires,config:{aiDifficulty:cfg.ai_difficulty,speedStart:Number(cfg.speed_start),speedMax:Number(cfg.speed_max),scoreCap:Number(cfg.score_cap),minRunSeconds:Number(cfg.min_run_seconds)}};
}
export async function finishSoloRun(userId,{runId,nonce,score,durationMs,meta={}},expectedGameKey=null){
  if(!Number.isInteger(score)||score<0)throw err(400,'Score không hợp lệ','BAD_SCORE');if(!Number.isInteger(durationMs)||durationMs<0)throw err(400,'Duration không hợp lệ','BAD_DURATION');
  const out=await withTransaction(async client=>{
    const r=(await client.query('SELECT sr.*,gc.enabled,gc.leaderboard_enabled,gc.xp_multiplier,gc.point_multiplier,gc.score_cap,gc.min_run_seconds FROM solo_runs sr JOIN game_configs gc ON gc.game_key=sr.game_key WHERE sr.id=$1 AND sr.user_id=$2 FOR UPDATE',[runId,userId])).rows[0];
    if(!r)throw err(404,'Không tìm thấy run','RUN_NOT_FOUND');if(expectedGameKey&&r.game_key!==expectedGameKey)throw err(400,'Run không thuộc game này','RUN_GAME_MISMATCH');if(r.status!=='active')throw err(409,'Run đã được submit','RUN_USED');if(r.nonce!==nonce)throw err(403,'Run nonce không hợp lệ','BAD_RUN_NONCE');
    if(new Date(r.expires_at).getTime()<Date.now()){await client.query("UPDATE solo_runs SET status='expired' WHERE id=$1",[runId]);throw err(409,'Run hết hạn','RUN_EXPIRED');}
    const serverDuration=Date.now()-new Date(r.started_at).getTime();if(serverDuration<Number(r.min_run_seconds)*1000||durationMs<Number(r.min_run_seconds)*1000)throw err(400,'Lượt chơi quá ngắn','RUN_TOO_FAST');if(Math.abs(serverDuration-durationMs)>Math.max(15_000,serverDuration*.45))throw err(400,'Timing không hợp lệ','BAD_TIMING');if(score>Number(r.score_cap))throw err(400,'Score vượt ngưỡng cho phép','SCORE_OUT_OF_RANGE');
    const safeMeta={label:String(meta?.label||'').slice(0,120)};await client.query("UPDATE solo_runs SET status='finished',finished_at=UTC_TIMESTAMP(),submitted_score=$2,client_meta=$3 WHERE id=$1",[runId,score,JSON.stringify(safeMeta)]);
    if(r.leaderboard_enabled)await client.query(`INSERT INTO game_scores(user_id,game_key,best_score,plays,last_score,updated_at) VALUES($1,$2,$3,1,$3,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE best_score=GREATEST(best_score,VALUES(best_score)),plays=plays+1,last_score=VALUES(last_score),updated_at=UTC_TIMESTAMP()`,[userId,r.game_key,score]);
    return {gameKey:r.game_key,score,xpMultiplier:Number(r.xp_multiplier),pointMultiplier:Number(r.point_multiplier)};
  });
  const reward=await rewardSolo({userId,runId,gameKey:out.gameKey,score:out.score,multiplier:out.xpMultiplier,pointMultiplier:out.pointMultiplier});await audit(userId,'solo.finish',runId,{gameKey:out.gameKey,score:out.score});return {...out,reward};
}
