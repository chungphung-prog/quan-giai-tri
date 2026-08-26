import crypto from 'node:crypto';
import { pool } from './db.js';
export function hashRateKey(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
export async function fixedWindowLimit(key,limit,windowSeconds){
  const bucket=Math.floor(Date.now()/(windowSeconds*1000)),hashed=hashRateKey(`${key}:${bucket}`),expires=new Date((bucket+1)*windowSeconds*1000+60_000);
  await pool.query(`INSERT INTO rate_limit_buckets(key_hash,bucket,count,expires_at) VALUES($1,$2,1,$3) ON DUPLICATE KEY UPDATE count=count+1,expires_at=VALUES(expires_at)`,[hashed,bucket,expires]);
  const {rows}=await pool.query('SELECT count FROM rate_limit_buckets WHERE key_hash=$1 AND bucket=$2',[hashed,bucket]);
  if(Math.random()<0.01)pool.query('DELETE FROM rate_limit_buckets WHERE expires_at<UTC_TIMESTAMP()').catch(()=>{});
  const count=Number(rows[0]?.count||1);return {allowed:count<=limit,count,limit};
}
