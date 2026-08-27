import crypto from 'node:crypto';
import express from 'express';
import { pool, withTransaction, audit } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin, csrf, rateLimit } from '../middleware/auth.js';
import { allGameMap } from '../catalog.js';
import { games } from '../games/index.js';

const router=express.Router();
const AI_ID='00000000-0000-0000-0000-000000000000';
const TOKEN_TTL_SECONDS=5*60;
const TEST_SPECS=[
  {id:'8b0b8804-d29b-44f3-8a72-1b4ae8807b8a',local:'test1x84u',name:'Test User 1'},
  {id:'a1640c1c-a075-4f0d-8d8c-42fdfded664c',local:'test2x84u',name:'Test User 2'}
];
const TEST_USER_IDS=new Set();
const hashToken=token=>crypto.createHash('sha256').update(String(token)).digest('hex');
const csrfValue=()=>crypto.randomBytes(32).toString('base64url');

export async function ensureTestUsers(){
  const {rows:cols}=await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='is_test'");
  if(cols.length===0)await pool.query('ALTER TABLE users ADD COLUMN is_test TINYINT(1) NOT NULL DEFAULT 0 AFTER status');
  await pool.query(`CREATE TABLE IF NOT EXISTS test_login_tokens(
    token_hash CHAR(64) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    created_by CHAR(36) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX test_login_expiry_idx(expires_at),
    INDEX test_login_user_idx(user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  TEST_USER_IDS.clear();
  for(const spec of TEST_SPECS){
    const email=`${spec.local}@${config.hostedDomain}`;
    const existing=(await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1',[email])).rows[0];
    const id=existing?.id||spec.id;
    if(existing){
      await pool.query("UPDATE users SET display_name=$2,role='user',status='active',is_test=1 WHERE id=$1",[id,spec.name]);
    }else{
      await pool.query(`INSERT INTO users(id,google_sub,email,display_name,role,status,is_test,last_login_at)
        VALUES($1,$2,$3,$4,'user','active',1,UTC_TIMESTAMP())`,[id,`__qgt_test__${spec.local}`,email,spec.name]);
    }
    TEST_USER_IDS.add(String(id));
  }
  await pool.query('DELETE FROM test_login_tokens WHERE expires_at<UTC_TIMESTAMP()-INTERVAL 1 DAY OR used_at IS NOT NULL');
}

async function viewerMode(req){
  const row=(await pool.query('SELECT role,is_test FROM users WHERE id=$1',[req.session.userId])).rows[0];
  if(row?.role==='admin')return 'admin';
  if(Number(row?.is_test)===1&&req.session?.testSession===true)return 'test';
  return 'normal';
}
function visibilitySql(mode,alias='u'){
  if(mode==='admin')return '1=1';
  if(mode==='test')return `${alias}.is_test=1`;
  return `${alias}.is_test=0`;
}

router.get('/chat',requireAuth,async(req,res)=>{
  const mode=await viewerMode(req),where=visibilitySql(mode,'u');
  const {rows}=await pool.query(`SELECT c.id,c.message,c.created_at,u.id user_id,u.display_name,u.avatar_url,o.name office_name
    FROM chat_messages c JOIN users u ON u.id=c.user_id LEFT JOIN office_groups o ON o.id=u.office_group_id
    WHERE c.deleted_at IS NULL AND ${where} ORDER BY c.id DESC LIMIT 70`);
  res.json({messages:rows.reverse().map(r=>({id:r.id,message:r.message,createdAt:r.created_at,user:{id:r.user_id,name:r.display_name,avatarUrl:r.avatar_url,officeName:r.office_name}}))});
});

router.get('/lobby/users',requireAuth,async(req,res)=>{
  const mode=await viewerMode(req),where=visibilitySql(mode,'u');
  const {rows}=await pool.query(`SELECT u.id,u.display_name,u.avatar_url,u.office_group_id,o.name office_name,u.xp,u.points
    FROM users u LEFT JOIN office_groups o ON o.id=u.office_group_id
    WHERE u.id<>$1 AND u.id<>$2 AND u.status='active' AND ${where}
    ORDER BY u.last_login_at DESC LIMIT 180`,[req.session.userId,AI_ID]);
  const presence=req.app.get('presence')||new Map();
  res.json({users:rows.map(r=>({id:r.id,name:r.display_name,avatarUrl:r.avatar_url,officeGroup:r.office_group_id?{id:r.office_group_id,name:r.office_name}:null,xp:Number(r.xp),points:Number(r.points),online:presence.has(r.id)}))});
});

router.get('/matchmaking/users',requireAuth,async(req,res)=>{
  const mode=await viewerMode(req),where=visibilitySql(mode,'u');
  const {rows}=await pool.query(`SELECT q.game_key,q.joined_at,u.id,u.display_name name,u.avatar_url
    FROM match_queue q JOIN users u ON u.id=q.user_id
    WHERE u.status='active' AND ${where} ORDER BY q.joined_at ASC LIMIT 30`);
  res.json({users:rows});
});

router.get('/leaderboards/offices',requireAuth,async(req,res)=>{
  const {rows}=await pool.query(`WITH participant_results AS (
    SELECT m.id,m.player1_id user_id,u1.office_group_id,CASE WHEN m.winner_id IS NULL THEN 1 WHEN m.winner_id=m.player1_id THEN 3 ELSE 0 END points,CASE WHEN m.winner_id=m.player1_id THEN 1 ELSE 0 END wins
    FROM matches m JOIN users u1 ON u1.id=m.player1_id JOIN users u2 ON u2.id=m.player2_id
    WHERE m.status='finished' AND u1.is_test=0 AND u2.is_test=0 AND u1.office_group_id IS NOT NULL AND u2.office_group_id IS NOT NULL AND u1.office_group_id<>u2.office_group_id
    UNION ALL
    SELECT m.id,m.player2_id,u2.office_group_id,CASE WHEN m.winner_id IS NULL THEN 1 WHEN m.winner_id=m.player2_id THEN 3 ELSE 0 END,CASE WHEN m.winner_id=m.player2_id THEN 1 ELSE 0 END
    FROM matches m JOIN users u1 ON u1.id=m.player1_id JOIN users u2 ON u2.id=m.player2_id
    WHERE m.status='finished' AND u1.is_test=0 AND u2.is_test=0 AND u1.office_group_id IS NOT NULL AND u2.office_group_id IS NOT NULL AND u1.office_group_id<>u2.office_group_id
  ) SELECT o.id,o.name,o.code,CAST(COALESCE(SUM(p.points),0) AS SIGNED) points,CAST(COUNT(p.id) AS SIGNED) matches,CAST(COALESCE(SUM(p.wins),0) AS SIGNED) wins
  FROM office_groups o LEFT JOIN participant_results p ON p.office_group_id=o.id GROUP BY o.id,o.name,o.code ORDER BY points DESC,wins DESC,o.name`);
  res.json({leaderboard:rows});
});

router.get('/leaderboards/progression',requireAuth,async(req,res)=>{
  const mode=await viewerMode(req),where=visibilitySql(mode,'u');
  const {rows}=await pool.query(`SELECT u.id,u.display_name name,u.avatar_url,o.name office_name,u.xp,u.points,u.total_games
    FROM users u LEFT JOIN office_groups o ON o.id=u.office_group_id
    WHERE u.status='active' AND u.id<>$1 AND ${where}
    ORDER BY u.xp DESC,u.points DESC LIMIT 100`,[AI_ID]);
  res.json({leaderboard:rows});
});

router.get('/leaderboards/users',requireAuth,async(req,res)=>{
  const gameKey=String(req.query.gameKey||'').slice(0,40);
  if(!allGameMap.has(gameKey))return res.status(400).json({error:'BAD_GAME'});
  const cfg=(await pool.query('SELECT enabled,leaderboard_enabled FROM game_configs WHERE game_key=$1',[gameKey])).rows[0];
  if(!cfg?.enabled)return res.status(404).json({error:'GAME_DISABLED',message:'Game đang được admin ẩn.'});
  if(!cfg?.leaderboard_enabled)return res.status(404).json({error:'LEADERBOARD_DISABLED',message:'BXH của game đang tắt.'});
  const mode=await viewerMode(req),where=visibilitySql(mode,'u');
  if(games.has(gameKey)){
    const {rows}=await pool.query(`SELECT u.id,u.display_name name,u.avatar_url,o.name office_name,r.rating,r.played,r.wins,r.losses,r.draws
      FROM ratings r JOIN users u ON u.id=r.user_id LEFT JOIN office_groups o ON o.id=u.office_group_id
      WHERE r.game_key=$1 AND u.id<>$2 AND ${where} ORDER BY r.rating DESC,r.played DESC LIMIT 100`,[gameKey,AI_ID]);
    return res.json({type:'rating',leaderboard:rows});
  }
  const {rows}=await pool.query(`SELECT u.id,u.display_name name,u.avatar_url,o.name office_name,s.best_score,s.plays,s.last_score,s.updated_at
    FROM game_scores s JOIN users u ON u.id=s.user_id LEFT JOIN office_groups o ON o.id=u.office_group_id
    WHERE s.game_key=$1 AND u.id<>$2 AND ${where} ORDER BY s.best_score DESC,s.updated_at ASC LIMIT 100`,[gameKey,AI_ID]);
  res.json({type:'score',leaderboard:rows});
});

router.get('/test-session/state',requireAuth,async(req,res)=>{
  const user=(await pool.query('SELECT id,email,display_name,role,is_test FROM users WHERE id=$1',[req.session.userId])).rows[0];
  res.json({
    isTestSession:Boolean(req.session?.testSession&&Number(user?.is_test)===1),
    isTestUser:Number(user?.is_test)===1,
    timeZone:config.timezone,
    user:user?{id:user.id,email:user.email,name:user.display_name,role:user.role}:null
  });
});

router.get('/admin/test-users',requireAdmin,async(req,res)=>{
  const {rows}=await pool.query("SELECT id,email,display_name name,status,xp,points,total_games,last_login_at FROM users WHERE is_test=1 ORDER BY email");
  res.json({users:rows.map(r=>({...r,xp:Number(r.xp),points:Number(r.points),totalGames:Number(r.total_games)})),timeZone:config.timezone});
});

router.post('/admin/test-users/:id/login-link',requireAdmin,csrf,rateLimit({prefix:'test-login-link',limit:20,windowSeconds:300,keyFn:req=>req.session.userId}),async(req,res)=>{
  const id=String(req.params.id||'');
  const user=(await pool.query("SELECT id,email,display_name FROM users WHERE id=$1 AND is_test=1 AND status='active'",[id])).rows[0];
  if(!user)return res.status(404).json({error:'TEST_USER_NOT_FOUND',message:'Không tìm thấy test user.'});
  const token=crypto.randomBytes(32).toString('base64url'),tokenHash=hashToken(token);
  await pool.query('DELETE FROM test_login_tokens WHERE expires_at<UTC_TIMESTAMP() OR used_at IS NOT NULL');
  await pool.query(`INSERT INTO test_login_tokens(token_hash,user_id,created_by,expires_at)
    VALUES($1,$2,$3,UTC_TIMESTAMP()+INTERVAL ${TOKEN_TTL_SECONDS} SECOND)`,[tokenHash,user.id,req.session.userId]);
  await audit(req.session.userId,'admin.test_user.login_link',user.id,{email:user.email,ttlSeconds:TOKEN_TTL_SECONDS});
  res.json({user:{id:user.id,email:user.email,name:user.display_name},loginUrl:`${config.appOrigin}/auth/test-login?token=${encodeURIComponent(token)}`,expiresInSeconds:TOKEN_TTL_SECONDS});
});

export async function handleTestLogin(req,res,next){
  try{
    const raw=String(req.query.token||'');
    if(raw.length<30||raw.length>200)return res.status(400).send('Link test không hợp lệ.');
    const tokenHash=hashToken(raw);
    const accepted=await withTransaction(async client=>{
      const token=(await client.query('SELECT * FROM test_login_tokens WHERE token_hash=$1 FOR UPDATE',[tokenHash])).rows[0];
      if(!token||token.used_at||new Date(token.expires_at).getTime()<=Date.now())return null;
      const user=(await client.query("SELECT id,email,display_name,role,status,is_test FROM users WHERE id=$1 AND is_test=1",[token.user_id])).rows[0];
      if(!user||user.status!=='active')return null;
      await client.query('UPDATE test_login_tokens SET used_at=UTC_TIMESTAMP() WHERE token_hash=$1',[tokenHash]);
      await client.query('UPDATE users SET last_login_at=UTC_TIMESTAMP() WHERE id=$1',[user.id]);
      return {user,createdBy:token.created_by};
    });
    if(!accepted)return res.status(410).send('Link test đã hết hạn hoặc đã được sử dụng. Hãy tạo link mới trong Admin.');
    await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));
    req.session.userId=accepted.user.id;
    req.session.role='user';
    req.session.csrfToken=csrfValue();
    req.session.testSession=true;
    req.session.testSessionCreatedBy=accepted.createdBy;
    await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
    await audit(accepted.createdBy,'admin.test_user.login_used',accepted.user.id,{email:accepted.user.email,ip:req.ip});
    res.redirect('/');
  }catch(error){next(error);}
}

export function installTestEventGuard(io){
  const originalEmit=io.emit.bind(io);
  io.emit=(event,...args)=>{
    if(event==='arena:result'){
      const players=args?.[0]?.result?.players||[];
      if(players.some(p=>TEST_USER_IDS.has(String(p?.id))))return false;
    }
    if(event==='chat:new'){
      const id=args?.[0]?.message?.user?.id;
      if(id&&TEST_USER_IDS.has(String(id)))return false;
    }
    return originalEmit(event,...args);
  };
}

export default router;
