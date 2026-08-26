import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { config } from './config.js';
import { allGames } from './catalog.js';

const JSON_FIELDS=new Set(['state','action','value','client_meta','metadata','items']);
function hydrateRow(row){
  if(!row||typeof row!=='object')return row;
  for(const field of JSON_FIELDS){
    const value=row[field];
    if(typeof value==='string'&&(value.startsWith('{')||value.startsWith('['))){try{row[field]=JSON.parse(value);}catch{}}
  }
  return row;
}
function hydrateRows(rows){if(Array.isArray(rows))return rows.map(hydrateRow);return rows;}
function translate(sql,params=[]){
  const ordered=[];
  const text=String(sql).replace(/\$(\d+)/g,(_,n)=>{ordered.push(params[Number(n)-1]);return '?';});
  return {text,params:ordered};
}
function wrapExecutor(executor){
  return {
    async query(sql,params=[]){
      const q=translate(sql,params);
      const [raw]=await executor.query(q.text,q.params);
      if(Array.isArray(raw)){const rows=hydrateRows(raw);return {rows,rowCount:rows.length};}
      return {rows:[],rowCount:Number(raw.affectedRows||0),insertId:raw.insertId,affectedRows:Number(raw.affectedRows||0)};
    }
  };
}

const mysqlPool=mysql.createPool({
  host:config.dbHost,port:config.dbPort,user:config.dbUser,password:config.dbPassword,database:config.dbName,
  waitForConnections:true,connectionLimit:config.dbPoolSize,queueLimit:0,charset:'utf8mb4',timezone:'Z',
  supportBigNumbers:true,bigNumberStrings:true,enableKeepAlive:true,keepAliveInitialDelay:0
});
export const pool={...wrapExecutor(mysqlPool),async end(){await mysqlPool.end();},async ping(){const c=await mysqlPool.getConnection();try{await c.ping();}finally{c.release();}}};

