(()=>{
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrf='',stateCache=null,testUsersCache=null,busy=false;
async function fetchJson(url,options={}){const r=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json',...(options.headers||{})},...options});const data=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(data.message||data.error||`HTTP ${r.status}`);e.code=data.error;throw e;}return data;}
async function getCsrf(){if(csrf)return csrf;const me=await fetchJson('/api/me');csrf=me.csrfToken||'';return csrf;}
async function post(url,body){const token=await getCsrf();return fetchJson(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body||{})});}
function notice(msg,bad=false){let el=$('#testUserNotice');if(!el){el=document.createElement('div');el.id='testUserNotice';el.className='test-user-notice';document.body.appendChild(el);}el.textContent=msg;el.classList.toggle('bad',bad);el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),3200);}
function closeModal(){const root=$('#modalRoot');if(root)root.innerHTML='';}
async function showLoginLink(user){
  try{
    const data=await post(`/api/admin/test-users/${encodeURIComponent(user.id)}/login-link`,{});
    const root=$('#modalRoot');if(!root)return;
    root.innerHTML=`<div class="modal-backdrop"><div class="simple-modal test-login-modal"><button class="modal-x" data-test-close>×</button><span class="eyebrow">ONE-TIME TEST LOGIN</span><h2>🧪 ${esc(data.user.email)}</h2><p class="test-login-warning"><b>Không mở link này trong cùng browser profile đang đăng nhập Admin.</b><br>Dùng Chrome Profile khác / Edge InPrivate / Firefox Private. Link dùng 1 lần và hết hạn sau 5 phút.</p><label>Link đăng nhập test<input id="testLoginUrl" readonly value="${esc(data.loginUrl)}"></label><div class="row"><button id="copyTestLogin" class="btn primary">📋 Copy link</button><button class="btn glass-btn" data-test-close>Đóng</button></div><div class="admin-note">Muốn test PvP 2 người cùng lúc: giữ Admin ở browser hiện tại, mở Test 1 ở một browser/profile riêng và Test 2 ở browser/profile thứ ba.</div></div></div>`;
    $$('[data-test-close]',root).forEach(b=>b.onclick=closeModal);
    $('#copyTestLogin',root).onclick=async()=>{const input=$('#testLoginUrl',root);try{await navigator.clipboard.writeText(input.value);notice('Đã copy link đăng nhập test');}catch{input.select();document.execCommand('copy');notice('Đã copy link đăng nhập test');}};
  }catch(e){notice(e.message,true);}
}
async function enhanceAdmin(){
  if(location.hash!=='#admin')return;
  if(!testUsersCache){try{testUsersCache=(await fetchJson('/api/admin/test-users')).users||[];}catch{return;}}
  const byEmail=new Map(testUsersCache.map(u=>[String(u.email).toLowerCase(),u]));
  $$('.admin-user-row').forEach(row=>{
    if(row.dataset.testUserEnhanced==='1')return;
    const small=$('.admin-user-info small',row),email=(small?.textContent||'').split('•')[0].trim().toLowerCase(),user=byEmail.get(email);if(!user)return;
    row.dataset.testUserEnhanced='1';row.classList.add('admin-test-user-row');
    const name=$('.admin-user-info b',row);if(name&&!$('.test-account-badge',row))name.insertAdjacentHTML('afterend','<span class="test-account-badge">🧪 TEST</span>');
    const anchor=$('[data-reset-user]',row)||$('[data-adjust-user]',row)||row.lastElementChild;
    const btn=document.createElement('button');btn.type='button';btn.className='test-login-link-btn';btn.textContent='🔑 Login test';btn.title='Tạo link đăng nhập một lần';btn.onclick=()=>showLoginLink(user);anchor?.insertAdjacentElement('afterend',btn);
  });
}
async function enhanceTestSession(){
  if(stateCache==null){try{stateCache=await fetchJson('/api/test-session/state');}catch{return;}}
  if(!stateCache?.isTestSession)return;
  if($('#testSessionBanner'))return;
  const bar=document.createElement('div');bar.id='testSessionBanner';bar.className='test-session-banner';bar.innerHTML=`<div><b>🧪 TEST SESSION</b><span>${esc(stateCache.user?.email||'test user')}</span><small>Ẩn khỏi user thật • thời gian GMT+7</small></div><button type="button" id="logoutTestSession">Đăng xuất test</button>`;document.body.appendChild(bar);
  $('#logoutTestSession').onclick=async()=>{try{const token=await getCsrf();await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':token}});location.href='/';}catch(e){notice('Không đăng xuất được test session',true);}};
}
async function run(){if(busy)return;busy=true;try{await enhanceTestSession();await enhanceAdmin();}finally{busy=false;}}
let queued=false;function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;run();});}
new MutationObserver(queue).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>{if(location.hash==='#admin')testUsersCache=null;queue();});window.addEventListener('load',queue);queue();
})();
