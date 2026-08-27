(()=>{
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const RANKS=[
  {name:'Tân binh',minLevel:1,icon:'🌱'},
  {name:'Lính mới',minLevel:5,icon:'🪖'},
  {name:'Chiến binh',minLevel:10,icon:'⚔️'},
  {name:'Tinh anh',minLevel:20,icon:'🛡️'},
  {name:'Cao thủ',minLevel:35,icon:'🔥'},
  {name:'Bậc thầy',minLevel:50,icon:'👑'},
  {name:'Đại cao thủ',minLevel:70,icon:'💎'},
  {name:'Huyền thoại',minLevel:90,icon:'🌌'},
  {name:'Tối thượng',minLevel:100,icon:'🏆'}
];
let meCache=null,meCacheAt=0,busyProfile=false,busyLeaderboard=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function xpForLevel(level){level=Math.max(1,Math.min(100,Number(level)||1));if(level<=1)return 0;const n=level-1;return Math.round(220*Math.pow(n,1.78)+90*n);}
function levelFromXp(xp){xp=Math.max(0,Number(xp)||0);let l=1;while(l<100&&xp>=xpForLevel(l+1))l++;return l;}
async function fetchJson(url){const r=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}
async function getMe(){if(meCache&&Date.now()-meCacheAt<4000)return meCache;meCache=await fetchJson('/api/me');meCacheAt=Date.now();return meCache;}
function currentRank(level){let cur=RANKS[0];for(const r of RANKS){if(level>=r.minLevel)cur=r;else break;}return cur;}
function nextRank(level){return RANKS.find(r=>r.minLevel>level)||null;}
function makeRankPanel(progress){
  const level=Number(progress.level||1),rank=progress.rank?.name?progress.rank:currentRank(level),next=progress.rank?.next||nextRank(level);
  const toNext=next?Math.max(0,xpForLevel(next.minLevel)-Number(progress.xp||0)):0;
  const el=document.createElement('section');el.className='progression-rank-panel surface';
  el.innerHTML=`<div class="progression-rank-main"><span class="rank-big-icon">${esc(rank.icon||currentRank(level).icon)}</span><div><span class="eyebrow">DANH HIỆU HIỆN TẠI</span><h2>${esc(rank.name||currentRank(level).name)} <small>Lv.${level}</small></h2><p>${next?`Còn <b>${toNext.toLocaleString('vi-VN')} XP</b> để bước vào <b>${esc(next.name)}</b> ở Lv.${next.minLevel}.`:'Đã chạm đỉnh progression hiện tại.'}</p></div></div><div class="rank-ladder">${RANKS.map(r=>`<span class="rank-step ${level>=r.minLevel?'done':''} ${rank.name===r.name?'active':''}" title="${esc(r.name)} • Lv.${r.minLevel}"><i>${r.icon}</i><b>${esc(r.name)}</b><small>Lv.${r.minLevel}</small></span>`).join('')}</div>`;
  return el;
}
async function enhanceProfile(){
  if(location.hash!=='#profile'||busyProfile)return;
  const grid=$('.achievement-grid');if(!grid||grid.dataset.progressionGrouped==='1')return;
  busyProfile=true;
  try{
    const {progress}=await getMe();if(!progress?.achievements?.length)return;
    const cards=[...grid.children].filter(x=>x.classList.contains('achievement-card'));
    if(!cards.length)return;
    grid.dataset.progressionGrouped='1';
    const hero=$('.profile-hero');if(hero&&!$('.progression-rank-panel'))hero.insertAdjacentElement('afterend',makeRankPanel(progress));
    const sectionHead=grid.previousElementSibling;if(sectionHead?.classList.contains('section-head')){const h=sectionHead.querySelector('h2');if(h)h.textContent='Bộ sưu tập thành tựu';}
    const grouped=new Map();
    progress.achievements.forEach((a,i)=>{const cat=a.category||'Tân binh';if(!grouped.has(cat))grouped.set(cat,{order:Number(a.categoryOrder||99),items:[]});if(cards[i])grouped.get(cat).items.push({a,card:cards[i]});});
    const holder=document.createElement('div');holder.className='achievement-categories';
    [...grouped.entries()].sort((x,y)=>x[1].order-y[1].order).forEach(([cat,g])=>{
      const unlocked=g.items.filter(x=>x.a.unlockedAt).length;
      const group=document.createElement('section');group.className=`achievement-category achievement-category-${g.order}`;
      group.innerHTML=`<div class="achievement-category-head"><div><span class="eyebrow">BẬC ${g.order}</span><h3>${esc(cat)}</h3></div><span>${unlocked}/${g.items.length} đã mở</span></div><div class="achievement-category-grid"></div>`;
      const target=$('.achievement-category-grid',group);
      g.items.forEach(({a,card})=>{card.dataset.category=cat;const tier=$('.tier',card);if(tier)tier.textContent=`${cat} • ${String(a.tier||'').toUpperCase()}`;target.appendChild(card);});
      holder.appendChild(group);
    });
    grid.replaceWith(holder);
    const economy=$('.economy-info .economy-cols');if(economy){const blocks=[...economy.children];if(blocks[0]?.querySelector('p'))blocks[0].querySelector('p').innerHTML='Level dùng <b>curve V2</b>, càng lên cao càng cần nhiều XP. Lv10 ≈ 11.8K XP, Lv50 ≈ 228.8K, Lv100 ≈ 793.5K.';if(blocks[1]?.querySelector('p'))blocks[1].querySelector('p').textContent='Point kiếm chậm hơn XP và PvP người thật cho hiệu suất tốt nhất. Đây là tài nguyên cạnh tranh dài hạn.';if(blocks[2]?.querySelector('p'))blocks[2].querySelector('p').textContent='Solo có daily cap; đấu AI giảm reward. Thành tựu PvP cấp cao chỉ tính trận với người thật để hạn chế farm.';}
  }catch(e){console.warn('progression profile enhance failed',e);}finally{busyProfile=false;}
}
async function enhanceLeaderboard(){
  if(location.hash!=='#leaderboards'||busyLeaderboard)return;
  const rows=$$('.mini-rank');if(!rows.length||rows[0]?.dataset.progressionV2==='1')return;
  busyLeaderboard=true;
  try{const data=await fetchJson('/api/leaderboards/progression');const list=data?.leaderboard||[];rows.forEach((row,i)=>{const em=$('em',row),u=list[i];if(em&&u){const lv=levelFromXp(u.xp);em.textContent=`Lv.${lv}`;em.title=`${currentRank(lv).name} • ${Number(u.xp||0).toLocaleString('vi-VN')} XP`;row.dataset.progressionV2='1';}});}catch(e){console.warn('progression leaderboard enhance failed',e);}finally{busyLeaderboard=false;}
}
async function enhancePopup(){
  const pop=$('.achievement-pop');if(!pop||pop.dataset.categoryEnhanced==='1')return;
  pop.dataset.categoryEnhanced='1';
  try{const {progress}=await getMe();const name=$('h2',pop)?.textContent?.trim();const a=progress?.achievements?.find(x=>x.name===name);if(!a)return;const chip=document.createElement('span');chip.className='achievement-category-chip';chip.textContent=`${a.category} • ${String(a.tier||'').toUpperCase()}`;const h=$('h2',pop);h?.insertAdjacentElement('beforebegin',chip);}catch{}
}
function run(){enhanceProfile();enhanceLeaderboard();enhancePopup();}
let queued=false;function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;run();});}
new MutationObserver(queue).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>{meCache=null;queue();});window.addEventListener('load',queue);queue();
})();
