import { pool } from '../db.js';

export const PROGRESSION_VERSION=2;
export const ECONOMY_V2={
  soloDailyXpCap:650,
  soloDailyPointCap:100,
  pvpWinXp:85,
  pvpLoseXp:22,
  pvpDrawXp:42,
  pvpWinPoints:16,
  pvpLosePoints:3,
  pvpDrawPoints:7
};

export const RANKS=[
  {key:'rookie',name:'Tân binh',minLevel:1,icon:'🌱'},
  {key:'recruit',name:'Lính mới',minLevel:5,icon:'🪖'},
  {key:'warrior',name:'Chiến binh',minLevel:10,icon:'⚔️'},
  {key:'elite',name:'Tinh anh',minLevel:20,icon:'🛡️'},
  {key:'expert',name:'Cao thủ',minLevel:35,icon:'🔥'},
  {key:'master',name:'Bậc thầy',minLevel:50,icon:'👑'},
  {key:'grandmaster',name:'Đại cao thủ',minLevel:70,icon:'💎'},
  {key:'legend',name:'Huyền thoại',minLevel:90,icon:'🌌'},
  {key:'supreme',name:'Tối thượng',minLevel:100,icon:'🏆'}
];

export function rankFromLevel(level){
  level=Math.max(1,Math.min(100,Number(level)||1));
  let rank=RANKS[0];
  for(const r of RANKS){if(level>=r.minLevel)rank=r;else break;}
  const idx=RANKS.indexOf(rank),next=RANKS[idx+1]||null;
  return {...rank,next:next?{...next}:null};
}

const a=(key,category,categoryOrder,tier,name,description,icon,xp,points,sort,test)=>({key,category,categoryOrder,tier,name,description,icon,xp,points,sort,test});

