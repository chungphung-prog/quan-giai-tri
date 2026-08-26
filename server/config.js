import 'dotenv/config';
const required=(name,fallback=undefined)=>{const value=process.env[name]??fallback;if(value==null||value==='')throw new Error(`Missing required environment variable: ${name}`);return value;};
const int=(name,fallback)=>{const value=Number(process.env[name]??fallback);if(!Number.isInteger(value))throw new Error(`${name} must be an integer`);return value;};
const nodeEnv=process.env.NODE_ENV||'development',isProd=nodeEnv==='production';
const appOrigin=required('APP_ORIGIN','http://localhost:3000').replace(/\/$/,'');
const hostedDomain=required('GOOGLE_HOSTED_DOMAIN','ntq-solution.com.vn').toLowerCase();
if(isProd&&!appOrigin.startsWith('https://'))throw new Error('APP_ORIGIN must use https:// in production');
const adminEmails=new Set((process.env.ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean));
for(const email of adminEmails)if(!email.endsWith(`@${hostedDomain}`))throw new Error(`ADMIN_EMAILS contains an address outside @${hostedDomain}`);
export const config=Object.freeze({
  nodeEnv,isProd,port:int('PORT',3000),appOrigin,
  googleClientId:required('GOOGLE_CLIENT_ID'),googleClientSecret:required('GOOGLE_CLIENT_SECRET'),googleRedirectUri:required('GOOGLE_REDIRECT_URI',`${appOrigin}/auth/google/callback`),hostedDomain,
  sessionSecret:required('SESSION_SECRET'),adminEmails,trustProxy:int('TRUST_PROXY',isProd?1:0),sessionMaxAgeMs:8*60*60*1000,oauthTransactionMaxAgeMs:10*60*1000,
  maxBodyBytes:24*1024,maxSocketPayloadBytes:24*1024,timezone:process.env.APP_TIMEZONE||'Asia/Ho_Chi_Minh',
  dbHost:required('DB_HOST','localhost'),dbPort:int('DB_PORT',3306),dbName:required('DB_NAME'),dbUser:required('DB_USER'),dbPassword:required('DB_PASSWORD'),dbPoolSize:int('DB_POOL_SIZE',10)
});
if(config.sessionSecret.length<32)throw new Error('SESSION_SECRET must be at least 32 characters');
