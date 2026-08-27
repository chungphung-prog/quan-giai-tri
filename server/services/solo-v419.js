import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const patchDir=path.resolve(__dirname,'../patches');
let cached=null;

function fragment(name){return fs.readFileSync(path.join(patchDir,name),'utf8').trimEnd();}

function replaceBlock(source,id,nextId,code){
  const start=source.indexOf(`  register('${id}'`);
  const end=source.indexOf(`\n\n  register('${nextId}'`,start+1);
  if(start<0||end<0)throw new Error(`solo-v419: cannot locate renderer ${id} -> ${nextId}`);
  return source.slice(0,start)+code+source.slice(end);
}

function replaceRenderGame(source,code){
  const start=source.indexOf('  async function renderGame(id){');
  const end=source.indexOf('\n\n  function openProfile()',start+1);
  if(start<0||end<0)throw new Error('solo-v419: cannot locate renderGame');
  return source.slice(0,start)+code+source.slice(end);
}

function replaceOnce(source,from,to,label){
  if(!source.includes(from))throw new Error(`solo-v419: cannot locate ${label}`);
  return source.replace(from,to);
}

export function transformSoloAppV419(input){
  let source=String(input||'');

  // Remove the technical AI difficulty badge from solo cards.
  source=replaceOnce(
    source,
    "<span>${c.aiDifficulty==='nightmare'?'AI NIGHTMARE':g.mode}</span>",
    '<span>${g.mode}</span>',
    'solo game card mode label'
  );

  // Refresh descriptions for the seven games being visually rebuilt.
  const descriptions={
    sudoku:'Sudoku 9×9 tập trung vào logic: điền đúng từng ô, tối đa 3 lỗi và chỉ có 2 lượt gợi ý.',
    '2048':'Trượt và hợp nhất các ô số để tạo chuỗi combo, hướng tới ô 2048 và điểm số cao nhất.',
    hanoi:'Chuyển toàn bộ tháp sang cọc đích với quy tắc đĩa nhỏ luôn nằm trên đĩa lớn.',
    snake:'Điều khiển một chú rắn neon săn táo, lớn dần theo điểm và tránh tường lẫn chính cơ thể mình.',
    pong:'Pong tốc độ cao với chuyển động mượt, điều khiển thanh đỡ bằng chuột hoặc cảm ứng và đua đến 7 điểm.',
    stacktower:'Canh đúng nhịp để chồng các khối nhà cao tầng; đặt càng chuẩn, tháp càng vững và combo càng đẹp.',
    flappy:'Điều khiển chú chim công sở bay xuyên thành phố, vượt các tòa nhà và giữ nhịp càng lâu càng tốt.'
  };
  for(const [id,desc] of Object.entries(descriptions)){
    const re=new RegExp(`(\{id:'${id}',name:[^\n]*?desc:')[^']*('.*?\},?)`);
    if(!re.test(source))throw new Error(`solo-v419: cannot locate description for ${id}`);
    source=source.replace(re,`$1${desc}$2`);
  }

  source=replaceRenderGame(source,fragment('solo-render-game-v419.jsfrag'));
  source=replaceBlock(source,'sudoku','2048',fragment('solo-sudoku-v419.jsfrag'));
  source=replaceBlock(source,'2048','memory',fragment('solo-2048-v419.jsfrag'));
  source=replaceBlock(source,'hanoi','slide',fragment('solo-hanoi-v419.jsfrag'));
  source=replaceBlock(source,'snake','pong',fragment('solo-snake-v419.jsfrag'));
  source=replaceBlock(source,'pong','breakout',fragment('solo-pong-v419.jsfrag'));
  source=replaceBlock(source,'flappy','dino',fragment('solo-flappy-v419.jsfrag'));
  source=replaceBlock(source,'stacktower','fruit',fragment('solo-stacktower-v419.jsfrag'));
  return source;
}

function build(publicDir){
  return transformSoloAppV419(fs.readFileSync(path.join(publicDir,'solo','app.js'),'utf8'));
}

export function serveSoloAppV419(publicDir){
  return (req,res,next)=>{
    try{
      if(!cached)cached=build(publicDir);
      res.type('application/javascript; charset=utf-8').send(cached);
    }catch(error){
      console.error(JSON.stringify({level:'error',event:'solo_v419_transform_failed',message:error.message}));
      next(error);
    }
  };
}