export const ACHIEVEMENTS=[
  // Tân binh
  a('first_game','Tân binh',1,'bronze','Chạm ngõ','Hoàn thành lượt chơi hợp lệ đầu tiên.','🎮',40,2,101,m=>m.totalGames>=1),
  a('first_pvp','Tân binh',1,'bronze','Ra đấu trường','Hoàn thành trận PvP với đồng nghiệp đầu tiên.','⚔️',50,3,102,m=>m.pvp>=1),
  a('first_solo','Tân binh',1,'bronze','Tự lực cánh sinh','Hoàn thành game solo đầu tiên.','🕹️',40,2,103,m=>m.solo>=1),
  a('first_win','Tân binh',1,'bronze','Khai trận','Giành chiến thắng đầu tiên.','🏅',70,5,104,m=>m.allWins>=1),
  a('first_chat','Tân binh',1,'bronze','Lên tiếng','Gửi tin nhắn đầu tiên trong phòng chung.','💬',25,1,105,m=>m.chats>=1),
  a('level_3','Tân binh',1,'bronze','Có số má','Đạt Level 3.','🌱',80,5,106,m=>m.level>=3),

  // Lính mới
  a('games_10','Lính mới',2,'bronze','Vào guồng','Hoàn thành 10 lượt chơi hợp lệ.','🔟',100,6,201,m=>m.totalGames>=10),
  a('wins_3','Lính mới',2,'bronze','Ba phát ăn ba','Thắng 3 trận PvP với người thật.','🎯',120,8,202,m=>m.pvpWins>=3),
  a('solo_10','Lính mới',2,'bronze','Tập luyện chăm chỉ','Hoàn thành 10 lượt solo.','🧩',90,5,203,m=>m.solo>=10),
  a('chat_25','Lính mới',2,'bronze','Cây hài văn phòng','Gửi 25 tin nhắn hợp lệ sau mốc reset gần nhất.','🗯️',70,4,204,m=>m.chats>=25),
  a('score_1000','Lính mới',2,'bronze','Bốn chữ số','Đạt best score từ 1.000 ở một game solo.','📈',120,8,205,m=>m.bestScore>=1000),
  a('level_5','Lính mới',2,'bronze','Lính mới chính hiệu','Đạt Level 5.','🪖',150,10,206,m=>m.level>=5),

  // Chiến binh
  a('games_25','Chiến binh',3,'silver','Không còn non tay','Hoàn thành 25 lượt chơi hợp lệ.','🧱',180,12,301,m=>m.totalGames>=25),
  a('pvp_10','Chiến binh',3,'silver','Đấu sĩ','Hoàn thành 10 trận PvP với người thật.','🛡️',220,14,302,m=>m.pvp>=10),
  a('wins_10','Chiến binh',3,'silver','Săn chiến thắng','Thắng 10 trận PvP với người thật.','🏹',250,18,303,m=>m.pvpWins>=10),
  a('streak_3','Chiến binh',3,'silver','Hat-trick','Thắng liên tiếp 3 trận PvP với người thật.','🔥',220,16,304,m=>m.winStreak>=3),
  a('score_5000','Chiến binh',3,'silver','Phá mốc 5K','Đạt best score từ 5.000 ở một game solo.','🚀',240,16,305,m=>m.bestScore>=5000),
  a('level_10','Chiến binh',3,'silver','Chiến binh thực thụ','Đạt Level 10.','⚔️',300,20,306,m=>m.level>=10),

  // Tinh anh
  a('games_50','Tinh anh',4,'silver','Nửa trăm trận','Hoàn thành 50 lượt chơi hợp lệ.','🎲',350,25,401,m=>m.totalGames>=50),
  a('pvp_25','Tinh anh',4,'silver','Kẻ thách đấu','Hoàn thành 25 trận PvP với người thật.','🥊',400,28,402,m=>m.pvp>=25),
  a('wins_20','Tinh anh',4,'silver','Sát thủ BXH','Thắng 20 trận PvP với người thật.','🗡️',450,32,403,m=>m.pvpWins>=20),
  a('solo_50','Tinh anh',4,'silver','Máy cày solo','Hoàn thành 50 lượt solo.','🎰',350,24,404,m=>m.solo>=50),
  a('score_25000','Tinh anh',4,'silver','Điểm số nổi bật','Đạt best score từ 25.000 ở một game solo.','💫',420,30,405,m=>m.bestScore>=25000),
  a('level_20','Tinh anh',4,'silver','Gia nhập tinh anh','Đạt Level 20.','🛡️',600,45,406,m=>m.level>=20),

  // Cao thủ
  a('games_100','Cao thủ',5,'gold','Trăm trận dày dạn','Hoàn thành 100 lượt chơi hợp lệ.','💯',700,55,501,m=>m.totalGames>=100),
  a('pvp_50','Cao thủ',5,'gold','Đấu trường là nhà','Hoàn thành 50 trận PvP với người thật.','🏟️',750,60,502,m=>m.pvp>=50),
  a('wins_40','Cao thủ',5,'gold','Kẻ chinh phục','Thắng 40 trận PvP với người thật.','🦅',850,70,503,m=>m.pvpWins>=40),
  a('streak_5','Cao thủ',5,'gold','Bất khả cản','Thắng liên tiếp 5 trận PvP với người thật.','⚡',700,55,504,m=>m.winStreak>=5),
  a('rating_1200','Cao thủ',5,'gold','ELO 1200','Đạt rating 1.200 ở ít nhất một game PvP.','📊',900,75,505,m=>m.maxRating>=1200),
  a('level_35','Cao thủ',5,'gold','Cao thủ văn phòng','Đạt Level 35.','🔥',1200,100,506,m=>m.level>=35),

  // Bậc thầy
  a('games_200','Bậc thầy',6,'gold','Hai trăm trận','Hoàn thành 200 lượt chơi hợp lệ.','🧠',1300,120,601,m=>m.totalGames>=200),
  a('pvp_100','Bậc thầy',6,'gold','Trăm trận PvP','Hoàn thành 100 trận PvP với người thật.','⚔️',1500,130,602,m=>m.pvp>=100),
  a('wins_75','Bậc thầy',6,'gold','75 chiến thắng','Thắng 75 trận PvP với người thật.','🏆',1700,150,603,m=>m.pvpWins>=75),
  a('rating_1400','Bậc thầy',6,'gold','ELO 1400','Đạt rating 1.400 ở ít nhất một game PvP.','📈',1800,160,604,m=>m.maxRating>=1400),
  a('score_100000','Bậc thầy',6,'gold','Sáu chữ số','Đạt best score từ 100.000 ở một game solo.','🌠',1600,140,605,m=>m.bestScore>=100000),
  a('level_50','Bậc thầy',6,'gold','Bậc thầy','Đạt Level 50.','👑',2200,200,606,m=>m.level>=50),

  // Đại cao thủ
  a('games_350','Đại cao thủ',7,'platinum','Kinh nghiệm đầy mình','Hoàn thành 350 lượt chơi hợp lệ.','💎',2500,220,701,m=>m.totalGames>=350),
  a('pvp_175','Đại cao thủ',7,'platinum','175 trận PvP','Hoàn thành 175 trận PvP với người thật.','🌀',2700,240,702,m=>m.pvp>=175),
  a('wins_125','Đại cao thủ',7,'platinum','125 chiến thắng','Thắng 125 trận PvP với người thật.','🦁',3000,275,703,m=>m.pvpWins>=125),
  a('rating_1600','Đại cao thủ',7,'platinum','ELO 1600','Đạt rating 1.600 ở ít nhất một game PvP.','💠',3200,300,704,m=>m.maxRating>=1600),
  a('level_70','Đại cao thủ',7,'platinum','Đại cao thủ','Đạt Level 70.','💎',3500,330,705,m=>m.level>=70),

  // Huyền thoại
  a('games_500','Huyền thoại',8,'platinum','Năm trăm trận','Hoàn thành 500 lượt chơi hợp lệ.','🌌',4000,400,801,m=>m.totalGames>=500),
  a('pvp_250','Huyền thoại',8,'platinum','250 trận PvP','Hoàn thành 250 trận PvP với người thật.','🌪️',4300,430,802,m=>m.pvp>=250),
  a('wins_200','Huyền thoại',8,'platinum','Hai trăm chiến thắng','Thắng 200 trận PvP với người thật.','🐉',4700,470,803,m=>m.pvpWins>=200),
  a('rating_1800','Huyền thoại',8,'platinum','ELO 1800','Đạt rating 1.800 ở ít nhất một game PvP.','✨',5000,500,804,m=>m.maxRating>=1800),
  a('level_90','Huyền thoại',8,'platinum','Huyền thoại sống','Đạt Level 90.','🌌',6000,600,805,m=>m.level>=90),

  // Tối thượng
  a('pvp_400','Tối thượng',9,'platinum','Bốn trăm trận PvP','Hoàn thành 400 trận PvP với người thật.','♾️',7000,700,901,m=>m.pvp>=400),
  a('wins_300','Tối thượng',9,'platinum','Ba trăm chiến thắng','Thắng 300 trận PvP với người thật.','👹',8000,800,902,m=>m.pvpWins>=300),
  a('rating_2000','Tối thượng',9,'platinum','ELO 2000','Chạm mốc rating 2.000 ở một game PvP.','🌟',9000,900,903,m=>m.maxRating>=2000),
  a('level_100','Tối thượng',9,'platinum','Tối thượng','Đạt Level 100 — đỉnh progression hiện tại.','🏆',10000,1000,904,m=>m.level>=100)
];

