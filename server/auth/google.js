import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { pool, audit } from '../db.js';

const oauth = new OAuth2Client(config.googleClientId,config.googleClientSecret,config.googleRedirectUri);
const b64url=(buf)=>buf.toString('base64url');
const challenge=(verifier)=>b64url(crypto.createHash('sha256').update(verifier).digest());
const safeEqual=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);};

export function startGoogle(req,res){
  const state=b64url(crypto.randomBytes(32));
  const nonce=b64url(crypto.randomBytes(32));
  const codeVerifier=b64url(crypto.randomBytes(48));
  req.session.oauthTx={state,nonce,codeVerifier,createdAt:Date.now()};
  const url=oauth.generateAuthUrl({
    access_type:'online',
    scope:['openid','email','profile'],
    include_granted_scopes:false,
    prompt:'select_account',
    hd:config.hostedDomain,
    state,
    nonce,
    code_challenge:challenge(codeVerifier),
    code_challenge_method:'S256'
  });
  res.redirect(url);
}

export async function googleCallback(req,res,next){
  try{
    if(req.query.error)return res.redirect('/?auth=cancelled');
    const tx=req.session.oauthTx;
    delete req.session.oauthTx;
    if(!tx||Date.now()-tx.createdAt>config.oauthTransactionMaxAgeMs||!safeEqual(String(req.query.state||''),tx.state)){
      await audit(null,'auth.google.state_rejected',null,{ip:req.ip});
      return res.status(400).send('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
    const code=String(req.query.code||'');
    if(!code)return res.status(400).send('Thiếu authorization code.');
    const {tokens}=await oauth.getToken({code,codeVerifier:tx.codeVerifier,redirect_uri:config.googleRedirectUri});
    if(!tokens.id_token)throw new Error('Google did not return an ID token');
    const ticket=await oauth.verifyIdToken({idToken:tokens.id_token,audience:config.googleClientId});
    const payload=ticket.getPayload();
    if(!payload)throw new Error('Missing Google token payload');
    const email=String(payload.email||'').toLowerCase();
    const hd=String(payload.hd||'').toLowerCase();
    if(payload.nonce!==tx.nonce)throw new Error('Google nonce mismatch');
    if(payload.email_verified!==true||hd!==config.hostedDomain||!email.endsWith(`@${config.hostedDomain}`)){
      await audit(null,'auth.google.domain_rejected',null,{emailDomain:email.split('@')[1]||'',hostedDomain:hd,ip:req.ip});
      return res.status(403).send(`Chỉ tài khoản Google Workspace @${config.hostedDomain} được phép đăng nhập.`);
    }
    const googleSub=String(payload.sub||'');
    if(!googleSub)throw new Error('Missing Google sub');
    const displayName=String(payload.name||email.split('@')[0]).slice(0,120)||'NTQ Player';
    const avatar=typeof payload.picture==='string'&&payload.picture.startsWith('https://')?payload.picture.slice(0,1000):null;
    const role=config.adminEmails.has(email)?'admin':'user';
    const existing=(await pool.query('SELECT id FROM users WHERE google_sub=$1',[googleSub])).rows[0];
    const userId=existing?.id||crypto.randomUUID();
    await pool.query(`
      INSERT INTO users(id,google_sub,email,display_name,avatar_url,role,last_login_at)
      VALUES($1,$2,$3,$4,$5,$6,UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE email=VALUES(email),display_name=VALUES(display_name),avatar_url=VALUES(avatar_url),role=VALUES(role),last_login_at=UTC_TIMESTAMP()
    `,[userId,googleSub,email,displayName,avatar,role]);
    const user=(await pool.query('SELECT id,email,role,status FROM users WHERE google_sub=$1',[googleSub])).rows[0];
    if(user.status!=='active'){await audit(user.id,'auth.login.suspended',user.id,{ip:req.ip});return res.status(403).send('Tài khoản Quán Giải Trí của bạn đang bị tạm khóa.');}
    await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));
    req.session.userId=user.id;
    req.session.role=user.role;
    req.session.csrfToken=b64url(crypto.randomBytes(32));
    await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
    await audit(user.id,'auth.login.success',user.id,{ip:req.ip});
    res.redirect('/');
  }catch(error){next(error);}
}

export async function logout(req,res,next){
  try{
    const userId=req.session?.userId||null;
    if(userId)req.app.get('io')?.to(`user:${userId}`).disconnectSockets(true);
    await new Promise((resolve,reject)=>req.session.destroy(err=>err?reject(err):resolve()));
    if(userId)await audit(userId,'auth.logout',userId,{ip:req.ip});
    res.clearCookie(config.isProd?'__Host-qgt.sid':'qgt.sid',{path:'/'});
    res.status(204).end();
  }catch(error){next(error);}
}
