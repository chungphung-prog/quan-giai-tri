(()=>{
'use strict';
const TZ='Asia/Ho_Chi_Minh';
const MATCH_DURATION_MS=25*60*1000;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=v=>{try{return new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeStyle:'short',timeZone:TZ}).format(new Date(v));}catch{return ''}};
const mmss=ms=>{const s=Math.max(0,Math.ceil(Number(ms||0)/1000)),m=Math.floor(s/60);return `${m}:${String(s%60).padStart(2,'0')}`;};
const ss=ms=>`${Math.max(0,Math.ceil(Number(ms||0)/1000))}s`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let capturedSocket=null,clockOffsetMs=0,clockSyncedAt=0,csrfToken='',gameMap=new Map(),me=null,lastQueueSnapshot=null;
const matchTiming=new Map(),liveTiming=new Map();
let routeSerial=0,liveRefreshTimer=null,spectatorFallbackTimer=null,spectatorMatchId=null,spectatorVersion=null,spectatorSync=null,lastZeroResync=0;

function toast(msg,bad=false){
  let root=document.getElementById('qgtPvpToastRoot');if(!root){root=document.createElement('div');root.id='qgtPvpToastRoot';root.className='qgt-pvp-toast-root';document.body.appendChild(root);}
  const el=document.createElement('div');el.className=`qgt-pvp-toast ${bad?'bad':'good'}`;el.textContent=String(msg||'');root.appendChild(el);requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),250);},2600);
}
function avatar(u,cls='qgt-avatar'){const url=u?.avatarUrl||u?.avatar_url;return url?`<img class="${cls}" src="${esc(url)}" alt="">`:`<span class="${cls} qgt-avatar-fallback">${esc((u?.name||'?').slice(0,1).toUpperCase())}</span>`;}
function gameInfo(key){return gameMap.get(String(key))||{key,name:key,icon:'🎮'};}
async function apiJson(url,options={}){
  const init={credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&!['GET','HEAD'].includes(options.method)&&csrfToken?{'X-CSRF-Token':csrfToken}:{}),...(options.headers||{})}};
  const res=await window.fetch(url,init);const data=res.status===204?null:await res.json().catch(()=>({}));if(!res.ok){const e=new Error(data?.message||data?.error||`HTTP ${res.status}`);e.status=res.status;throw e;}return data;
}
async function loadBasics(){
  try{const [m,g]=await Promise.all([apiJson('/api/me'),apiJson('/api/games')]);me=m.user;csrfToken=m.csrfToken||csrfToken;gameMap=new Map((g.games||[]).map(x=>[x.key,x]));}catch{}
}
function timingAge(t){if(!t||!clockSyncedAt||!Number.isFinite(Number(t.serverNowMs)))return 0;return Math.max(0,(Date.now()+clockOffsetMs)-Number(t.serverNowMs));}
function syncBase(t){const age=timingAge(t);return {matchRemainingMs:Math.max(0,Number(t?.matchRemainingMs??0)-age),turnRemainingMs:t?.turnRemainingMs==null?null:Math.max(0,Number(t.turnRemainingMs)-age),matchDurationMs:Number(t?.matchDurationMs||MATCH_DURATION_MS),perf:performance.now()};}
function deadlineStorageKey(matchId){return `qgt:match-deadline:${String(matchId)}`;}
function currentRemaining(base){if(!base)return null;return Math.max(0,Number(base.matchRemainingMs||0)-(performance.now()-Number(base.perf||performance.now())));}
function stableMatchBase(matchId,t){
  const id=String(matchId),fresh=syncBase(t),now=Date.now();
  // A whole-match clock is monotonic: a later snapshot may reduce it, never extend/reset it.
  const existing=matchTiming.get(id),existingRemain=currentRemaining(existing);
  if(existingRemain!=null)fresh.matchRemainingMs=Math.min(fresh.matchRemainingMs,existingRemain);
  try{
    const key=deadlineStorageKey(id),stored=Number(sessionStorage.getItem(key)||0),reportedDeadline=now+fresh.matchRemainingMs;
    const stableDeadline=stored>now-5000?Math.min(stored,reportedDeadline):reportedDeadline;
    sessionStorage.setItem(key,String(Math.round(stableDeadline)));
    fresh.matchRemainingMs=Math.max(0,stableDeadline-now);
  }catch{}
  fresh.perf=performance.now();
  return fresh;
}
function ingestTiming(matchId,t){if(!matchId||!t)return;matchTiming.set(String(matchId),stableMatchBase(matchId,t));}
function adjustParticipantMatch(match,t){
  if(!match||!t)return match;const base=stableMatchBase(match.id,t);matchTiming.set(String(match.id),base);const now=Date.now(),duration=base.matchDurationMs,remain=base.matchRemainingMs;
  // Legacy app still renders from createdAt. Reconstruct it from the immutable whole-match deadline.
  match.createdAt=new Date(now-Math.max(0,duration-remain)).toISOString();
  if(base.turnRemainingMs!=null)match.turnDeadline=now+base.turnRemainingMs;
  return match;
}
function adjustSocketMatch(match){
  if(!match)return match;const off=Number(clockOffsetMs||0);
  if(Number.isFinite(Number(match.turnDeadline))&&Number(match.turnDeadline)>0)match.turnDeadline=Number(match.turnDeadline)-off;
  if(match.createdAt){const d=new Date(match.createdAt);if(!Number.isNaN(d.getTime()))match.createdAt=new Date(d.getTime()-off).toISOString();}
  return match;
}

