import crypto from 'node:crypto';
import { pool, withTransaction, audit } from '../db.js';
import { getGame } from '../games/index.js';
import { createMatch } from './matches.js';
function err(status,message,code){const e=new Error(message);e.status=status;e.code=code;return e;}
export async function createChallenge({creatorId,gameKey,targetUserId=null,targetOfficeGroupId=null}){
  getGame(gameKey);if(Boolean(targetUserId)===Boolean(targetOfficeGroupId))throw err(400,'Phải chọn đúng một user hoặc khối','BAD_TARGET');if(targetUserId===creatorId)throw err(400,'Không thể tự thách đấu','SELF_CHALLENGE');
  if(targetUserId&&!(await pool.query('SELECT id FROM users WHERE id=$1',[targetUserId])).rowCount)throw err(404,'Không tìm thấy user','USER_NOT_FOUND');
  if(targetOfficeGroupId&&!(await pool.query('SELECT id FROM office_groups WHERE id=$1',[targetOfficeGroupId])).rowCount)throw err(404,'Không tìm thấy khối','OFFICE_NOT_FOUND');
  const id=crypto.randomUUID(),expiresAt=new Date(Date.now()+10*60_000);
  await pool.query('INSERT INTO challenges(id,creator_id,target_user_id,target_office_group_id,game_key,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,creatorId,targetUserId,targetOfficeGroupId,gameKey,expiresAt]);
  const row=(await pool.query('SELECT * FROM challenges WHERE id=$1',[id])).rows[0];await audit(creatorId,'challenge.create',id,{gameKey,targetUserId,targetOfficeGroupId});return row;
}
export async function acceptChallenge(challengeId,userId){
  const result=await withTransaction(async client=>{
    const {rows}=await client.query(`SELECT c.*,u.office_group_id accepter_office FROM challenges c JOIN users u ON u.id=$2 WHERE c.id=$1 FOR UPDATE`,[challengeId,userId]);const c=rows[0];
    if(!c)throw err(404,'Không tìm thấy challenge','CHALLENGE_NOT_FOUND');if(c.creator_id===userId)throw err(400,'Không thể tự nhận challenge','SELF_CHALLENGE');if(c.status!=='pending'||new Date(c.expires_at).getTime()<=Date.now())throw err(409,'Challenge không còn hiệu lực','CHALLENGE_CLOSED');if(c.target_user_id&&c.target_user_id!==userId)throw err(403,'Challenge này dành cho người khác','WRONG_TARGET');if(c.target_office_group_id&&c.target_office_group_id!==c.accepter_office)throw err(403,'Challenge này dành cho khối khác','WRONG_OFFICE');
    const matchId=await createMatch(client,c.game_key,c.creator_id,userId);await client.query("UPDATE challenges SET status='accepted',match_id=$2 WHERE id=$1",[challengeId,matchId]);return {matchId,creatorId:c.creator_id,targetOfficeGroupId:c.target_office_group_id};
  });await audit(userId,'challenge.accept',challengeId,{matchId:result.matchId});return result;
}
export async function declineChallenge(challengeId,userId){
  const row=(await pool.query(`SELECT c.id,c.creator_id FROM challenges c JOIN users u ON u.id=$2 WHERE c.id=$1 AND c.status='pending' AND c.creator_id<>$2 AND (c.target_user_id=$2 OR (c.target_office_group_id IS NOT NULL AND c.target_office_group_id=u.office_group_id))`,[challengeId,userId])).rows[0];
  if(!row)throw err(404,'Challenge không tồn tại hoặc không dành cho bạn','CHALLENGE_NOT_FOUND');const changed=await pool.query("UPDATE challenges SET status='declined' WHERE id=$1 AND status='pending'",[challengeId]);if(!changed.rowCount)throw err(409,'Challenge không còn hiệu lực','CHALLENGE_CLOSED');await audit(userId,'challenge.decline',challengeId);return row;
}
export async function listChallenges(userId){
  await pool.query("UPDATE challenges SET status='expired' WHERE status='pending' AND expires_at<=UTC_TIMESTAMP()");
  const {rows}=await pool.query(`SELECT c.*,cu.display_name creator_name,cu.avatar_url creator_avatar,og.name target_office_name,tu.display_name target_user_name,me.office_group_id my_office_id FROM challenges c JOIN users cu ON cu.id=c.creator_id JOIN users me ON me.id=$1 LEFT JOIN office_groups og ON og.id=c.target_office_group_id LEFT JOIN users tu ON tu.id=c.target_user_id WHERE c.creator_id=$1 OR (c.status='pending' AND (c.target_user_id=$1 OR (c.target_office_group_id IS NOT NULL AND c.target_office_group_id=me.office_group_id))) ORDER BY c.created_at DESC LIMIT 100`,[userId]);
  return rows.map(r=>({id:r.id,gameKey:r.game_key,status:r.status,creator:{id:r.creator_id,name:r.creator_name,avatarUrl:r.creator_avatar},targetUserId:r.target_user_id,targetUserName:r.target_user_name,targetOfficeGroupId:r.target_office_group_id,targetOfficeName:r.target_office_name,matchId:r.match_id,expiresAt:r.expires_at,createdAt:r.created_at}));
}