export function eligibleAchievementKeys(metrics){return ACHIEVEMENTS.filter(x=>x.test(metrics)).map(x=>x.key);}

let migrationReady=false;
export async function ensureProgressionV2(){
  if(migrationReady)return;
  const {rows:cols}=await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='achievement_defs' AND COLUMN_NAME IN ('category','category_order')");
  const names=new Set(cols.map(r=>r.COLUMN_NAME||r.column_name));
  if(!names.has('category'))await pool.query("ALTER TABLE achievement_defs ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'Tân binh' AFTER tier");
  if(!names.has('category_order'))await pool.query('ALTER TABLE achievement_defs ADD COLUMN category_order INT NOT NULL DEFAULT 0 AFTER category');

  for(const x of ACHIEVEMENTS){
    await pool.query(`INSERT INTO achievement_defs(achievement_key,name,description,icon,tier,category,category_order,xp_reward,point_reward,sort_order)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),icon=VALUES(icon),tier=VALUES(tier),category=VALUES(category),category_order=VALUES(category_order),xp_reward=VALUES(xp_reward),point_reward=VALUES(point_reward),sort_order=VALUES(sort_order)`,
      [x.key,x.name,x.description,x.icon,x.tier,x.category,x.categoryOrder,x.xp,x.points,x.sort]);
  }

  const versionRow=(await pool.query("SELECT value FROM site_settings WHERE setting_key='progression_v2'")).rows[0];
  const currentVersion=Number(versionRow?.value?.version||0);
  if(currentVersion<PROGRESSION_VERSION){
    const ecoRow=(await pool.query("SELECT value FROM site_settings WHERE setting_key='economy'")).rows[0];
    const economy={...(ecoRow?.value||{}),...ECONOMY_V2};
    await pool.query(`INSERT INTO site_settings(setting_key,value,updated_by,updated_at) VALUES('economy',$1,NULL,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=UTC_TIMESTAMP()`,[JSON.stringify(economy)]);
    await pool.query(`INSERT INTO site_settings(setting_key,value,updated_by,updated_at) VALUES('progression_v2',$1,NULL,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=UTC_TIMESTAMP()`,[JSON.stringify({version:PROGRESSION_VERSION,curve:'220*n^1.78 + 90*n',maxLevel:100,ranks:RANKS.map(({key,name,minLevel,icon})=>({key,name,minLevel,icon})),economy:ECONOMY_V2})]);
  }
  migrationReady=true;
}
