(()=>{
'use strict';
const STORE='qgt-audio-enabled-v1';
const VOL_STORE='qgt-audio-levels-v1';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
class AudioDirector{
  constructor(){
    this.version='4.1.7';
    this.enabled=localStorage.getItem(STORE)==='1';
    this.mode='dashboard';
    this.intensity=.25;
    this.customUrl='';
    this.ctx=null;this.master=null;this.musicGain=null;this.sfxGain=null;this.limiter=null;
    this.musicLevel=.30;this.sfxLevel=.60;
    try{const saved=JSON.parse(localStorage.getItem(VOL_STORE)||'null');if(saved){this.musicLevel=clamp(Number(saved.music)||.72,.05,1);this.sfxLevel=clamp(Number(saved.sfx)||.9,.05,1);}}catch{}
    this.timer=null;this.nextNoteTime=0;this.step=0;this.audio=null;this.unlocked=false;
    const unlock=()=>{this.unlocked=true;if(this.enabled)this.start();};
    window.addEventListener('pointerdown',unlock,{once:true,capture:true});
    window.addEventListener('keydown',unlock,{once:true,capture:true});
  }
  _ensureCtx(){
    if(this.ctx)return this.ctx;
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;
    const c=new C();this.ctx=c;
    this.master=c.createGain();this.master.gain.value=.82;
    this.limiter=c.createDynamicsCompressor();this.limiter.threshold.value=-7;this.limiter.knee.value=10;this.limiter.ratio.value=10;this.limiter.attack.value=.003;this.limiter.release.value=.2;
    this.master.connect(this.limiter);this.limiter.connect(c.destination);
    this.musicGain=c.createGain();this.musicGain.gain.value=this.musicLevel;this.musicGain.connect(this.master);
    this.sfxGain=c.createGain();this.sfxGain.gain.value=this.sfxLevel;this.sfxGain.connect(this.master);
    return c;
  }
  setEnabled(v){this.enabled=Boolean(v);localStorage.setItem(STORE,this.enabled?'1':'0');if(this.enabled)this.start();else this.stop();}
  setLevels(music,sfx){
    if(Number.isFinite(Number(music)))this.musicLevel=clamp(Number(music),.05,1);
    if(Number.isFinite(Number(sfx)))this.sfxLevel=clamp(Number(sfx),.05,1);
    localStorage.setItem(VOL_STORE,JSON.stringify({music:this.musicLevel,sfx:this.sfxLevel}));
    const c=this.ctx;if(c){const t=c.currentTime;this.musicGain?.gain.setTargetAtTime(this.musicLevel,t,.03);this.sfxGain?.gain.setTargetAtTime(this.sfxLevel,t,.03);}
    if(this.audio)this.audio.volume=this._trackVolume();
  }
  _trackVolume(){const base=this.mode==='game'?.82:.58;return clamp(base*this.musicLevel,.05,1);}
  setMode(mode,intensity){this.mode=mode==='game'?'game':'dashboard';if(Number.isFinite(intensity))this.intensity=clamp(intensity,0,1);this.step=0;this.nextNoteTime=0;if(this.enabled&&this.unlocked)this.start();}
  setIntensity(v){this.intensity=clamp(Number(v)||0,0,1);}
  setCustomTrack(url){url=String(url||'');if(url===this.customUrl)return;this.customUrl=url;if(this.audio){this.audio.pause();this.audio.src='';this.audio=null;}if(this.enabled&&this.unlocked)this.start();}
  async start(){
    if(!this.enabled)return;
    if(this.customUrl){
      if(!this.audio){const a=new Audio(this.customUrl);a.loop=true;a.preload='auto';a.volume=this._trackVolume();this.audio=a;}
      this.audio.volume=this._trackVolume();
      try{await this.audio.play();}catch{return;}
      this._stopSynth();return;
    }
    if(this.audio){this.audio.pause();}
    const c=this._ensureCtx();if(!c)return;try{await c.resume();}catch{return;}
    if(this.timer)return;this.nextNoteTime=c.currentTime+.05;this.timer=setInterval(()=>this._tick(),120);this._tick();
  }
  stop(){if(this.audio)this.audio.pause();this._stopSynth();}
  _stopSynth(){if(this.timer){clearInterval(this.timer);this.timer=null;}this.nextNoteTime=0;}
  _midi(n){return 440*Math.pow(2,(n-69)/12);}
  _tone(note,t,dur,type='sine',gain=.05,dest){const c=this._ensureCtx();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(this._midi(note),t);g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(dest||this.musicGain);o.start(t);o.stop(t+dur+.03);}
  _kick(t,gain=.08){const c=this._ensureCtx();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(130,t);o.frequency.exponentialRampToValueAtTime(46,t+.12);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+.15);o.connect(g);g.connect(this.musicGain);o.start(t);o.stop(t+.17);}
  _tick(){const c=this.ctx;if(!c||c.state!=='running'||!this.enabled||this.customUrl)return;const bpm=this.mode==='game'?132+Math.round(this.intensity*54):82;const beat=60/bpm/2;while(this.nextNoteTime<c.currentTime+.55){this._schedule(this.nextNoteTime,this.step++);this.nextNoteTime+=beat;}}
  _schedule(t,s){
    if(this.mode==='dashboard'){
      const roots=[45,45,48,43],root=roots[Math.floor(s/8)%roots.length];
      if(s%8===0){this._tone(root,t,1.7,'sine',.055);this._tone(root+7,t,1.55,'triangle',.025);}
      const melody=[0,7,10,12,7,3,10,7][s%8];if(s%2===0)this._tone(root+12+melody,t,.34,'triangle',.018);
      if(s%4===2)this._tone(root+24+[0,3,7,10][Math.floor(s/4)%4],t,.16,'sine',.009);
    }else{
      const root=40,seq=[0,0,3,5,7,5,10,7,12,10,7,5,3,5,7,10];const n=root+seq[s%seq.length];
      if(s%4===0)this._kick(t,.055+.035*this.intensity);
      this._tone(n,t,.16,'sawtooth',.018+.012*this.intensity);
      if(s%2===0)this._tone(root-12+(s%8===0?0:7),t,.28,'square',.012+.008*this.intensity);
      if(this.intensity>.6&&s%4===3)this._tone(root+24+[7,10,12,15][Math.floor(s/4)%4],t,.08,'square',.007);
    }
  }
  sfx(freq=520,dur=.06,type='sine',gain=.045){if(!this.enabled)return;const c=this._ensureCtx();if(!c)return;c.resume().catch(()=>{});const t=c.currentTime+.006,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(Math.max(50,Number(freq)||520),t);g.gain.setValueAtTime(Math.max(.001,gain),t);g.gain.exponentialRampToValueAtTime(.0001,t+Math.max(.02,dur));o.connect(g);g.connect(this.sfxGain);o.start(t);o.stop(t+Math.max(.03,dur)+.02);}
  victory(){[659,784,988,1319].forEach((f,i)=>setTimeout(()=>this.sfx(f,.18,'triangle',.06),i*95));}
  defeat(){[392,330,262,196].forEach((f,i)=>setTimeout(()=>this.sfx(f,.2,'sawtooth',.045),i*120));}
}
window.QGTAudio=new AudioDirector();
})();
