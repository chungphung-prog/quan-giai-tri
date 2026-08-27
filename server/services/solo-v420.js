import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSoloAppV419 } from './solo-v419.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const patchDir=path.resolve(__dirname,'../patches');
let cached=null;

function fragment(name){return fs.readFileSync(path.join(patchDir,name),'utf8').trimEnd();}
function replaceBlock(source,id,nextId,code){
  const start=source.indexOf(`  register('${id}'`);
  const end=source.indexOf(`\n\n  register('${nextId}'`,start+1);
  if(start<0||end<0)throw new Error(`solo-v420: cannot locate renderer ${id} -> ${nextId}`);
  return source.slice(0,start)+code+source.slice(end);
}
function replaceOnce(source,from,to,label){
  if(!source.includes(from))throw new Error(`solo-v420: cannot locate ${label}`);
  return source.replace(from,to);
}

export function transformSoloAppV420(input){
  let source=transformSoloAppV419(input);

  // Sudoku is now procedural per server-issued run seed, with a uniqueness check.
  source=replaceBlock(source,'sudoku','2048',fragment('solo-sudoku-v420.jsfrag'));

  // The restart CTA must clearly mean a genuinely new server run.
  source=replaceOnce(source,'↻ Chơi lại','↻ Lượt mới','new run label');
  source=replaceOnce(
    source,
    "const special=id==='sudoku'?'<div class=\"rule-alert\">❤️ 3 lỗi = thua & không nhận XP/Point <span>•</span> 💡 Gợi ý tối đa 2 lần</div>':'';",
    "const special=id==='sudoku'?'<div class=\"rule-alert\">🎲 Mỗi lượt = một bàn Sudoku mới <span>•</span> ❤️ 3 lỗi = thua & 0 XP/Point <span>•</span> 💡 Tối đa 2 gợi ý</div>':'';",
    'sudoku new board notice'
  );

  // Fresh-start polish for arcade games whose first frame used to look identical.
  source=replaceOnce(source,"food={x:15,y:10}","food={x:0,y:0}",'snake initial food');
  source=replaceOnce(source,"window.addEventListener('keydown',key);timer=setTimeout(tick,250);", "newFood();window.addEventListener('keydown',key);timer=setTimeout(tick,250);",'snake fresh food');
  source=replaceOnce(source,"vx=290,vy=185,ps=0", "vx=(rand()<.5?-1:1)*(270+rand()*45),vy=(rand()<.5?-1:1)*(135+rand()*90),ps=0",'pong fresh serve');
  source=replaceOnce(source,"pipes=[{x:780,gap:165,gy:220,passed:false}]", "pipes=[{x:750+rand()*70,gap:160+rand()*12,gy:130+rand()*180,passed:false}]",'flappy fresh first gate');
  source=replaceOnce(source,"blocks=[{x:100,y:560,w:260,h:30,hue:260}],cur={x:0,y:530,w:260,h:30,v:185,hue:190}", "blocks=[{x:100,y:560,w:260,h:30,hue:220+Math.floor(rand()*100)}],cur={x:rand()*200,y:530,w:260,h:30,v:(rand()<.5?-1:1)*(170+rand()*35),hue:Math.floor(rand()*360)}",'stacktower fresh start');

  return source;
}

function build(publicDir){return transformSoloAppV420(fs.readFileSync(path.join(publicDir,'solo','app.js'),'utf8'));}
export function serveSoloAppV420(publicDir){
  return (req,res,next)=>{
    try{
      if(!cached)cached=build(publicDir);
      res.type('application/javascript; charset=utf-8').send(cached);
    }catch(error){
      console.error(JSON.stringify({level:'error',event:'solo_v420_transform_failed',message:error.message}));
      next(error);
    }
  };
}
