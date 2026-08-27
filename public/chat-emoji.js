(()=>{
'use strict';
const groups={
  'Cảm xúc':['😀','😄','😁','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳','😏','🤔','🙄','😴','😭','😤','😡','🤯','🥶','😱','🤝','🙏','👏','👍','👎','💪','❤️','💜','🔥','✨','🎉','💯'],
  'Game':['🎮','🕹️','⚔️','🏆','🥇','🥈','🥉','🎯','🎲','♟️','🃏','💣','🚀','🐍','🏓','🧩','🔢','💥','☠️','👑','GG','EZ'],
  'Biểu tượng':['☕','💻','⌨️','🖱️','📌','📣','✅','❌','⚠️','❓','❗','💬','👀','👉','👈','⬆️','⬇️','➡️','⬅️','⭐','🌟','⚡','💎','◆','✦','♛','∞','✓']
};
let activeGroup='Cảm xúc',activeInput=null,activeButton=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function insertAtCaret(input,text){
  if(!input)return;
  const start=Number.isInteger(input.selectionStart)?input.selectionStart:input.value.length;
  const end=Number.isInteger(input.selectionEnd)?input.selectionEnd:start;
  const max=Number(input.maxLength)>0?Number(input.maxLength):300;
  const next=input.value.slice(0,start)+text+input.value.slice(end);
  if(next.length>max)return;
  input.value=next;
  const pos=start+text.length;
  input.focus();
  try{input.setSelectionRange(pos,pos)}catch{}
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
function ensurePicker(){
  let picker=document.getElementById('qgtChatEmojiPicker');
  if(picker)return picker;
  picker=document.createElement('div');
  picker.id='qgtChatEmojiPicker';
  picker.className='chat-emoji-picker';
  picker.setAttribute('role','dialog');
  picker.setAttribute('aria-label','Chọn emoji và biểu tượng');
  document.body.appendChild(picker);
  picker.addEventListener('click',e=>e.stopPropagation());
  return picker;
}
function pickerHtml(){
  const tabs=Object.keys(groups).map(name=>`<button type="button" class="chat-emoji-tab ${name===activeGroup?'active':''}" data-emoji-tab="${esc(name)}">${esc(name)}</button>`).join('');
  const items=groups[activeGroup].map(item=>`<button type="button" class="chat-emoji-item ${/^[\x00-\x7F]+$/.test(item)?'symbol':''}" data-emoji-value="${esc(item)}" title="${esc(item)}">${esc(item)}</button>`).join('');
  return `<div class="chat-emoji-tabs">${tabs}</div><div class="chat-emoji-grid">${items}</div><div class="chat-emoji-tip">Chạm biểu tượng để chèn vào tin nhắn.</div>`;
}
function renderPicker(){
  const picker=ensurePicker();
  picker.innerHTML=pickerHtml();
  picker.querySelectorAll('[data-emoji-tab]').forEach(tab=>tab.onclick=e=>{e.stopPropagation();activeGroup=tab.dataset.emojiTab;renderPicker();positionPicker();});
  picker.querySelectorAll('[data-emoji-value]').forEach(item=>item.onclick=e=>{e.stopPropagation();insertAtCaret(activeInput,item.dataset.emojiValue);});
}
function clamp(v,min,max){return Math.min(max,Math.max(min,v));}
function positionPicker(){
  const picker=ensurePicker();
  if(!picker.classList.contains('open')||!activeButton?.isConnected)return;
  const margin=6,gap=9,br=activeButton.getBoundingClientRect();
  picker.style.width='';picker.style.left='0px';picker.style.top='0px';
  const desired=Math.min(window.innerWidth<=420?window.innerWidth-12:336,window.innerWidth-margin*2);
  picker.style.width=`${Math.max(250,desired)}px`;
  const pr=picker.getBoundingClientRect();
  const left=clamp(br.right-pr.width,margin,Math.max(margin,window.innerWidth-pr.width-margin));
  let top=br.top-pr.height-gap;
  if(top<margin)top=br.bottom+gap;
  top=clamp(top,margin,Math.max(margin,window.innerHeight-pr.height-margin));
  picker.style.left=`${Math.round(left)}px`;
  picker.style.top=`${Math.round(top)}px`;
}
function closePicker(){
  const picker=ensurePicker();picker.classList.remove('open');
  if(activeButton){activeButton.setAttribute('aria-expanded','false');}
  activeButton=null;activeInput=null;
}
function openPicker(btn,input){
  if(activeButton===btn&&ensurePicker().classList.contains('open')){closePicker();return;}
  if(activeButton)activeButton.setAttribute('aria-expanded','false');
  activeButton=btn;activeInput=input;btn.setAttribute('aria-expanded','true');
  renderPicker();const picker=ensurePicker();picker.classList.add('open');
  requestAnimationFrame(positionPicker);
}
function bindTool(compose,input){
  let tool=compose.querySelector('.chat-emoji-tools');
  if(!tool){
    tool=document.createElement('div');tool.className='chat-emoji-tools';
    tool.innerHTML='<button type="button" class="chat-emoji-toggle" title="Emoji & biểu tượng" aria-label="Emoji & biểu tượng" aria-haspopup="dialog" aria-expanded="false"><span>😊</span><i>+</i></button>';
    const send=compose.querySelector('#chatSend');
    if(send)compose.insertBefore(tool,send);else compose.appendChild(tool);
  }
  const btn=tool.querySelector('.chat-emoji-toggle');
  if(btn&&!btn.dataset.emojiBound){
    btn.dataset.emojiBound='1';
    btn.addEventListener('click',e=>{e.stopPropagation();openPicker(btn,input);});
  }
  const send=compose.querySelector('#chatSend');
  if(send){send.title='Gửi tin nhắn';send.setAttribute('aria-label','Gửi tin nhắn');}
}
function inject(){
  const compose=document.querySelector('.chat-compose'),input=document.querySelector('#chatInput');
  if(!compose||!input)return;
  bindTool(compose,input);
}
let raf=0;
const observer=new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(inject);});
observer.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('click',e=>{const picker=ensurePicker();if(picker.classList.contains('open')&&!picker.contains(e.target)&&e.target!==activeButton)closePicker();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePicker();});
window.addEventListener('resize',()=>requestAnimationFrame(positionPicker),{passive:true});
window.addEventListener('scroll',()=>requestAnimationFrame(positionPicker),{passive:true,capture:true});
inject();
})();
