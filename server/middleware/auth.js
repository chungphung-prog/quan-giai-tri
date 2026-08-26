import crypto from 'node:crypto';
import { config } from '../config.js';
import { fixedWindowLimit } from '../rate-limit.js';
import { pool } from '../db.js';
import { getPlayStatus } from '../services/site.js';
export function requireAuth(req,res,next){if(!req.session?.userId)return res.status(401).json({error:'AUTH_REQUIRED'});next();}
export async function requireAdmin(req,res,next){try{if(!req.session?.userId)return res.status(401).json({error:'AUTH_REQUIRED'});const {rows}=await pool.query("SELECT role,status FROM users WHERE id=$1",[req.session.userId]);if(rows[0]?.status!=='active')return res.status(403).json({error:'ACCOUNT_SUSPENDED'});if(rows[0]?.role!=='admin')return res.status(403).json({error:'ADMIN_REQUIRED'});next();}catch(error){next(error);}}
export async function requirePlayOpen(req,res,next){try{const {rows}=await pool.query('SELECT role,status FROM users WHERE id=$1',[req.session.userId]);if(rows[0]?.status!=='active')return res.status(403).json({error:'ACCOUNT_SUSPENDED'});if(rows[0]?.role==='admin')return next();const status=await getPlayStatus();if(!status.open)return res.status(423).json({error:'PLAY_CLOSED',message:status.message,status});next();}catch(error){next(error);}}
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
export function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();if(req.get('origin')!==config.appOrigin)return res.status(403).json({error:'BAD_ORIGIN'});if(!safeEqual(req.get('x-csrf-token'),req.session?.csrfToken))return res.status(403).json({error:'BAD_CSRF'});next();}
export function rateLimit({prefix,limit,windowSeconds,keyFn=(req)=>req.ip}){return async(req,res,next)=>{try{const raw=String(keyFn(req)||'unknown').slice(0,180);const result=await fixedWindowLimit(`rl:${prefix}:${raw}`,limit,windowSeconds);res.setHeader('RateLimit-Limit',String(limit));if(!result.allowed)return res.status(429).json({error:'RATE_LIMITED'});next();}catch(error){next(error);}};}
