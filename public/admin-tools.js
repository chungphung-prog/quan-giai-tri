(()=>{
'use strict';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
let csrfToken='';
let csrfPromise=null;

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function getCsrf(){
  if(csrfToken)return csrfToken;
  if(!csrfPromise)csrfPromise=fetch('/api/me',{credentials:'same-origin',headers:{Accept:'application/json'}})
    .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||`HTTP ${r.status}`);csrfToken=data.csrfToken||'';return csrfToken;})
    .finally(()=>{csrfPromise=null;});
  return csrfPromise;
}

async function adminApi(url,{method='GET',body}={}){
  const headers={Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(!['GET','HEAD'].includes(method))headers['X-CSRF-Token']=await getCsrf();
  const res=await fetch(url,{method,credentials:'same-origin',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(res.status===204)return null;
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    if(res.status===403&&data.error==='BAD_CSRF'){csrfToken='';}
    const e=new Error(data.message||data.error||`HTTP ${res.status}`);e.status=res.status;e.code=data.error;throw e;
  }
  return data;
}

function notice(message,bad=false){
  let box=$('#adminToolsNotice');
  if(!box){box=document.createElement('div');box.id='adminToolsNotice';box.className='admin-tools-notice';document.body.appendChild(box);}
  box.textContent=message;
  box.classList.toggle('bad',bad);
  box.classList.add('show');
  clearTimeout(box._hideTimer);
  box._hideTimer=setTimeout(()=>box.classList.remove('show'),2800);
}

function updateBulkState(surface){
  const checks=$$('.admin-chat-check',surface);
  const selected=checks.filter(c=>c.checked);
  const count=$('.chat-selected-count',surface);
  const del=$('[data-bulk-delete-chat]',surface);
  const all=$('.admin-chat-check-all',surface);
  if(count)count.textContent=`${selected.length} đã chọn`;
  if(del)del.disabled=selected.length===0;
  if(all){all.checked=checks.length>0&&selected.length===checks.length;all.indeterminate=selected.length>0&&selected.length<checks.length;}
}

function enhanceBulkChat(){
  const deleteButtons=$$('[data-delete-chat]');
  if(!deleteButtons.length)return;
  const rows=deleteButtons.map(b=>b.closest('.chat-mod')).filter(Boolean);
  const surface=rows[0]?.closest('.surface');
  if(!surface)return;

  rows.forEach(row=>{
    const btn=$('[data-delete-chat]',row);
    if(!btn||$('.admin-chat-check',row))return;
    row.dataset.adminChatId=btn.dataset.deleteChat;
    row.dataset.chatId=btn.dataset.deleteChat;
    const wrap=document.createElement('label');
    wrap.className='admin-chat-check-wrap';
    wrap.title='Chọn tin nhắn';
    wrap.innerHTML='<input class="admin-chat-check" type="checkbox"><span></span>';
    row.prepend(wrap);
    $('.admin-chat-check',wrap).addEventListener('change',()=>updateBulkState(surface));
  });

  if(!$('.chat-bulk-toolbar',surface)){
    const head=$('.surface-head',surface);
    const toolbar=document.createElement('div');
    toolbar.className='chat-bulk-toolbar';
    toolbar.innerHTML=`<label class="chat-select-all"><input class="admin-chat-check-all" type="checkbox"><span>Chọn tất cả</span></label><span class="chat-selected-count">0 đã chọn</span><button class="btn compact danger-btn" data-bulk-delete-chat disabled>🗑 Xóa đã chọn</button>`;
    head?.insertAdjacentElement('afterend',toolbar);
    $('.admin-chat-check-all',toolbar)?.addEventListener('change',e=>{
      $$('.admin-chat-check',surface).forEach(c=>{c.checked=e.target.checked;});
      updateBulkState(surface);
    });
    $('[data-bulk-delete-chat]',toolbar)?.addEventListener('click',async e=>{
      const btn=e.currentTarget;
      const selected=$$('.admin-chat-check:checked',surface);
      const ids=selected.map(c=>Number(c.closest('.chat-mod')?.dataset.adminChatId)).filter(Number.isFinite);
      if(!ids.length)return;
      if(!confirm(`Xóa ${ids.length} tin nhắn đã chọn? Hành động sẽ được ghi audit.`))return;
      btn.disabled=true;btn.textContent='⏳ Đang xóa…';
      try{
        const result=await adminApi('/api/admin/chat/bulk-delete',{method:'POST',body:{ids}});
        const deleted=new Set((result?.deleted||ids).map(String));
        rows.forEach(row=>{if(deleted.has(String(row.dataset.adminChatId)))row.remove();});
        notice(`Đã xóa ${deleted.size} tin nhắn và ghi audit`);
      }catch(err){notice(err.message,true);}
      finally{btn.textContent='🗑 Xóa đã chọn';updateBulkState(surface);}
    });
  }
  updateBulkState(surface);
}

function closeOwnModal(){const root=$('#modalRoot');if(root)root.innerHTML='';}

function openResetModal(id,name,row){
  const root=$('#modalRoot');if(!root)return;
  root.innerHTML=`<div class="modal-backdrop"><div class="simple-modal admin-reset-modal"><button class="modal-x" data-reset-close>×</button><span class="eyebrow">RESET USER DATA</span><h2>Reset dữ liệu ${esc(name)}</h2><div class="reset-warning"><b>⚠ Hành động phá hủy dữ liệu progression</b><p>XP → 0, Point → 0, Level → 1, tổng game → 0; xóa rating PvP, điểm solo, reward ledger và achievement. Tài khoản, chat và lịch sử trận chung vẫn được giữ.</p></div><label>Lý do<textarea id="resetUserReason" rows="3" placeholder="VD: Reset dữ liệu để bắt đầu mùa mới">Admin reset dữ liệu progression</textarea></label><label class="reset-confirm-label">Gõ <b>RESET</b> để xác nhận<input id="resetUserConfirm" autocomplete="off" placeholder="RESET"></label><div class="row"><button id="confirmUserReset" class="btn danger-btn" disabled>↺ Reset về ban đầu</button><button class="btn glass-btn" data-reset-close>Hủy</button></div></div></div>`;
  $$('[data-reset-close]',root).forEach(b=>b.onclick=closeOwnModal);
  const input=$('#resetUserConfirm',root),confirmBtn=$('#confirmUserReset',root);
  input.oninput=()=>{confirmBtn.disabled=input.value.trim()!=='RESET';};
  confirmBtn.onclick=async()=>{
    if(input.value.trim()!=='RESET')return;
    confirmBtn.disabled=true;confirmBtn.textContent='⏳ Đang reset…';
    try{
      const result=await adminApi(`/api/admin/users/${encodeURIComponent(id)}/reset-progress`,{method:'POST',body:{confirm:'RESET',reason:$('#resetUserReason',root).value.trim()||'Admin reset dữ liệu progression'}});
      const small=$('.admin-user-info small',row);
      if(small){const email=(small.textContent||'').split('•')[0].trim();small.textContent=`${email} • 0 XP • 0 Point`;}
      row.classList.add('user-reset-flash');
      setTimeout(()=>row.classList.remove('user-reset-flash'),1200);
      closeOwnModal();
      notice(`${result?.user?.name||name}: đã reset về Lv.1 / 0 XP / 0 Point`);
    }catch(err){
      confirmBtn.disabled=false;confirmBtn.textContent='↺ Reset về ban đầu';
      notice(err.message,true);
    }
  };
  input.focus();
}

function enhanceUserReset(){
  $$('[data-adjust-user]').forEach(adjust=>{
    if(adjust.dataset.resetToolBound==='1')return;
    adjust.dataset.resetToolBound='1';
    const row=adjust.closest('.admin-user-row');
    if(!row)return;
    const id=adjust.dataset.adjustUser;
    const name=adjust.dataset.name||$('.admin-user-info b',row)?.textContent||'user';
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='reset-user-btn';
    btn.dataset.resetUser=id;
    btn.title='Reset XP, Point, level, rating, score và achievement';
    btn.textContent='↺ Reset';
    adjust.insertAdjacentElement('afterend',btn);
    btn.onclick=()=>openResetModal(id,name,row);
  });
}

function enhance(){
  if(location.hash!=='#admin')return;
  enhanceBulkChat();
  enhanceUserReset();
}

let queued=false;
function queueEnhance(){
  if(queued)return;queued=true;
  requestAnimationFrame(()=>{queued=false;enhance();});
}

new MutationObserver(queueEnhance).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',queueEnhance);
window.addEventListener('load',queueEnhance);
queueEnhance();
})();
