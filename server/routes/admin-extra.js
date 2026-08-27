import express from 'express';
import { z } from 'zod';
import { pool, withTransaction, audit } from '../db.js';
import { requireAdmin, csrf, rateLimit } from '../middleware/auth.js';
import { getProfileProgress } from '../services/rewards.js';

const router=express.Router();
const uuid=z.string().uuid();
const bulkChatSchema=z.object({ids:z.array(z.coerce.number().int().positive()).min(1).max(100)}).strict();
const resetSchema=z.object({confirm:z.literal('RESET'),reason:z.string().trim().min(5).max(200).optional()}).strict();
let migrationReady=false;

export async function ensureAdminExtraMigrations(){
  if(migrationReady)return;
  const {rows}=await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='progress_reset_at'");
  if(rows.length===0)await pool.query('ALTER TABLE users ADD COLUMN progress_reset_at DATETIME NULL AFTER last_chat_at');
  migrationReady=true;
}

router.use(rateLimit({prefix:'admin-extra',limit:120,windowSeconds:60,keyFn:req=>req.session?.userId||req.ip}));

router.post('/admin/chat/bulk-delete',requireAdmin,csrf,async(req,res)=>{
  const parsed=bulkChatSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'VALIDATION_ERROR',message:'Danh sách chat không hợp lệ.'});
  const ids=[...new Set(parsed.data.ids)];
  const selectPlaceholders=ids.map((_,i)=>`$${i+1}`).join(',');
  const active=(await pool.query(`SELECT id FROM chat_messages WHERE deleted_at IS NULL AND id IN (${selectPlaceholders})`,ids)).rows.map(r=>Number(r.id));
  if(!active.length)return res.json({deleted:[]});
  const updatePlaceholders=active.map((_,i)=>`$${i+2}`).join(',');
  await pool.query(`UPDATE chat_messages SET deleted_at=UTC_TIMESTAMP(),deleted_by=$1 WHERE deleted_at IS NULL AND id IN (${updatePlaceholders})`,[req.session.userId,...active]);
  await audit(req.session.userId,'admin.chat.bulk_delete',null,{count:active.length,ids:active});
  const io=req.app.get('io');
  for(const id of active)io?.emit('chat:deleted',{id});
  res.json({deleted:active});
});

router.post('/admin/users/:id/reset-progress',requireAdmin,csrf,async(req,res)=>{
  await ensureAdminExtraMigrations();
  const idResult=uuid.safeParse(req.params.id);
  if(!idResult.success)return res.status(400).json({error:'VALIDATION_ERROR',message:'User ID không hợp lệ.'});
  const bodyResult=resetSchema.safeParse(req.body);
  if(!bodyResult.success)return res.status(400).json({error:'RESET_CONFIRM_REQUIRED',message:'Phải xác nhận RESET trước khi xóa dữ liệu tiến trình.'});
  const id=idResult.data;
  const activeMatch=await pool.query("SELECT id FROM matches WHERE status='active' AND (player1_id=$1 OR player2_id=$1) LIMIT 1",[id]);
  if(activeMatch.rowCount)return res.status(409).json({error:'USER_HAS_ACTIVE_MATCH',message:'User đang có trận chưa kết thúc. Hãy kết thúc/đầu hàng trận đó trước khi reset.'});

  const target=await withTransaction(async client=>{
    const user=(await client.query('SELECT id,display_name,email FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!user)return null;
    await client.query('DELETE FROM match_queue WHERE user_id=$1',[id]);
    await client.query("UPDATE challenges SET status='cancelled' WHERE status='pending' AND (creator_id=$1 OR target_user_id=$1)",[id]);
    await client.query('DELETE FROM ratings WHERE user_id=$1',[id]);
    await client.query('DELETE FROM game_scores WHERE user_id=$1',[id]);
    await client.query('DELETE FROM reward_events WHERE user_id=$1',[id]);
    await client.query('DELETE FROM user_achievements WHERE user_id=$1',[id]);
    await client.query('DELETE FROM solo_runs WHERE user_id=$1',[id]);
    await client.query('UPDATE users SET xp=0,points=0,total_games=0,last_chat_at=NULL,progress_reset_at=UTC_TIMESTAMP() WHERE id=$1',[id]);
    return user;
  });
  if(!target)return res.status(404).json({error:'USER_NOT_FOUND',message:'Không tìm thấy user.'});

  await audit(req.session.userId,'admin.user.reset_progress',id,{reason:bodyResult.data.reason||'Admin reset toàn bộ progression'});
  const progress=await getProfileProgress(id);
  req.app.get('io')?.to(`user:${id}`).emit('progress:update',{progress,achievements:[]});
  res.json({ok:true,user:{id:target.id,name:target.display_name,email:target.email},progress});
});

export default router;