// Must run before app.js: enrich the legacy participant match response with server-authoritative timing.
const nativeFetch=window.fetch.bind(window);
window.fetch=async function(...args){
  const res=await nativeFetch(...args);
  try{
    const raw=typeof args[0]==='string'?args[0]:args[0]?.url||'',url=new URL(raw,location.href);
    if(url.origin===location.origin&&/^\/api\/matches\/[0-9a-f-]{36}$/i.test(url.pathname)&&res.status!==204){
      const data=await res.clone().json();if(data?.match&&data?.timing){adjustParticipantMatch(data.match,data.timing);const headers=new Headers(res.headers);headers.set('content-type','application/json; charset=utf-8');return new Response(JSON.stringify(data),{status:res.status,statusText:res.statusText,headers});}
    }
  }catch{}
  return res;
};

function installSocketCapture(){
  if(typeof window.io!=='function')return;const realIo=window.io;
  const wrapped=function(...args){
    const socket=realIo(...args);capturedSocket=socket;const realOn=socket.on.bind(socket);
    socket.on=function(event,handler){
      if(event==='match:update'&&typeof handler==='function')return realOn(event,payload=>{adjustSocketMatch(payload?.match);const out=handler(payload);setTimeout(()=>syncCurrentParticipantTiming(),25);return out;});
      return realOn(event,handler);
    };
    realOn('challenge:new',payload=>handleIncomingChallenge(payload?.id));
    realOn('challenge:changed',()=>refreshPendingChallenges(false));
    realOn('queue:snapshot',payload=>{lastQueueSnapshot=payload||{users:[],queues:[]};renderRealtimeLobbyQueue();if(location.hash==='#matches')loadLiveList(routeSerial);});
    realOn('queue:update',()=>setTimeout(refreshQueueSnapshot,40));
    realOn('match:created',()=>{setTimeout(syncCurrentParticipantTiming,50);setTimeout(refreshQueueSnapshot,80);if(location.hash==='#matches')setTimeout(()=>loadLiveList(routeSerial),60);});
    realOn('spectate:update',payload=>{if(payload?.match?.id===spectatorMatchId)applySpectatorSnapshot(payload.match,payload.viewers);});
    realOn('spectate:viewers',payload=>{if(payload?.matchId===spectatorMatchId){const n=document.querySelector('#qgtSpectatorViewers b');if(n)n.textContent=String(payload.viewers||0);}});
    return socket;
  };
  Object.assign(wrapped,realIo);wrapped.prototype=realIo.prototype;window.io=wrapped;
}
installSocketCapture();

