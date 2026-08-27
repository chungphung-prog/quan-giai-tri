(()=>{
'use strict';

const RPS_CHOICES=['rock','paper','scissors'];
const RPS_EMOJI={rock:'✊',paper:'✋',scissors:'✌️'};
const RPS_LABEL={rock:'BÚA',paper:'BAO',scissors:'KÉO'};
const CYCLE_MS=3000;
const REVEAL_MS=3000;
const RESULT_MS=2000;
const TOTAL_MS=CYCLE_MS+REVEAL_MS+RESULT_MS;

let latestMatch=null;
let flow=null;
let renderTimer=null;
let modalObserver=null;
let publicObserver=null;
let realIo=null;
let realFetch=null;

const now=()=>performance.now();
const qs=(s,r=document)=>r.querySelector(s);
const currentMatchId=()=>location.hash.startsWith('#match/')?decodeURIComponent(location.hash.slice(7)):null;
const isCurrentRps=m=>Boolean(m&&m.gameKey==='rps'&&String(m.id)===String(currentMatchId()));
const pickOf=(m,index)=>m?.state?.picks?.[index]||null;
const myPick=m=>pickOf(m,m.playerIndex);
const oppPick=m=>pickOf(m,1-m.playerIndex);
const isDone=m=>Boolean(m?.state?.done&&myPick(m)&&oppPick(m)&&m.status==='finished');

function resultText(m){
  const myId=m?.players?.[m.playerIndex]?.id;
  if(!m?.winnerId)return '🤝 Hòa!';
  return String(m.winnerId)===String(myId)?'🏆 Bạn thắng!':'💀 Bạn thua!';
}

function resultClass(m){
  const myId=m?.players?.[m.playerIndex]?.id;
  if(!m?.winnerId)return 'draw';
  return String(m.winnerId)===String(myId)?'victory':'defeat';
}

function cancelFlow(){
  if(renderTimer){clearInterval(renderTimer);renderTimer=null;}
  flow=null;
}

function beginFlow(match){
  if(!isCurrentRps(match)||!isDone(match))return;
  const token=`${match.id}:${match.version}`;
  if(flow?.token===token)return;
  if(renderTimer)clearInterval(renderTimer);
  flow={token,matchId:String(match.id),startedAt:now(),popupShown:false};
  renderTimer=setInterval(renderFlow,50);
  queueMicrotask(renderFlow);
}

function acceptSnapshot(match){
  if(!match||match.gameKey!=='rps')return;
  latestMatch=match;
  if(!isCurrentRps(match))return;
  if(isDone(match))beginFlow(match);
  else{
    if(flow)cancelFlow();
    queueMicrotask(patchWaitingPhase);
  }
}

function patchWaitingPhase(){
  const m=latestMatch;
  if(!isCurrentRps(m)||isDone(m))return;
  const mine=myPick(m);
  if(!mine)return; // Phase 1 is already rendered/bound by app.js.
  const wait=qs('.rps-wait');
  if(wait)wait.textContent='⏳ Đợi đối thủ chốt…';
  const picked=qs('.rps-picked b');
  if(picked)picked.textContent=`Bạn đã chốt: ${RPS_LABEL[mine]||mine}`;
}

function detachOldRpsHost(){
  const host=qs('#boardHost');
  if(!host)return null;
  if(host.dataset.rpsFlowOwned==='1')return host;
  const fresh=host.cloneNode(false);
  fresh.dataset.rpsFlowOwned='1';
  fresh.classList.add('rps-flow-owned');
  host.replaceWith(fresh);
  return fresh;
}

function suppressEarlyResultUi(){
  const status=qs('.match-top .status-pill');
  if(status){status.className='status-pill live';status.textContent='ĐANG MỞ';}
  document.querySelectorAll('.public-result').forEach(el=>el.remove());
  const modal=qs('#modalRoot .result-modal');
  if(modal&&!modal.hasAttribute('data-rps-flow-owned'))qs('#modalRoot')?.replaceChildren();
}

function renderCycle(host,m){
  const elapsed=now()-flow.startedAt;
  const idx=Math.floor(elapsed/160)%RPS_CHOICES.length;
  const mine=myPick(m);
  host.innerHTML=`<div class="rps-flow rps-flow-cycle">
    <div class="rps-flow-caption">ĐÃ CHỐT • ĐANG XÁO KẾT QUẢ</div>
    <div class="rps-reveal">
      <div class="rps-side"><small>BẠN</small><div class="rps-hand left">${RPS_EMOJI[mine]}</div><b>${RPS_LABEL[mine]}</b></div>
      <div class="rps-vs-text">VS</div>
      <div class="rps-side"><small>ĐỐI THỦ</small><div class="rps-hand right rps-cycling">${RPS_EMOJI[RPS_CHOICES[idx]]}</div><b>???</b></div>
    </div>
    <p class="rps-countdown">Đợi một chút…</p>
  </div>`;
  const banner=qs('.turn-banner');
  if(banner){banner.className='turn-banner finished rps-suspense';banner.textContent='🎲 Cả hai đã chốt — đang xáo lựa chọn…';}
}

function renderReveal(host,m){
  const mine=myPick(m),opp=oppPick(m);
  host.innerHTML=`<div class="rps-flow rps-flow-reveal">
    <div class="rps-flow-caption">LỘ DIỆN!</div>
    <div class="rps-reveal revealed">
      <div class="rps-side"><small>BẠN</small><div class="rps-hand left">${RPS_EMOJI[mine]}</div><b>${RPS_LABEL[mine]}</b></div>
      <div class="rps-vs-text">VS</div>
      <div class="rps-side"><small>ĐỐI THỦ</small><div class="rps-hand right bounce-in">${RPS_EMOJI[opp]}</div><b>${RPS_LABEL[opp]}</b></div>
    </div>
    <p class="rps-countdown">Đã lật bài — kết quả sắp hiện…</p>
  </div>`;
  const banner=qs('.turn-banner');
  if(banner){banner.className='turn-banner finished rps-suspense';banner.textContent='⚡ Đã lộ lựa chọn — chờ phán quyết…';}
}

function renderResult(host,m){
  const mine=myPick(m),opp=oppPick(m),res=resultText(m);
  host.innerHTML=`<div class="rps-flow rps-flow-result">
    <div class="rps-reveal">
      <div class="rps-side"><small>BẠN</small><div class="rps-hand left">${RPS_EMOJI[mine]}</div><b>${RPS_LABEL[mine]}</b></div>
      <div class="rps-vs-text">VS</div>
      <div class="rps-side"><small>ĐỐI THỦ</small><div class="rps-hand right">${RPS_EMOJI[opp]}</div><b>${RPS_LABEL[opp]}</b></div>
    </div>
    <div class="rps-result-text">${res}</div>
  </div>`;
  const banner=qs('.turn-banner');
  if(banner){banner.className='turn-banner finished';banner.textContent=res;}
  const status=qs('.match-top .status-pill');
  if(status){
    const cls=resultClass(m);
    status.className=`status-pill ${cls==='victory'?'win':cls==='defeat'?'lose':'draw'}`;
    status.textContent=cls==='victory'?'THẮNG':cls==='defeat'?'THUA':'HÒA';
  }
}

function showOwnedPopup(m){
  if(flow?.popupShown||!isCurrentRps(m))return;
  flow.popupShown=true;
  const modalRoot=qs('#modalRoot');
  if(!modalRoot)return;
  const opp=m.players?.[1-m.playerIndex]||{};
  const cls=resultClass(m);
  const win=cls==='victory',draw=cls==='draw';
  modalRoot.innerHTML=`<div class="modal-backdrop result-back" data-rps-flow-owned><div class="result-modal ${win?'victory':draw?'draw':'defeat'}" data-rps-flow-owned>
    <div class="result-rays"></div><div class="result-symbol">${win?'♛':draw?'＝':'☠'}</div>
    <span class="eyebrow">MATCH COMPLETE</span><h1>${win?'VICTORY':draw?'DRAW':'DEFEAT'}</h1>
    <p>${win?`Bạn đã hạ ${escapeHtml(opp.name||'đối thủ')}.`:draw?`Bất phân thắng bại với ${escapeHtml(opp.name||'đối thủ')}.`:`${escapeHtml(opp.name||'Đối thủ')} thắng trận này.`}</p>
    <div class="result-reward"><span>XP/Point được server cộng tự động</span></div>
    <div class="row"><button class="btn primary" data-rps-go-games>Về Kho game</button><button class="btn glass-btn" data-rps-close>Đóng</button></div>
  </div></div>`;
  qs('[data-rps-close]',modalRoot)?.addEventListener('click',()=>modalRoot.replaceChildren());
  qs('[data-rps-go-games]',modalRoot)?.addEventListener('click',()=>{modalRoot.replaceChildren();location.hash='#games';});
}

function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function renderFlow(){
  if(!flow||!latestMatch||String(latestMatch.id)!==flow.matchId||!isCurrentRps(latestMatch))return cancelFlow();
  const m=latestMatch;
  if(!isDone(m))return cancelFlow();
  const elapsed=now()-flow.startedAt;
  suppressEarlyResultUi();
  const host=detachOldRpsHost();
  if(!host)return;
  if(elapsed<CYCLE_MS)renderCycle(host,m);
  else if(elapsed<CYCLE_MS+REVEAL_MS)renderReveal(host,m);
  else renderResult(host,m);
  if(elapsed>=TOTAL_MS){
    showOwnedPopup(m);
    if(renderTimer){clearInterval(renderTimer);renderTimer=null;}
  }
}

function installModalGuard(){
  modalObserver=new MutationObserver(()=>{
    if(!flow||!latestMatch||!isCurrentRps(latestMatch))return;
    const foreign=[...qs('#modalRoot')?.querySelectorAll('.result-modal:not([data-rps-flow-owned])')||[]];
    if(!foreign.length)return;
    foreign.forEach(el=>el.closest('.modal-backdrop')?.remove());
    if(now()-flow.startedAt>=TOTAL_MS){flow.popupShown=false;queueMicrotask(()=>showOwnedPopup(latestMatch));}
  });
  const root=qs('#modalRoot');
  if(root)modalObserver.observe(root,{childList:true,subtree:true});
}

function installPublicResultGuard(){
  publicObserver=new MutationObserver(()=>{
    if(!flow||!latestMatch||!isCurrentRps(latestMatch))return;
    if(now()-flow.startedAt<CYCLE_MS+REVEAL_MS)document.querySelectorAll('.public-result').forEach(el=>el.remove());
  });
  publicObserver.observe(document.body,{childList:true,subtree:false});
}

function installFetchTap(){
  realFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const response=await realFetch(...args);
    try{
      const input=args[0];
      const url=typeof input==='string'?input:input?.url||'';
      if(/\/api\/matches\/[0-9a-f-]+(?:\?|$)/i.test(url)){
        response.clone().json().then(data=>acceptSnapshot(data?.match)).catch(()=>{});
      }
    }catch{}
    return response;
  };
}

function installSocketTap(){
  if(typeof window.io!=='function')return;
  realIo=window.io;
  const wrappedIo=function(...args){
    const socket=realIo(...args);
    const realOn=socket.on.bind(socket);
    const realEmit=socket.emit.bind(socket);
    socket.on=function(event,handler){
      if(event==='match:update'&&typeof handler==='function'){
        return realOn(event,payload=>{acceptSnapshot(payload?.match);const out=handler(payload);queueMicrotask(renderFlow);return out;});
      }
      return realOn(event,handler);
    };
    socket.emit=function(event,...rest){
      if(event==='match:action'&&typeof rest[rest.length-1]==='function'){
        const ack=rest[rest.length-1];
        rest[rest.length-1]=payload=>{acceptSnapshot(payload?.match);const out=ack(payload);queueMicrotask(renderFlow);return out;};
      }else if(event==='match:join'&&typeof rest[rest.length-1]==='function'){
        const ack=rest[rest.length-1];
        rest[rest.length-1]=payload=>{acceptSnapshot(payload?.match);const out=ack(payload);queueMicrotask(()=>{patchWaitingPhase();renderFlow();});return out;};
      }
      return realEmit(event,...rest);
    };
    return socket;
  };
  Object.assign(wrappedIo,realIo);
  wrappedIo.prototype=realIo.prototype;
  window.io=wrappedIo;
}

function handleRouteChange(){
  if(!location.hash.startsWith('#match/')){latestMatch=null;cancelFlow();}
  else queueMicrotask(()=>{patchWaitingPhase();renderFlow();});
}

installFetchTap();
installSocketTap();
installModalGuard();
installPublicResultGuard();
window.addEventListener('hashchange',handleRouteChange);
})();
