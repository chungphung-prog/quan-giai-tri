(() => {
  'use strict';

  const src = document.currentScript?.src || '';
  let currentBuild = '';
  try { currentBuild = new URL(src, location.href).searchParams.get('v') || ''; } catch {}
  let pendingBuild = '';
  let checking = false;
  let banner = null;

  function inProtectedPlay(){
    if(location.pathname.startsWith('/solo')) return /^#\/game\//.test(location.hash);
    return /^#match\//.test(location.hash);
  }

  function ensureBanner(){
    if(banner?.isConnected) return banner;
    banner=document.createElement('div');
    banner.id='qgtUpdateNotice';
    banner.setAttribute('role','status');
    banner.innerHTML='<span>✨ Có bản mới</span><small>Sẽ tự cập nhật khi bạn rời ván hiện tại.</small>';
    Object.assign(banner.style,{
      position:'fixed',right:'16px',bottom:location.pathname.startsWith('/solo')?'16px':'84px',zIndex:'9999',
      maxWidth:'300px',padding:'10px 13px',borderRadius:'13px',background:'rgba(17,20,36,.96)',
      border:'1px solid rgba(123,97,255,.32)',boxShadow:'0 14px 38px rgba(0,0,0,.32)',
      color:'#f7f8ff',fontFamily:'Inter,system-ui,sans-serif',display:'grid',gap:'2px'
    });
    const strong=banner.querySelector('span'),small=banner.querySelector('small');
    if(strong)Object.assign(strong.style,{fontWeight:'850',fontSize:'11px'});
    if(small)Object.assign(small.style,{fontSize:'9px',color:'#9da6bb',lineHeight:'1.4'});
    document.body.appendChild(banner);
    return banner;
  }

  function reloadFresh(){
    if(!pendingBuild) return;
    const u=new URL(location.href);
    u.searchParams.set('__build',pendingBuild);
    location.replace(u.toString());
  }

  function applyWhenSafe(){
    if(!pendingBuild) return;
    if(inProtectedPlay()) { ensureBanner(); return; }
    reloadFresh();
  }

  async function check(){
    if(checking) return;
    checking=true;
    try{
      const res=await fetch(`/build.json?_=${Date.now()}`,{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
      if(!res.ok) return;
      const data=await res.json();
      const remote=String(data?.build||'');
      if(remote && currentBuild && remote!==currentBuild){pendingBuild=remote;applyWhenSafe();}
    }catch{}finally{checking=false;}
  }

  window.addEventListener('hashchange',()=>setTimeout(applyWhenSafe,120),{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();},{passive:true});
  window.addEventListener('focus',check,{passive:true});
  setTimeout(check,8000);
  setInterval(check,60000);
})();