export async function withTransaction(fn){
  const conn=await mysqlPool.getConnection();
  const client=wrapExecutor(conn);
  try{
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const result=await fn(client);
    await conn.commit();
    return result;
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{conn.release();}
}

const schema=[
`CREATE TABLE IF NOT EXISTS office_groups(
  id CHAR(36) PRIMARY KEY,name VARCHAR(80) NOT NULL UNIQUE,code VARCHAR(24) NOT NULL UNIQUE,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS users(
  id CHAR(36) PRIMARY KEY,google_sub VARCHAR(255) NOT NULL UNIQUE,email VARCHAR(320) NOT NULL UNIQUE,display_name VARCHAR(120) NOT NULL,avatar_url VARCHAR(1000),
  role ENUM('user','admin') NOT NULL DEFAULT 'user',status ENUM('active','suspended') NOT NULL DEFAULT 'active',office_group_id CHAR(36),
  xp BIGINT UNSIGNED NOT NULL DEFAULT 0,points BIGINT UNSIGNED NOT NULL DEFAULT 0,total_games INT UNSIGNED NOT NULL DEFAULT 0,last_chat_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,last_login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX users_office_group_idx(office_group_id),CONSTRAINT fk_users_office FOREIGN KEY(office_group_id) REFERENCES office_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS matches(
  id CHAR(36) PRIMARY KEY,game_key VARCHAR(40) NOT NULL,player1_id CHAR(36) NOT NULL,player2_id CHAR(36) NOT NULL,state LONGTEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 0,status ENUM('active','finished','abandoned') NOT NULL DEFAULT 'active',winner_id CHAR(36) NULL,
  is_ai TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,finished_at DATETIME NULL,
  INDEX matches_players_idx(player1_id,player2_id,created_at),INDEX matches_status_idx(status,created_at),
  CONSTRAINT fk_match_p1 FOREIGN KEY(player1_id) REFERENCES users(id),CONSTRAINT fk_match_p2 FOREIGN KEY(player2_id) REFERENCES users(id),CONSTRAINT fk_match_winner FOREIGN KEY(winner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS match_events(
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,match_id CHAR(36) NOT NULL,version INT UNSIGNED NOT NULL,actor_id CHAR(36) NOT NULL,
  client_action_id VARCHAR(80) NOT NULL,action_type VARCHAR(40) NOT NULL,action LONGTEXT NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_match_version(match_id,version),UNIQUE KEY uq_match_action(match_id,actor_id,client_action_id),
  CONSTRAINT fk_event_match FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,CONSTRAINT fk_event_actor FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS ratings(
  user_id CHAR(36) NOT NULL,game_key VARCHAR(40) NOT NULL,rating INT NOT NULL DEFAULT 1000,played INT UNSIGNED NOT NULL DEFAULT 0,wins INT UNSIGNED NOT NULL DEFAULT 0,
  losses INT UNSIGNED NOT NULL DEFAULT 0,draws INT UNSIGNED NOT NULL DEFAULT 0,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,game_key),CONSTRAINT fk_rating_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS challenges(
  id CHAR(36) PRIMARY KEY,creator_id CHAR(36) NOT NULL,target_user_id CHAR(36) NULL,target_office_group_id CHAR(36) NULL,game_key VARCHAR(40) NOT NULL,
  status ENUM('pending','accepted','declined','cancelled','expired') NOT NULL DEFAULT 'pending',match_id CHAR(36) NULL,expires_at DATETIME NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX challenges_target_user_idx(target_user_id,status,expires_at),INDEX challenges_target_office_idx(target_office_group_id,status,expires_at),
  CONSTRAINT fk_challenge_creator FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE CASCADE,CONSTRAINT fk_challenge_user FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_office FOREIGN KEY(target_office_group_id) REFERENCES office_groups(id) ON DELETE CASCADE,CONSTRAINT fk_challenge_match FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS site_settings(
  setting_key VARCHAR(80) PRIMARY KEY,value LONGTEXT NOT NULL,updated_by CHAR(36) NULL,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_setting_user FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS game_configs(
  game_key VARCHAR(40) PRIMARY KEY,enabled TINYINT(1) NOT NULL DEFAULT 1,leaderboard_enabled TINYINT(1) NOT NULL DEFAULT 1,xp_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1,
  point_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1,ai_difficulty ENUM('hard','nightmare','impossible') NOT NULL DEFAULT 'nightmare',speed_start DECIMAL(7,3) NOT NULL DEFAULT 1,
  speed_max DECIMAL(7,3) NOT NULL DEFAULT 2.8,score_cap INT UNSIGNED NOT NULL DEFAULT 100000,min_run_seconds INT UNSIGNED NOT NULL DEFAULT 2,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS solo_runs(
  id CHAR(36) PRIMARY KEY,user_id CHAR(36) NOT NULL,game_key VARCHAR(40) NOT NULL,nonce VARCHAR(96) NOT NULL UNIQUE,seed BIGINT NOT NULL,started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,finished_at DATETIME NULL,submitted_score INT NULL,status ENUM('active','finished','rejected','expired') NOT NULL DEFAULT 'active',client_meta LONGTEXT NOT NULL,
  INDEX solo_runs_user_game_idx(user_id,game_key,started_at),CONSTRAINT fk_solo_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS game_scores(
  user_id CHAR(36) NOT NULL,game_key VARCHAR(40) NOT NULL,best_score INT NOT NULL DEFAULT 0,plays INT UNSIGNED NOT NULL DEFAULT 0,last_score INT NOT NULL DEFAULT 0,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,game_key),INDEX game_scores_rank_idx(game_key,best_score,updated_at),CONSTRAINT fk_score_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS reward_events(
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id CHAR(36) NOT NULL,source_type VARCHAR(40) NOT NULL,source_id VARCHAR(80) NOT NULL,xp INT NOT NULL,points INT NOT NULL,
  metadata LONGTEXT NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_reward_source(user_id,source_type,source_id),INDEX reward_events_user_idx(user_id,created_at),
  CONSTRAINT fk_reward_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS achievement_defs(
  achievement_key VARCHAR(80) PRIMARY KEY,name VARCHAR(120) NOT NULL,description VARCHAR(500) NOT NULL,icon VARCHAR(32) NOT NULL,tier ENUM('bronze','silver','gold','platinum') NOT NULL DEFAULT 'bronze',
  xp_reward INT NOT NULL DEFAULT 0,point_reward INT NOT NULL DEFAULT 0,sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS user_achievements(
  user_id CHAR(36) NOT NULL,achievement_key VARCHAR(80) NOT NULL,unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,achievement_key),
  CONSTRAINT fk_user_achievement_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,CONSTRAINT fk_user_achievement_def FOREIGN KEY(achievement_key) REFERENCES achievement_defs(achievement_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS chat_messages(
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id CHAR(36) NOT NULL,message VARCHAR(300) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at DATETIME NULL,deleted_by CHAR(36) NULL,
  INDEX chat_messages_recent_idx(deleted_at,created_at),CONSTRAINT fk_chat_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,CONSTRAINT fk_chat_deleted_by FOREIGN KEY(deleted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS releases(
  id CHAR(36) PRIMARY KEY,version VARCHAR(30) NOT NULL,title VARCHAR(120) NOT NULL,body TEXT NOT NULL,items LONGTEXT NOT NULL,release_date DATE NOT NULL,created_by CHAR(36) NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX releases_date_idx(release_date,created_at),CONSTRAINT fk_release_user FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS match_queue(
  user_id CHAR(36) PRIMARY KEY,game_key VARCHAR(40) NOT NULL,joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX match_queue_game_idx(game_key,joined_at),
  CONSTRAINT fk_queue_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS rate_limit_buckets(
  key_hash CHAR(64) NOT NULL,bucket BIGINT NOT NULL,count INT UNSIGNED NOT NULL DEFAULT 0,expires_at DATETIME NOT NULL,PRIMARY KEY(key_hash,bucket),INDEX rate_limit_expiry_idx(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS audit_log(
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,actor_id CHAR(36) NULL,event_type VARCHAR(80) NOT NULL,target_id VARCHAR(255) NULL,metadata LONGTEXT NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX audit_log_created_idx(created_at),CONSTRAINT fk_audit_actor FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS user_sessions(
  session_id VARCHAR(128) PRIMARY KEY,expires_at DATETIME NOT NULL,data LONGTEXT NOT NULL,INDEX user_sessions_expiry_idx(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

export async function initDb(){
  await pool.ping();
  for(const statement of schema)await pool.query(statement);
  // Migrations — add columns that may not exist in older installs
  const {rows:matchCols}=await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='matches' AND COLUMN_NAME='is_ai'");
  if(matchCols.length===0)await pool.query("ALTER TABLE matches ADD COLUMN is_ai TINYINT(1) NOT NULL DEFAULT 0 AFTER winner_id");
  const defaultSettings={
    branding:{siteName:'Quán Giải Trí',tagline:'Xả stress đúng giờ, đấu hết mình.',heroImage:'https://images.unsplash.com/photo-1700085664050-43cea0e1c3fd?auto=format&fit=crop&fm=jpg&ixlib=rb-4.1.0&q=80&w=1800',secondaryImage:'https://images.unsplash.com/photo-1696360172919-f7fdaaa78a92?auto=format&fit=crop&fm=jpg&ixlib=rb-4.1.0&q=80&w=1800',backgroundImage:'https://images.unsplash.com/photo-1696360172919-f7fdaaa78a92?auto=format&fit=crop&fm=jpg&ixlib=rb-4.1.0&q=80&w=1800',ambientSound:'',gameSound:'',musicVolume:30,sfxVolume:60,announcement:'Chào mừng đến Quán Giải Trí!'},
    playSchedule:{timezone:config.timezone,enabled:true,windows:[{label:'Nghỉ trưa',start:'12:00',end:'13:15',days:[0,1,2,3,4,5,6]},{label:'Ngoài giờ',start:'17:45',end:'08:00',days:[0,1,2,3,4,5,6]}]},
    economy:{soloDailyXpCap:1800,soloDailyPointCap:400,pvpWinXp:120,pvpLoseXp:60,pvpDrawXp:75,pvpWinPoints:35,pvpLosePoints:10,pvpDrawPoints:18},
    chat:{cooldownSeconds:5,maxLength:300},security:{soloLeaderboardLabel:'Run-guarded',publicMatchResults:true}
  };
  for(const [key,value] of Object.entries(defaultSettings))await pool.query('INSERT IGNORE INTO site_settings(setting_key,value) VALUES($1,$2)',[key,JSON.stringify(value)]);
  for(const g of allGames)await pool.query(`INSERT IGNORE INTO game_configs(game_key,ai_difficulty,speed_start,speed_max,score_cap,min_run_seconds) VALUES($1,'nightmare',$2,$3,$4,$5)`,[g.key,1,g.speedGame?3.4:2.2,100000,g.speedGame?5:2]);
  const achievements=[
    ['first_game','Tân Binh','Hoàn thành lượt chơi đầu tiên.','🎮','bronze',50,10,10],['first_win','Khai Trận','Thắng trận PvP đầu tiên.','⚔️','bronze',100,20,20],['pvp_10','Đấu Sĩ','Hoàn thành 10 trận PvP.','🛡️','silver',200,40,30],['level_5','Lên Hạng','Đạt Level 5.','⭐','silver',250,50,40],['level_10','Veteran','Đạt Level 10.','🌟','gold',500,100,50],['score_1000','Phá Mốc 1K','Đạt ít nhất 1.000 điểm trong một game.','🔥','gold',300,60,60],['chat_25','Dân Sảnh','Gửi 25 tin nhắn hợp lệ.','💬','silver',120,20,70],['pvp_50','Chiến Binh Văn Phòng','Hoàn thành 50 trận PvP.','🏆','platinum',1000,250,80]
  ];
  for(const a of achievements)await pool.query(`INSERT INTO achievement_defs(achievement_key,name,description,icon,tier,xp_reward,point_reward,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),icon=VALUES(icon),tier=VALUES(tier),xp_reward=VALUES(xp_reward),point_reward=VALUES(point_reward),sort_order=VALUES(sort_order)`,a);
  const {rows}=await pool.query('SELECT COUNT(*) n FROM releases');
  if(Number(rows[0]?.n||0)===0){const id=crypto.randomUUID();await pool.query(`INSERT INTO releases(id,version,title,body,items,release_date) VALUES($1,'v4.1-mysql','Quán Giải Trí lên sóng','Nâng cấp toàn diện UI, realtime social và hệ thống tiến trình.',$2,CURRENT_DATE)`,[id,JSON.stringify(['Đổi backend sang MySQL/MariaDB cho cPanel','Chat chung cooldown 5 giây','Online presence + matchmaking PvP','XP / Point / Level / Achievement','Release feed và Admin Console','Khung giờ chơi do admin cấu hình'])]);}
}
export async function audit(actorId,eventType,targetId=null,metadata={}){const safe={...metadata};delete safe.token;delete safe.sessionId;delete safe.credential;await pool.query('INSERT INTO audit_log(actor_id,event_type,target_id,metadata) VALUES($1,$2,$3,$4)',[actorId||null,eventType,targetId,JSON.stringify(safe)]);}