async function syncClock(){
  try{const t0=Date.now(),d=await apiJson('/api/pvp/time'),t1=Date.now();clockOffsetMs=Number(d.serverNowMs)-((t0+t1)/2);clockSyncedAt=performance.now();}catch{}
}
async function syncCurrentParticipantTiming(){
  const m=location.hash.match(/^#match\/([0-9a-f-]{36})$/i);if(!m)return;try{const d=await apiJson(`/api/matches/${m[1]}?_t=${Date.now()}`);if(d?.timing){ingestTiming(m[1],d.timing);tickParticipantTimer();}}catch{}
}
function timingNow(t){const elapsed=performance.now()-t.perf;return {match:Math.max(0,t.matchRemainingMs-elapsed),turn:t.turnRemainingMs==null?null:Math.max(0,t.turnRemainingMs-elapsed)};}
function tickParticipantTimer(){
  const m=location.hash.match(/^#match\/([0-9a-f-]{36})$/i);if(!m)return;const t=matchTiming.get(m[1]);if(!t)return;const now=timingNow(t),turn=document.querySelector('#turnCountdown'),match=document.querySelector('#matchTimer b');
  if(turn&&now.turn!=null){turn.textContent=ss(now.turn);turn.classList.toggle('urgent',now.turn<=5000);}
  if(match)match.textContent=mmss(now.match);
  if((now.match<=0||(now.turn!=null&&now.turn<=0))&&performance.now()-lastZeroResync>650){lastZeroResync=performance.now();setTimeout(syncCurrentParticipantTiming,300);}
}
setInterval(tickParticipantTimer,100);setInterval(()=>{syncClock();syncCurrentParticipantTiming();},15000);syncClock();


async function refreshQueueSnapshot(){
  try{const [u,q]=await Promise.all([apiJson('/api/matchmaking/users'),apiJson('/api/matchmaking/status')]);lastQueueSnapshot={users:u.users||[],queues:q.queues||[],serverNowMs:Date.now()};renderRealtimeLobbyQueue();}catch{}
}
function removeLegacyQueueBlock(content){
  for(const head of [...content.querySelectorAll('.section-head')]){
    if(head.closest('#qgtRealtimeQueueBlock'))continue;
    const eyebrow=head.querySelector('.eyebrow');if((eyebrow?.textContent||'').trim()!=='ĐANG TÌM TRẬN')continue;
    const next=head.nextElementSibling;if(next?.classList?.contains('queue-users-grid'))next.remove();head.remove();
  }
}
function renderRealtimeLobbyQueue(){
  if(location.hash&&location.hash!=='#lobby')return;const content=contentRoot();if(!content||!lastQueueSnapshot)return;
  removeLegacyQueueBlock(content);
  const all=lastQueueSnapshot.users||[],users=all.filter(u=>String(u.id)!==String(me?.id)),total=(lastQueueSnapshot.queues||[]).reduce((n,x)=>n+Number(x.waiting||0),0);
  const metric=content.querySelector('.metric-icon.cyan')?.closest('.metric-card');if(metric){const em=metric.querySelector('em');if(em)em.textContent=`${total} đang tìm trận`;}
  let block=document.getElementById('qgtRealtimeQueueBlock');
  if(!users.length){block?.remove();return;}
  const sig=JSON.stringify(users.map(u=>[u.id,u.game_key,String(u.joined_at||'')]))+`:${total}`;
  if(block?.dataset.sig===sig)return;
  if(!block){block=document.createElement('div');block.id='qgtRealtimeQueueBlock';block.className='qgt-realtime-queue';const before=content.querySelector('.metric-grid');if(before)content.insertBefore(block,before);else content.appendChild(block);}
  block.dataset.sig=sig;
  block.innerHTML=`<div class="section-head"><div><span class="eyebrow">ĐANG TÌM TRẬN · REALTIME</span><h2>⚡ Tham gia ngay</h2></div><span class="qgt-queue-live-badge"><i></i>${users.length} request</span></div><section class="queue-users-grid">${users.map(u=>{const g=gameInfo(u.game_key);return `<div class="queue-user-card qgt-live-queue-card" data-qgt-waiter="${esc(u.id)}"><div class="member-info">${avatar(u,'avatar')}<div><b>${esc(u.name)}</b><small>${g.icon} ${esc(g.name)}</small></div></div><button class="btn compact primary" data-qgt-join-waiter="${esc(u.id)}" data-qgt-game="${esc(u.game_key)}">Tham gia ▶</button></div>`;}).join('')}</section>`;
  block.querySelectorAll('[data-qgt-join-waiter]').forEach(btn=>btn.onclick=()=>joinSpecificQueue(btn));
}
function joinSpecificQueue(btn){
  if(!capturedSocket){toast('Realtime chưa kết nối, thử lại sau một chút',true);refreshQueueSnapshot();return;}
  const targetUserId=btn.dataset.qgtJoinWaiter,gameKey=btn.dataset.qgtGame;if(!targetUserId||!gameKey)return;
  const card=btn.closest('.queue-user-card'),old=btn.textContent;btn.disabled=true;btn.textContent='⏳ Đang ghép…';card?.classList.add('joining');
  capturedSocket.emit('queue:join-target',{targetUserId,gameKey},ack=>{
    if(ack?.ok&&ack.matchId){toast('Ghép trận thành công!');if(!location.hash.startsWith('#match/'))location.hash=`#match/${ack.matchId}`;return;}
    card?.classList.remove('joining');btn.disabled=false;btn.textContent=old;
    const taken=ack?.error==='QUEUE_REQUEST_TAKEN';toast(taken?'Trận đấu đã được ghép hoặc yêu cầu tìm trận không còn hiệu lực.':(ack?.message||'Không ghép trận được'),true);refreshQueueSnapshot();
  });
}

function inviteRoot(){let root=document.getElementById('qgtChallengeInvites');if(!root){root=document.createElement('div');root.id='qgtChallengeInvites';root.className='qgt-challenge-invites';document.body.appendChild(root);}return root;}
function incomingOnly(list){return (list||[]).filter(c=>c.status==='pending'&&c.creator?.id!==me?.id);}
async function refreshPendingChallenges(showAll=true){
  if(!me)await loadBasics();try{const d=await apiJson('/api/challenges');for(const c of incomingOnly(d.challenges)){if(showAll||document.querySelector(`[data-qgt-invite="${CSS.escape(String(c.id))}"]`))showInvite(c);}}catch{}
}
async function handleIncomingChallenge(id){
  if(!me)await loadBasics();try{const d=await apiJson('/api/challenges'),c=incomingOnly(d.challenges).find(x=>String(x.id)===String(id));if(c){showInvite(c);try{window.QGTAudio?.sfx?.(880,.12,'triangle',.05);}catch{}const old=document.title;document.title='⚔️ Có lời thách đấu!';setTimeout(()=>{if(document.title==='⚔️ Có lời thách đấu!')document.title=old;},5000);}}catch{}
}
function showInvite(c){
  const root=inviteRoot();if(root.querySelector(`[data-qgt-invite="${CSS.escape(String(c.id))}"]`))return;const g=gameInfo(c.gameKey),el=document.createElement('article');el.className='qgt-invite-card';el.dataset.qgtInvite=c.id;
  el.innerHTML=`<button class="qgt-invite-x" aria-label="Đóng">×</button><div class="qgt-invite-head"><span class="qgt-invite-icon">${g.icon}</span><div><span>LỜI THÁCH ĐẤU MỚI</span><b>${esc(g.name)}</b></div></div><div class="qgt-invite-person">${avatar(c.creator,'qgt-avatar')}<div><b>${esc(c.creator?.name||'Đối thủ')}</b><small>muốn đấu với bạn</small></div></div><div class="qgt-invite-actions"><button data-qgt-accept class="btn primary compact">⚔ Nhận kèo</button><button data-qgt-decline class="btn glass-btn compact">Từ chối</button></div><small class="qgt-invite-expire">Có hiệu lực trong khoảng 10 phút</small>`;
  root.prepend(el);el.querySelector('.qgt-invite-x').onclick=()=>el.remove();el.querySelector('[data-qgt-accept]').onclick=()=>respondChallenge(c.id,'accept',el);el.querySelector('[data-qgt-decline]').onclick=()=>respondChallenge(c.id,'decline',el);
  setTimeout(()=>el.remove(),10*60*1000);
}
async function respondChallenge(id,action,el){
  const buttons=[...el.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{const d=await apiJson(`/api/challenges/${encodeURIComponent(id)}/${action}`,{method:'POST'});el.remove();if(action==='accept'&&d?.matchId){toast('Đã nhận kèo — vào trận!');location.hash=`#match/${d.matchId}`;}else toast('Đã từ chối lời thách đấu');}catch(e){buttons.forEach(b=>b.disabled=false);toast(e.message,true);}
}

function cleanupRoute(){
  if(liveRefreshTimer){clearInterval(liveRefreshTimer);liveRefreshTimer=null;}if(spectatorFallbackTimer){clearInterval(spectatorFallbackTimer);spectatorFallbackTimer=null;}
  if(spectatorMatchId&&capturedSocket){capturedSocket.emit('spectate:leave',{matchId:spectatorMatchId});}spectatorMatchId=null;spectatorVersion=null;spectatorSync=null;
}
function contentRoot(){return document.querySelector('main.content');}
async function ensureRoute(){
  const serial=++routeSerial;cleanupRoute();await sleep(80);if(serial!==routeSerial)return;
  if(location.hash==='#matches')return renderEnhancedMatches(serial);
  const watch=location.hash.match(/^#watch\/([0-9a-f-]{36})$/i);if(watch)return renderSpectator(watch[1],serial);
}

let historyState={page:1,gameKey:'all',result:'all',pageSize:10,liveGame:'all'};
async function renderEnhancedMatches(serial){
  if(!me||!gameMap.size)await loadBasics();const content=contentRoot();if(!content){setTimeout(()=>serial===routeSerial&&renderEnhancedMatches(serial),120);return;}if(serial!==routeSerial||location.hash!=='#matches')return;
  content.dataset.qgtPvpRoute='matches';content.innerHTML=`<div class="qgt-pvp-page"><div class="page-title compact qgt-pvp-title"><div><span class="eyebrow">PVP CENTER</span><h1>Trận đấu của tôi</h1><p>Lọc lịch sử theo game, phân trang và xem trực tiếp các trận đang diễn ra.</p></div><button id="qgtFindGame" class="btn primary">⚔ Tìm trận mới</button></div><section class="surface qgt-live-section"><div class="surface-head qgt-live-head"><div><span class="eyebrow">LIVE ARENA</span><h2>🔴 Trận đang diễn ra</h2></div><div class="qgt-live-tools"><select id="qgtLiveGame" class="select-fancy"></select><span id="qgtLiveCount" class="count-bubble">0</span></div></div><div id="qgtLiveList" class="qgt-live-grid"><div class="empty-state small">Đang tải trận live…</div></div></section><section class="surface qgt-history-section"><div class="surface-head qgt-history-head"><div><span class="eyebrow">MATCH HISTORY</span><h2>Lịch sử trận</h2></div><div class="qgt-history-filters"><select id="qgtHistoryGame" class="select-fancy"></select><select id="qgtHistoryResult" class="select-fancy"><option value="all">Tất cả kết quả</option><option value="active">Đang đấu</option><option value="win">Thắng</option><option value="loss">Thua</option><option value="draw">Hòa</option></select></div></div><div id="qgtHistoryList" class="qgt-history-list"><div class="empty-state small">Đang tải lịch sử…</div></div><div id="qgtHistoryPager" class="qgt-pager"></div></section></div>`;
  const opts=`<option value="all">🎮 Tất cả game</option>${[...gameMap.values()].filter(g=>g.pvp).map(g=>`<option value="${esc(g.key)}">${g.icon} ${esc(g.name)}</option>`).join('')}`;
  const hg=document.getElementById('qgtHistoryGame'),lg=document.getElementById('qgtLiveGame'),hr=document.getElementById('qgtHistoryResult');hg.innerHTML=opts;lg.innerHTML=opts;hg.value=historyState.gameKey;lg.value=historyState.liveGame;hr.value=historyState.result;
  document.getElementById('qgtFindGame').onclick=()=>location.hash='#games';hg.onchange=()=>{historyState.gameKey=hg.value;historyState.page=1;loadHistory(serial);};hr.onchange=()=>{historyState.result=hr.value;historyState.page=1;loadHistory(serial);};lg.onchange=()=>{historyState.liveGame=lg.value;loadLiveList(serial);};
  await Promise.allSettled([loadHistory(serial),loadLiveList(serial)]);liveRefreshTimer=setInterval(()=>{if(location.hash==='#matches')loadLiveList(serial);},3000);
}
async function loadHistory(serial){
  try{const q=new URLSearchParams({page:String(historyState.page),pageSize:String(historyState.pageSize),gameKey:historyState.gameKey,result:historyState.result}),d=await apiJson(`/api/pvp/history?${q}`);if(serial!==routeSerial||location.hash!=='#matches')return;const list=document.getElementById('qgtHistoryList'),pager=document.getElementById('qgtHistoryPager');if(!list||!pager)return;
    list.innerHTML=(d.matches||[]).map(historyRow).join('')||'<div class="empty-state small">Không có trận nào phù hợp bộ lọc.</div>';renderPager(pager,d.pagination||{});}
  catch(e){const list=document.getElementById('qgtHistoryList');if(list)list.innerHTML=`<div class="empty-state small">${esc(e.message)}</div>`;}
}
function historyRow(m){const g=gameInfo(m.gameKey),opp=(m.players||[]).find(p=>p.id!==me?.id)||m.players?.[1],label=m.status==='active'?'LIVE':!m.winnerId?'HÒA':m.winnerId===me?.id?'THẮNG':'THUA',cls=m.status==='active'?'live':label==='THẮNG'?'win':label==='THUA'?'lose':'draw';return `<article class="qgt-history-row"><div class="qgt-history-game">${g.icon}</div><div class="qgt-history-main"><b>${esc(g.name)}</b><small>${fmtDate(m.createdAt)} · GMT+7</small></div><div class="qgt-history-opp">${avatar(opp,'qgt-avatar xs')}<span>vs ${esc(opp?.name||'')}</span></div><span class="status-pill ${cls}">${label}</span><button class="open-match" data-qgt-open="${m.id}" title="${m.status==='active'?'Vào trận':'Xem trận'}">↗</button></article>`;}
function renderPager(root,p){const page=Number(p.page||1),pages=Number(p.pages||1),total=Number(p.total||0);root.innerHTML=`<button ${page<=1?'disabled':''} data-qgt-page="${page-1}">← Trước</button><span>Trang <b>${page}</b> / ${pages} · ${total} trận</span><button ${page>=pages?'disabled':''} data-qgt-page="${page+1}">Sau →</button>`;root.querySelectorAll('[data-qgt-page]').forEach(b=>b.onclick=()=>{historyState.page=Number(b.dataset.qgtPage);loadHistory(routeSerial);});document.querySelectorAll('[data-qgt-open]').forEach(b=>b.onclick=()=>location.hash=`#match/${b.dataset.qgtOpen}`);}
async function loadLiveList(serial){
  try{const d=await apiJson(`/api/pvp/live-matches?gameKey=${encodeURIComponent(historyState.liveGame)}`);if(serial!==routeSerial||location.hash!=='#matches')return;const root=document.getElementById('qgtLiveList'),count=document.getElementById('qgtLiveCount');if(!root)return;const matches=d.matches||[];if(count)count.textContent=String(matches.length);liveTiming.clear();root.innerHTML=matches.slice(0,18).map(liveCard).join('')||'<div class="empty-state small">Hiện chưa có trận nào đang diễn ra.</div>';root.querySelectorAll('[data-qgt-watch]').forEach(b=>b.onclick=()=>location.hash=`#watch/${b.dataset.qgtWatch}`);root.querySelectorAll('[data-qgt-enter]').forEach(b=>b.onclick=()=>location.hash=`#match/${b.dataset.qgtEnter}`);}
  catch(e){const root=document.getElementById('qgtLiveList');if(root)root.innerHTML=`<div class="empty-state small">${esc(e.message)}</div>`;}
}
function liveCard(m){const g=gameInfo(m.gameKey),p=m.players||[],mine=p.some(x=>x.id===me?.id),t=m.timing||{};liveTiming.set(String(m.id),syncBase(t));const turnName=m.turnIndex==null?'Đang chuẩn bị':p[m.turnIndex]?.name||'Đang đi';return `<article class="qgt-live-card"><div class="qgt-live-card-top"><span>${g.icon} <b>${esc(g.name)}</b></span><span class="qgt-live-dot">LIVE</span></div><div class="qgt-live-versus"><div>${avatar(p[0],'qgt-avatar')}<b>${esc(p[0]?.name||'')}</b></div><span>VS</span><div>${avatar(p[1],'qgt-avatar')}<b>${esc(p[1]?.name||'')}</b></div></div><div class="qgt-live-meta"><span>⏱ <b class="qgt-live-match-time" data-mid="${m.id}">${mmss(t.matchRemainingMs)}</b></span><span>🎯 ${esc(turnName)} · <b class="qgt-live-turn-time" data-mid="${m.id}">${t.turnRemainingMs==null?'—':ss(t.turnRemainingMs)}</b></span></div>${mine?`<button class="btn primary compact" data-qgt-enter="${m.id}">Vào trận của tôi</button>`:`<button class="btn glass-btn compact" data-qgt-watch="${m.id}">👁 Xem live</button>`}</article>`;}
function tickLiveList(){for(const [id,t] of liveTiming){const n=timingNow(t),a=document.querySelector(`.qgt-live-match-time[data-mid="${CSS.escape(id)}"]`),b=document.querySelector(`.qgt-live-turn-time[data-mid="${CSS.escape(id)}"]`);if(a)a.textContent=mmss(n.match);if(b&&n.turn!=null)b.textContent=ss(n.turn);}}
setInterval(tickLiveList,200);

async function renderSpectator(id,serial){
  if(!me||!gameMap.size)await loadBasics();const content=contentRoot();if(!content){setTimeout(()=>serial===routeSerial&&renderSpectator(id,serial),120);return;}if(serial!==routeSerial)return;spectatorMatchId=id;content.dataset.qgtPvpRoute='watch';content.innerHTML='<div class="qgt-watch-page"><div class="empty-state">Đang kết nối bàn đấu live…</div></div>';
  try{const d=await apiJson(`/api/pvp/live/${id}`);if(serial!==routeSerial)return;renderSpectatorShell(d.match,d.viewers||0);applySpectatorSnapshot(d.match,d.viewers||0);if(capturedSocket){capturedSocket.emit('spectate:join',{matchId:id},ack=>{if(ack?.ok&&ack.match)applySpectatorSnapshot(ack.match,ack.viewers);});}else{spectatorFallbackTimer=setInterval(async()=>{try{const x=await apiJson(`/api/pvp/live/${id}`);applySpectatorSnapshot(x.match,x.viewers);}catch{}},700);}}
  catch(e){content.innerHTML=`<div class="qgt-watch-page"><div class="page-title compact"><div><span class="eyebrow">LIVE ARENA</span><h1>Không xem được trận</h1><p>${esc(e.message)}</p></div></div><button class="btn glass-btn" id="qgtBackMatches">← Về Trận đấu</button></div>`;document.getElementById('qgtBackMatches').onclick=()=>location.hash='#matches';}
}
function renderSpectatorShell(m,viewers){const content=contentRoot(),g=gameInfo(m.gameKey),p=m.players||[];content.innerHTML=`<div class="qgt-watch-page"><div class="qgt-watch-top"><button id="qgtBackMatches" class="back-link">← Trận đấu</button><span class="qgt-live-dot">● LIVE SPECTATOR</span><span id="qgtSpectatorViewers">👁 <b>${Number(viewers||0)}</b> đang xem</span></div><section class="qgt-watch-versus"><div class="qgt-watch-player" data-pidx="0">${avatar(p[0],'qgt-avatar big')}<div><b>${esc(p[0]?.name||'')}</b><small>${esc(p[0]?.officeName||'')}</small></div></div><div class="qgt-watch-center"><span>${g.icon}</span><h1>${esc(g.name)}</h1><div class="qgt-watch-clocks"><div><small>TRẬN ĐẤU</small><b id="qgtWatchMatchClock">25:00</b></div><div><small>LƯỢT HIỆN TẠI</small><b id="qgtWatchTurnClock">30s</b></div></div><strong id="qgtWatchTurnLabel">Đang đồng bộ…</strong></div><div class="qgt-watch-player right" data-pidx="1">${avatar(p[1],'qgt-avatar big')}<div><b>${esc(p[1]?.name||'')}</b><small>${esc(p[1]?.officeName||'')}</small></div></div></section><section class="surface qgt-watch-board-wrap"><div id="qgtWatchStatus" class="qgt-watch-status"></div><div id="qgtWatchBoard" class="qgt-watch-board"></div></section></div>`;document.getElementById('qgtBackMatches').onclick=()=>location.hash='#matches';}
function applySpectatorSnapshot(m,viewers){if(!m||m.id!==spectatorMatchId)return;const t=m.timing||{};spectatorSync=syncBase(t);const v=document.querySelector('#qgtSpectatorViewers b');if(v&&viewers!=null)v.textContent=String(viewers);const label=document.getElementById('qgtWatchTurnLabel'),status=document.getElementById('qgtWatchStatus');if(label){if(m.status==='finished')label.textContent=m.winnerId?`${m.players.find(p=>p.id===m.winnerId)?.name||'Người thắng'} thắng trận`:'Trận đấu hòa';else if(m.turnIndex==null)label.textContent='Hai bên đang chuẩn bị';else label.textContent=`Lượt: ${m.players[m.turnIndex]?.name||'Người chơi'}`;}
  document.querySelectorAll('.qgt-watch-player').forEach(el=>el.classList.toggle('active-turn',m.status==='active'&&Number(el.dataset.pidx)===Number(m.turnIndex)));
  if(status)status.innerHTML=m.status==='finished'?`<span class="status-pill ${m.winnerId?'win':'draw'}">${m.winnerId?'ĐÃ KẾT THÚC':'HÒA'}</span>`:'<span class="status-pill live">ĐANG DIỄN RA</span>';
  if(spectatorVersion!==m.version||m.status==='finished'){spectatorVersion=m.version;const board=document.getElementById('qgtWatchBoard');if(board)board.innerHTML=renderWatchBoard(m);}
}
function tickSpectator(){if(!spectatorSync)return;const n=timingNow(spectatorSync),a=document.getElementById('qgtWatchMatchClock'),b=document.getElementById('qgtWatchTurnClock');if(a)a.textContent=mmss(n.match);if(b)b.textContent=n.turn==null?'—':ss(n.turn);}
setInterval(tickSpectator,100);

function renderWatchBoard(m){const s=m.state||{},k=m.gameKey;if(k==='caro'||k==='ttt')return gridBoard(s,k==='caro'?15:3);if(k==='chess')return chessBoard(s);if(k==='xiangqi')return xiangqiBoard(s);if(k==='connect4')return connectBoard(s);if(k==='reversi')return reversiBoard(s);if(k==='dots')return dotsBoard(s);if(k==='battleship')return battleshipBoard(s,m.players);if(k==='rps')return rpsBoard(s,m.players,m.status);return '<div class="empty-state">Game này chưa có spectator renderer.</div>';}
function gridBoard(s,n){const b=Array.isArray(s.board)?s.board:[],last=s.lastMove?.action?.index;return `<div class="qgt-spec-grid ${n===15?'caro':'ttt'}" style="--n:${n}">${b.map((v,i)=>`<span class="qgt-spec-cell p${v==null?'e':v} ${i===last?'last':''}">${v===0?'✕':v===1?'○':''}</span>`).join('')}</div>`;}
function chessBoard(s){const b=Array.isArray(s.board)?s.board:[];return `<div class="qgt-spec-chess">${b.map((p,i)=>`<span class="${(Math.floor(i/8)+i%8)%2?'dark':'light'}">${p||''}</span>`).join('')}</div>`;}
function xiangqiBoard(s){const b=Array.isArray(s.board)?s.board:[];return `<div class="qgt-spec-xq">${b.map(p=>`<span class="${['帥','仕','相','俥','傌','炮','兵'].includes(p)?'red':''}">${p||''}</span>`).join('')}</div>`;}
function connectBoard(s){const b=Array.isArray(s.board)?s.board:[];return `<div class="qgt-spec-connect">${b.map(v=>`<span>${v==null?'':`<i class="p${v}"></i>`}</span>`).join('')}</div>`;}
function reversiBoard(s){const b=Array.isArray(s.board)?s.board:[];return `<div class="qgt-spec-reversi">${b.map(v=>`<span>${v==null?'':`<i class="p${v}"></i>`}</span>`).join('')}</div>`;}
function dotsBoard(s){const edges=new Set(Array.isArray(s.edges)?s.edges:[]),boxes=s.boxes||{};let html='<div class="qgt-spec-dots">';for(let r=0;r<9;r++)for(let c=0;c<9;c++){if(r%2===0&&c%2===0)html+='<i class="dot"></i>';else if(r%2===0){const k=`h:${r/2}:${(c-1)/2}`;html+=`<i class="edge h ${edges.has(k)?'on':''}"></i>`;}else if(c%2===0){const k=`v:${(r-1)/2}:${c/2}`;html+=`<i class="edge v ${edges.has(k)?'on':''}"></i>`;}else{const v=boxes[`${(r-1)/2}:${(c-1)/2}`];html+=`<i class="box p${v==null?'e':v}">${v==null?'':v===0?'A':'B'}</i>`;}}return html+'</div>';}
function battleshipBoard(s,players){const shots=Array.isArray(s.shots)?s.shots:[[],[]],hits=Array.isArray(s.hits)?s.hits:[0,0];return `<div class="qgt-spec-battle"><div><h3>Radar ${esc(players?.[0]?.name||'P1')} <small>${hits[0]||0}/14 hit</small></h3><div class="radar">${(shots[0]||[]).map(v=>`<span class="s${v}">${v===2?'×':v===1?'•':''}</span>`).join('')}</div></div><div><h3>Radar ${esc(players?.[1]?.name||'P2')} <small>${hits[1]||0}/14 hit</small></h3><div class="radar">${(shots[1]||[]).map(v=>`<span class="s${v}">${v===2?'×':v===1?'•':''}</span>`).join('')}</div></div><p>🔒 Vị trí tàu được ẩn với spectator; chỉ hiện các phát bắn đã xảy ra.</p></div>`;}
function rpsBoard(s,players,status){const p=Array.isArray(s.picks)?s.picks:[null,null],icon=v=>v==='rock'?'✊':v==='paper'?'✋':v==='scissors'?'✌️':v==='locked'?'🔒':'❔';return `<div class="qgt-spec-rps"><div><span>${icon(p[0])}</span><b>${esc(players?.[0]?.name||'P1')}</b></div><strong>VS</strong><div><span>${icon(p[1])}</span><b>${esc(players?.[1]?.name||'P2')}</b></div><p>${status==='active'?'Lựa chọn được giữ bí mật cho tới khi kết thúc.':'Đã mở kết quả.'}</p></div>`;}

function installOpenMatchDelegation(){document.addEventListener('click',e=>{const b=e.target.closest?.('[data-qgt-open]');if(b)location.hash=`#match/${b.dataset.qgtOpen}`;});}
installOpenMatchDelegation();

window.addEventListener('load',async()=>{await loadBasics();await syncClock();await refreshQueueSnapshot();setTimeout(()=>{ensureRoute();refreshPendingChallenges(true);syncCurrentParticipantTiming();renderRealtimeLobbyQueue();},160);window.addEventListener('hashchange',()=>setTimeout(()=>{ensureRoute();if(location.hash==='#lobby')renderRealtimeLobbyQueue();},20));
  const app=document.getElementById('app');if(app)new MutationObserver(()=>{const c=contentRoot();if(location.hash==='#matches'&&c&&!c.dataset.qgtPvpRoute)setTimeout(()=>renderEnhancedMatches(routeSerial),30);const w=location.hash.match(/^#watch\/([0-9a-f-]{36})$/i);if(w&&c&&!c.dataset.qgtPvpRoute)setTimeout(()=>renderSpectator(w[1],routeSerial),30);if((!location.hash||location.hash==='#lobby')&&c)setTimeout(renderRealtimeLobbyQueue,0);}).observe(app,{subtree:true,childList:true});
});
})();
