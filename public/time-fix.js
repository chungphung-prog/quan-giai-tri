(()=>{
'use strict';
const TZ='Asia/Ho_Chi_Minh';
const nativeFetch=window.fetch.bind(window);
const apiCache=new Map();

function normalizeDateString(value,key=''){
  if(typeof value!=='string')return value;
  const s=value.trim();
  if(key==='release_date'){
    const m=s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m?m[1]:value;
  }
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s))return s.replace(' ','T')+'Z';
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s))return s+'Z';
  return value;
}
function normalizeJson(value,key=''){
  if(Array.isArray(value))return value.map(v=>normalizeJson(v,key));
  if(value&&typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value))out[k]=normalizeJson(v,k);
    return out;
  }
  return normalizeDateString(value,key);
}

window.fetch=async function(...args){
  const res=await nativeFetch(...args);
  try{
    const rawUrl=typeof args[0]==='string'?args[0]:args[0]?.url||'';
    const url=new URL(rawUrl,location.href);
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&res.status!==204){
      const ct=res.headers.get('content-type')||'';
      if(ct.includes('application/json')){
        const data=normalizeJson(await res.clone().json());
        const headers=new Headers(res.headers);headers.set('content-type','application/json; charset=utf-8');
        return new Response(JSON.stringify(data),{status:res.status,statusText:res.statusText,headers});
      }
    }
  }catch(e){console.warn('time normalization skipped',e);}
  return res;
};

function parseUtc(v){
  if(v==null)return null;
  if(v instanceof Date)return Number.isNaN(v.getTime())?null:v;
  let s=String(v).trim();
  if(!s)return null;
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s))s=s.replace(' ','T')+'Z';
  else if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s))s+='Z';
  const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
}
function fmtDateTime(v){const d=parseUtc(v);if(!d)return '';return new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeStyle:'short',timeZone:TZ}).format(d);}
function fmtDateOnly(v){const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return '';const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),12));return new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'short',year:'numeric',timeZone:TZ}).format(d);}
async function json(url,ttl=3500){
  const hit=apiCache.get(url);if(hit&&Date.now()-hit.at<ttl)return hit.data;
  const r=await window.fetch(url,{credentials:'same-origin',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const data=await r.json();apiCache.set(url,{at:Date.now(),data});return data;
}

async function fixReleaseDates(){
  const nodes=[...document.querySelectorAll('.release-date')];if(!nodes.length)return;
  try{const data=await json('/api/releases');const list=data?.releases||[];nodes.forEach((n,i)=>{if(list[i]?.release_date){n.textContent=fmtDateOnly(list[i].release_date);n.title='Hiển thị theo GMT+7 (Asia/Ho_Chi_Minh)';}});}catch{}
}
async function fixAchievementTimes(){
  if(location.hash!=='#profile')return;
  const cards=[...document.querySelectorAll('.achievement-card')];if(!cards.length)return;
  try{const data=await json('/api/me');const map=new Map((data?.progress?.achievements||[]).map(a=>[String(a.name),a]));cards.forEach(card=>{const name=card.querySelector('h3')?.textContent?.trim(),a=map.get(String(name));if(!a?.unlockedAt)return;const small=[...card.querySelectorAll('small')].find(x=>x.textContent.trim().startsWith('Mở '));if(small){small.textContent=`Mở ${fmtDateTime(a.unlockedAt)} · GMT+7`;small.title='Asia/Ho_Chi_Minh';}});}catch{}
}
async function fixAuditTimes(){
  if(location.hash!=='#admin')return;
  const nodes=[...document.querySelectorAll('[data-panel="security"] .security-grid > .surface:first-child .audit-row time')];if(!nodes.length)return;
  try{const data=await json('/api/admin/audit?limit=120');const list=data?.events||[];nodes.forEach((n,i)=>{if(list[i]?.created_at){n.textContent=fmtDateTime(list[i].created_at);n.title='GMT+7 · Asia/Ho_Chi_Minh';}});}catch{}
}
async function fixMatchTimes(){
  if(location.hash!=='#matches')return;
  const nodes=[...document.querySelectorAll('.match-row .match-main small')];if(!nodes.length)return;
  try{const data=await json('/api/matches');const list=data?.matches||[];nodes.forEach((n,i)=>{if(list[i]?.createdAt){n.textContent=`${fmtDateTime(list[i].createdAt)} · GMT+7`;n.title='Asia/Ho_Chi_Minh';}});}catch{}
}
function stampTimezone(){document.documentElement.dataset.appTimezone=TZ;}
let queued=false;function run(){if(queued)return;queued=true;requestAnimationFrame(async()=>{queued=false;stampTimezone();await Promise.allSettled([fixReleaseDates(),fixAchievementTimes(),fixAuditTimes(),fixMatchTimes()]);});}
new MutationObserver(run).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>{apiCache.clear();run();});window.addEventListener('load',run);run();
})();
