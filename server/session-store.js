import session from 'express-session';
import { pool } from './db.js';
class MySqlSessionStore extends session.Store{
  constructor(){super();this.timer=setInterval(()=>this.prune().catch(()=>{}),15*60_000);this.timer.unref?.();}
  get(sid,cb){pool.query('SELECT data,expires_at FROM user_sessions WHERE session_id=$1 AND expires_at>UTC_TIMESTAMP()',[sid]).then(({rows})=>{if(!rows[0])return cb(null,null);try{cb(null,JSON.parse(rows[0].data));}catch(e){cb(e);}}).catch(cb);}
  set(sid,value,cb=()=>{}){const expires=value?.cookie?.expires?new Date(value.cookie.expires):new Date(Date.now()+(value?.cookie?.maxAge||8*60*60_000));pool.query(`INSERT INTO user_sessions(session_id,expires_at,data) VALUES($1,$2,$3) ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at),data=VALUES(data)`,[sid,expires,JSON.stringify(value)]).then(()=>cb()).catch(cb);}
  destroy(sid,cb=()=>{}){pool.query('DELETE FROM user_sessions WHERE session_id=$1',[sid]).then(()=>cb()).catch(cb);}
  touch(sid,value,cb=()=>{}){const expires=value?.cookie?.expires?new Date(value.cookie.expires):new Date(Date.now()+(value?.cookie?.maxAge||8*60*60_000));pool.query('UPDATE user_sessions SET expires_at=$2 WHERE session_id=$1',[sid,expires]).then(()=>cb()).catch(cb);}
  async prune(){await pool.query('DELETE FROM user_sessions WHERE expires_at<=UTC_TIMESTAMP()');}
}
export function createSessionStore(){return new MySqlSessionStore();}
