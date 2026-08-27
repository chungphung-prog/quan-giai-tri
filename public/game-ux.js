(()=>{
'use strict';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

function decorateColorBadges(){
  $$('.color-badge').forEach(badge=>{
    const raw=(badge.textContent||'').trim();
    if(!raw)return;
    badge.classList.remove('ux-white','ux-black','ux-red','ux-caro-x','ux-caro-o','ux-first','ux-second');

    if(raw.includes('♔')||/Trắng/i.test(raw)){
      badge.classList.add('ux-white','ux-first');
      badge.textContent='♔ QUÂN TRẮNG · ĐI TRƯỚC';
      return;
    }
    if(raw.includes('♚')){
      badge.classList.add('ux-black','ux-second');
      badge.textContent='♚ QUÂN ĐEN · ĐI SAU';
      return;
    }
    if(raw.includes('帥')||/Đỏ/i.test(raw)){
      badge.classList.add('ux-red','ux-first');
      badge.textContent='帥 QUÂN ĐỎ · ĐI TRƯỚC';
      return;
    }
    if(raw.includes('將')){
      badge.classList.add('ux-black','ux-second');
      badge.textContent='將 QUÂN ĐEN · ĐI SAU';
      return;
    }
    if(raw.includes('✕')){
      badge.classList.add('ux-caro-x','ux-first');
      badge.textContent='✕ X · ĐI TRƯỚC';
      return;
    }
    if(raw.includes('○')){
      badge.classList.add('ux-caro-o','ux-second');
      badge.textContent='○ O · ĐI SAU';
      return;
    }
    if(/Đen/i.test(raw)){
      badge.classList.add('ux-black');
    }
  });
}

function decorateCaro(){
  const board=$('.board.caro');
  if(!board)return;
  const myBadge=$('.combatant.you .color-badge');
  const badgeText=(myBadge?.textContent||'').trim();
  const myMarker=badgeText.includes('✕')?'x':badgeText.includes('○')?'o':null;

  $$('.cell',board).forEach(cell=>{
    cell.classList.remove('ux-caro-x','ux-caro-o','ux-caro-me','ux-caro-opp');
    const mark=(cell.textContent||'').trim();
    if(mark==='✕'){
      cell.classList.add('ux-caro-x');
      if(myMarker)cell.classList.add(myMarker==='x'?'ux-caro-me':'ux-caro-opp');
    }else if(mark==='○'){
      cell.classList.add('ux-caro-o');
      if(myMarker)cell.classList.add(myMarker==='o'?'ux-caro-me':'ux-caro-opp');
    }
  });
}

function decorateCombatants(){
  const stage=$('.versus-stage');
  if(!stage)return;
  const mine=$('.combatant.you',stage);
  const opponent=$('.combatant:not(.you)',stage);
  mine?.classList.add('ux-player-card');
  opponent?.classList.add('ux-opponent-card');
}

function decorateActions(){
  const bar=$('.match-actions-bar');
  if(!bar)return;
  bar.classList.toggle('ux-simple-actions',Boolean($('#drawBtn',bar)&&$('#surrenderBtn',bar)));
}

function enhance(){
  decorateColorBadges();
  decorateCombatants();
  decorateCaro();
  decorateActions();
}

let queued=false;
const queueEnhance=()=>{
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;enhance();});
};

const observer=new MutationObserver(queueEnhance);
observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
window.addEventListener('hashchange',queueEnhance);
window.addEventListener('load',queueEnhance);
queueEnhance();
})();
