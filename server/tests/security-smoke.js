import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(process.cwd());
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const auth=read('server/auth/google.js');
const server=read('server/index.js');
const match=read('server/services/matches.js');
const solo=read('server/services/solo.js');
const chat=read('server/services/chat.js');
const site=read('server/services/site.js');
const middleware=read('server/middleware/auth.js');
const rewards=read('server/services/rewards.js');
const api=read('server/routes/api.js');

// Google Workspace auth: signed token + nonce/state + Workspace domain claim.
assert.match(auth,/verifyIdToken/);
assert.match(auth,/payload\.hd/);
assert.match(auth,/email_verified/);
assert.match(auth,/payload\.nonce/);
assert.match(auth,/session\.regenerate/);
assert.match(auth,/code_challenge_method:'S256'/);

// Browser/session/WebSocket hardening.
assert.match(server,/perMessageDeflate:false/);
assert.match(server,/if\(origin\)return origin===config\.appOrigin/);
assert.match(server,/host===appUrl\.host\.toLowerCase\(\)/);
assert.match(server,/httpOnly:true/);
assert.match(server,/sameSite:'lax'/);
assert.match(server,/__Host-qgt\.sid/);
assert.match(middleware,/timingSafeEqual/);
assert.match(middleware,/req\.get\('origin'\)!==config\.appOrigin/);

// PvP stays server authoritative and concurrency-safe.
assert.match(match,/FOR UPDATE/);
assert.match(match,/expectedVersion/);
assert.match(match,/client_action_id/);
assert.match(match,/STALE_VERSION/);

// Solo leaderboard is guarded: server-issued run, nonce, expiry, timing, score cap, single submit.
assert.match(solo,/randomBytes\(24\)/);
assert.match(solo,/RUN_USED/);
assert.match(solo,/BAD_RUN_NONCE/);
assert.match(solo,/RUN_EXPIRED/);
assert.match(solo,/RUN_TOO_FAST/);
assert.match(solo,/BAD_TIMING/);
assert.match(solo,/SCORE_OUT_OF_RANGE/);
assert.match(solo,/PVP_MATCH_REQUIRED/);
assert.match(rewards,/SELECT id FROM users WHERE id=\$1 FOR UPDATE/);
assert.match(api,/solo\.reject/);

// Chat cooldown and play schedule are server-side, not cosmetic UI checks.
assert.match(chat,/FOR UPDATE/);
assert.match(chat,/CHAT_COOLDOWN/);
assert.match(api,/admin\.chat\.delete/);
assert.match(site,/start<=end/);
assert.match(site,/const prev=\(day\+6\)%7/);

console.log('Security smoke checks passed.');
