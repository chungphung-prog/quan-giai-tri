import crypto from 'node:crypto';
import { pool } from '../db.js';
import { getGame } from '../games/index.js';
import { GameRuleError } from '../games/common.js';

export const AI_PLAYER_ID='00000000-0000-0000-0000-000000000000';
const MAX_AI_GAMES=new Set(['caro']);
const MEDIUM_AI_GAMES=new Set(['chess','xiangqi']);
const SEARCH_TIMEOUT=Symbol('SEARCH_TIMEOUT');

export async function ensureAiPlayer(){
  await pool.query(`INSERT IGNORE INTO users(id,google_sub,email,display_name,avatar_url,role,status,office_group_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[AI_PLAYER_ID,'ai-bot-internal','ai-bot@system.internal','AI Bot',null,'user','active',null]);
  // Caro stays MAX; chess/xiangqi are deliberately capped at medium strength to protect server CPU.
  await pool.query("UPDATE game_configs SET ai_difficulty='impossible' WHERE game_key='caro'");
  await pool.query("UPDATE game_configs SET ai_difficulty='hard' WHERE game_key IN ('chess','xiangqi')");
}
export function isAiPlayer(userId){return userId===AI_PLAYER_ID;}

async function getAiDifficulty(gameKey){
  if(MAX_AI_GAMES.has(gameKey))return 'impossible';
  if(MEDIUM_AI_GAMES.has(gameKey))return 'hard';
  const {rows}=await pool.query('SELECT ai_difficulty FROM game_configs WHERE game_key=$1',[gameKey]);
  return rows[0]?.ai_difficulty||'nightmare';
}

export function enumerateLegalMoves(game,state,playerIndex){
  const candidates=generateCandidates(game.key,state,playerIndex),legal=[];
  for(const action of candidates){
    try{game.apply(state,action,playerIndex);legal.push(action);}catch(e){if(e instanceof GameRuleError)continue;throw e;}
  }
  return legal;
}

function generateCandidates(key,state,playerIndex){
  switch(key){
    case 'ttt':
    case 'caro': return state.board.map((v,i)=>v==null?{index:i}:null).filter(Boolean);
    case 'connect4': return Array.from({length:7},(_,col)=>({col})).filter(a=>state.board[a.col]==null);
    case 'reversi': return state.board.map((v,i)=>v==null?{index:i}:null).filter(Boolean);
    case 'rps': return [{choice:'rock'},{choice:'paper'},{choice:'scissors'}];
    case 'dots':{
      const D=state.dots||5,out=[],edgeSet=new Set(state.edges||[]);
      for(let r=0;r<D;r++)for(let c=0;c<D-1;c++)if(!edgeSet.has(`h:${r}:${c}`))out.push({orientation:'h',r,c});
      for(let r=0;r<D-1;r++)for(let c=0;c<D;c++)if(!edgeSet.has(`v:${r}:${c}`))out.push({orientation:'v',r,c});
      return out;
    }
    case 'battleship':{
      const shots=state.shots[playerIndex];return shots.map((v,i)=>v===0?{index:i}:null).filter(Boolean);
    }
    case 'chess': return chessCandidates(state,playerIndex);
    case 'xiangqi': return xiangqiCandidates(state,playerIndex);
    default:return [];
  }
}

const CW=new Set(['♙','♖','♘','♗','♕','♔']),CB=new Set(['♟','♜','♞','♝','♛','♚']);
const chessSide=p=>CW.has(p)?0:CB.has(p)?1:null;
function chessCandidates(state,playerIndex){
  const own=playerIndex===0?CW:CB,out=[],board=state.board;
  for(let from=0;from<64;from++){
    const p=board[from];if(!own.has(p))continue;const r=Math.floor(from/8),c=from%8;
    const add=(rr,cc)=>{if(rr<0||rr>7||cc<0||cc>7)return false;const to=rr*8+cc,side=chessSide(board[to]);if(board[to]==null){out.push({from,to});return true;}if(side!==playerIndex)out.push({from,to});return false;};
    const slide=dirs=>{for(const[dr,dc]of dirs){let rr=r+dr,cc=c+dc;while(add(rr,cc)){rr+=dr;cc+=dc;}}};
    if(p==='♙'||p==='♟'){
      const d=p==='♙'?-1:1,start=p==='♙'?6:1,nr=r+d;if(nr>=0&&nr<8){if(board[nr*8+c]==null){out.push({from,to:nr*8+c});if(r===start&&board[(r+2*d)*8+c]==null)out.push({from,to:(r+2*d)*8+c});}for(const dc of[-1,1]){const cc=c+dc;if(cc>=0&&cc<8&&board[nr*8+cc]!=null&&chessSide(board[nr*8+cc])!==playerIndex)out.push({from,to:nr*8+cc});}}
    }else if(p==='♘'||p==='♞')for(const[dr,dc]of[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]])add(r+dr,c+dc);
    else if(p==='♗'||p==='♝')slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
    else if(p==='♖'||p==='♜')slide([[1,0],[-1,0],[0,1],[0,-1]]);
    else if(p==='♕'||p==='♛')slide([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);
    else if(p==='♔'||p==='♚')for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])add(r+dr,c+dc);
  }
  return out;
}

const XR=new Set(['帥','仕','相','俥','傌','炮','兵']),XB=new Set(['將','士','象','車','馬','砲','卒']);
const xSide=p=>XR.has(p)?0:XB.has(p)?1:null;
function xiangqiCandidates(state,playerIndex){
  const own=playerIndex===0?XR:XB,board=state.board,R=10,C=9,out=[];
  const inb=(r,c)=>r>=0&&r<R&&c>=0&&c<C;
  for(let from=0;from<R*C;from++){
    const p=board[from];if(!own.has(p))continue;const r=Math.floor(from/C),c=from%C;
    const add=(rr,cc)=>{if(!inb(rr,cc))return;const to=rr*C+cc;if(xSide(board[to])!==playerIndex)out.push({from,to});};
    if('車俥'.includes(p))for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){let rr=r+dr,cc=c+dc;while(inb(rr,cc)){const to=rr*C+cc;if(board[to]==null)out.push({from,to});else{if(xSide(board[to])!==playerIndex)out.push({from,to});break;}rr+=dr;cc+=dc;}}
    else if('砲炮'.includes(p))for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){let rr=r+dr,cc=c+dc,jump=false;while(inb(rr,cc)){const to=rr*C+cc;if(!jump){if(board[to]==null)out.push({from,to});else jump=true;}else if(board[to]!=null){if(xSide(board[to])!==playerIndex)out.push({from,to});break;}rr+=dr;cc+=dc;}}
    else if('馬傌'.includes(p))for(const[dr,dc,lr,lc]of[[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0],[1,2,0,1],[1,-2,0,-1],[-1,2,0,1],[-1,-2,0,-1]]){const legR=r+lr,legC=c+lc;if(!inb(legR,legC)||board[legR*C+legC]!=null)continue;add(r+dr,c+dc);}
    else if('象相'.includes(p))for(const[dr,dc]of[[2,2],[2,-2],[-2,2],[-2,-2]]){const rr=r+dr,cc=c+dc;if(!inb(rr,cc))continue;if(p==='象'&&rr>4)continue;if(p==='相'&&rr<5)continue;if(board[(r+dr/2)*C+(c+dc/2)]==null)add(rr,cc);}
    else if('士仕'.includes(p))for(const[dr,dc]of[[1,1],[1,-1],[-1,1],[-1,-1]]){const rr=r+dr,cc=c+dc,palace=playerIndex===1?rr<=2:rr>=7;if(palace&&cc>=3&&cc<=5)add(rr,cc);}
    else if('將帥'.includes(p))for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){const rr=r+dr,cc=c+dc,palace=playerIndex===1?rr<=2:rr>=7;if(palace&&cc>=3&&cc<=5)add(rr,cc);}
    else if(p==='卒'){add(r+1,c);if(r>=5){add(r,c-1);add(r,c+1);}}
    else if(p==='兵'){add(r-1,c);if(r<=4){add(r,c-1);add(r,c+1);}}
  }
  return out;
}

function randomChoice(arr){return arr[crypto.randomInt(arr.length)];}
function checkDeadline(deadline){if(Date.now()>deadline)throw SEARCH_TIMEOUT;}

// ----- Caro MAX ---------------------------------------------------------------
const CN=15,CDIRS=[[1,0],[0,1],[1,1],[1,-1]],MATE=10_000_000;
function caroWinAt(board,index,player){
  const r=Math.floor(index/CN),c=index%CN;
  for(const[dr,dc]of CDIRS){let n=1;for(const s of[-1,1]){let rr=r+dr*s,cc=c+dc*s;while(rr>=0&&rr<CN&&cc>=0&&cc<CN&&board[rr*CN+cc]===player){n++;rr+=dr*s;cc+=dc*s;}}if(n>=5)return true;}return false;
}
function caroRelevant(board,radius=2){
  const set=new Set();let occupied=0;
  for(let i=0;i<board.length;i++)if(board[i]!=null){occupied++;const r=Math.floor(i/CN),c=i%CN;for(let dr=-radius;dr<=radius;dr++)for(let dc=-radius;dc<=radius;dc++){const rr=r+dr,cc=c+dc;if(rr>=0&&rr<CN&&cc>=0&&cc<CN){const x=rr*CN+cc;if(board[x]==null)set.add(x);}}}
  if(!occupied)return [112];return [...set];
}
function caroLineFeatures(board,index,player,dr,dc){
  const r=Math.floor(index/CN),c=index%CN;let left=0,right=0,open=0;
  let rr=r-dr,cc=c-dc;while(rr>=0&&rr<CN&&cc>=0&&cc<CN&&board[rr*CN+cc]===player){left++;rr-=dr;cc-=dc;}if(rr>=0&&rr<CN&&cc>=0&&cc<CN&&board[rr*CN+cc]==null)open++;
  rr=r+dr;cc=c+dc;while(rr>=0&&rr<CN&&cc>=0&&cc<CN&&board[rr*CN+cc]===player){right++;rr+=dr;cc+=dc;}if(rr>=0&&rr<CN&&cc>=0&&cc<CN&&board[rr*CN+cc]==null)open++;
  return {len:left+1+right,open};
}
function caroThreatScore(board,index,player){
  if(board[index]!=null)return -Infinity;board[index]=player;let score=0,open3=0,open4=0;
  for(const[dr,dc]of CDIRS){const f=caroLineFeatures(board,index,player,dr,dc);if(f.len>=5){board[index]=null;return MATE;}if(f.len===4&&f.open===2){score+=500000;open4++;}else if(f.len===4&&f.open===1)score+=90000;else if(f.len===3&&f.open===2){score+=30000;open3++;}else if(f.len===3&&f.open===1)score+=5000;else if(f.len===2&&f.open===2)score+=900;else if(f.len===2&&f.open===1)score+=180;else if(f.len===1&&f.open===2)score+=20;}
  if(open4>=1&&open3>=1)score+=250000;if(open3>=2)score+=120000;
  const r=Math.floor(index/CN),c=index%CN;score+=Math.max(0,14-(Math.abs(r-7)+Math.abs(c-7)))*2;board[index]=null;return score;
}
function caroOrderedMoves(board,player,limit){
  const opp=1-player,moves=caroRelevant(board,2).map(index=>({index,score:caroThreatScore(board,index,player)+1.12*caroThreatScore(board,index,opp)}));
  moves.sort((a,b)=>b.score-a.score);return moves.slice(0,limit).map(x=>x.index);
}
function caroLeaf(board,ai){
  const a=caroOrderedMoves(board,ai,4).map(i=>caroThreatScore(board,i,ai)),o=caroOrderedMoves(board,1-ai,4).map(i=>caroThreatScore(board,i,1-ai));
  return (a[0]||0)+.35*(a[1]||0)-1.08*(o[0]||0)-.42*(o[1]||0);
}
function caroSearch(board,current,ai,depth,alpha,beta,deadline,ply=0){
  checkDeadline(deadline);if(depth<=0)return caroLeaf(board,ai);
  const maximizing=current===ai,limit=depth>=4?8:depth===3?10:12,moves=caroOrderedMoves(board,current,limit);if(!moves.length)return 0;
  let best=maximizing?-Infinity:Infinity;
  for(const index of moves){checkDeadline(deadline);board[index]=current;if(caroWinAt(board,index,current)){const v=current===ai?MATE-ply:-MATE+ply;board[index]=null;return v;}const v=caroSearch(board,1-current,ai,depth-1,alpha,beta,deadline,ply+1);board[index]=null;
    if(maximizing){if(v>best)best=v;if(best>alpha)alpha=best;}else{if(v<best)best=v;if(best<beta)beta=best;}if(alpha>=beta)break;
  }
  return best;
}
function maxCaroMove(state,ai,legalMoves){
  const board=[...state.board],opp=1-ai,deadline=Date.now()+650;
  let candidates=caroOrderedMoves(board,ai,18);if(!candidates.length)candidates=legalMoves.map(x=>x.index);
  // Forced win first.
  for(const i of candidates){board[i]=ai;const win=caroWinAt(board,i,ai);board[i]=null;if(win)return {index:i};}
  // Forced block second.
  const oppWins=[];for(const i of caroRelevant(board,2)){if(board[i]!=null)continue;board[i]=opp;const win=caroWinAt(board,i,opp);board[i]=null;if(win)oppWins.push(i);}if(oppWins.length===1)return {index:oppWins[0]};
  let best={index:candidates[0]},bestScore=-Infinity;
  for(const depth of [2,3,4,5]){
    try{let localBest=best,localScore=-Infinity;for(const i of candidates){checkDeadline(deadline);board[i]=ai;let v;if(caroWinAt(board,i,ai))v=MATE;else v=caroSearch(board,opp,ai,depth-1,-Infinity,Infinity,deadline,1);board[i]=null;if(v>localScore){localScore=v;localBest={index:i};}}best=localBest;bestScore=localScore;if(Math.abs(bestScore)>MATE/2)break;}catch(e){if(e!==SEARCH_TIMEOUT)throw e;break;}
  }
  return best;
}

// ----- Chess / Xiangqi MAX -----------------------------------------------------
const CHESS_VALUES={'♙':100,'♖':500,'♘':320,'♗':335,'♕':925,'♔':30000,'♟':100,'♜':500,'♞':320,'♝':335,'♛':925,'♚':30000};
const XQ_VALUES={'帥':30000,'仕':220,'相':220,'俥':950,'傌':470,'炮':500,'兵':110,'將':30000,'士':220,'象':220,'車':950,'馬':470,'砲':500,'卒':110};
function pieceValue(kind,p){return (kind==='chess'?CHESS_VALUES:XQ_VALUES)[p]||0;}
function boardSide(kind,p){return kind==='chess'?chessSide(p):xSide(p);}
function materialEval(state,ai,kind){
  let score=0,pieces=0;const board=state.board;
  for(let i=0;i<board.length;i++){const p=board[i];if(!p)continue;pieces++;const s=boardSide(kind,p),v=pieceValue(kind,p);let pos=0;
    if(kind==='chess'){
      const r=Math.floor(i/8),c=i%8,center=7-(Math.abs(r-3.5)+Math.abs(c-3.5));
      if('♘♞♗♝'.includes(p))pos+=center*5;if('♙'.includes(p))pos+=(6-r)*6;if('♟'.includes(p))pos+=(r-1)*6;if('♕♛'.includes(p))pos+=center*1.5;
    }else{
      const r=Math.floor(i/9),c=i%9,center=8-(Math.abs(c-4)+Math.abs(r-4.5)*.35);
      if('馬傌砲炮'.includes(p))pos+=center*5;if(p==='兵')pos+=(9-r)*5+(r<=4?35:0);if(p==='卒')pos+=r*5+(r>=5?35:0);if('車俥'.includes(p))pos+=center*2;
    }
    score+=(s===ai?1:-1)*(v+pos);
  }
  return {score,pieces};
}
function moveOrderScore(state,m,kind){
  const target=state.board[m.to],actor=state.board[m.from];let s=target?pieceValue(kind,target)*16-pieceValue(kind,actor):0;
  if(kind==='chess'){const r=Math.floor(m.to/8),c=m.to%8;s+=20-(Math.abs(r-3.5)+Math.abs(c-3.5))*3;if(actor==='♙'&&r===0||actor==='♟'&&r===7)s+=800;}
  else {const r=Math.floor(m.to/9),c=m.to%9;s+=14-(Math.abs(c-4)+Math.abs(r-4.5)*.3)*2;}
  return s;
}
function orderedMoves(game,state,side,kind,limit=Infinity){const moves=enumerateLegalMoves(game,state,side);moves.sort((a,b)=>moveOrderScore(state,b,kind)-moveOrderScore(state,a,kind));return moves.slice(0,limit);}
function staticEval(game,state,ai,kind){
  const base=materialEval(state,ai,kind);let score=base.score;
  // Cheap pseudo-mobility keeps evaluation fast enough to reach deeper plies.
  try{const turn=state.turn,own=generateCandidates(kind,state,ai).length,opp=generateCandidates(kind,state,1-ai).length;score+=(own-opp)*(kind==='chess'?2.4:1.8);if(state.inCheck)score+=(turn===ai?-65:65);}catch{}
  return score;
}
function terminalScore(result,ai,depth){if(!result)return null;if(result.winnerIndex==null)return 0;return result.winnerIndex===ai?1_000_000+depth:-1_000_000-depth;}
function alphaBeta(game,state,ai,kind,depth,alpha,beta,deadline,ply=0){
  checkDeadline(deadline);if(depth<=0)return staticEval(game,state,ai,kind);const side=state.turn;if(side!==0&&side!==1)return staticEval(game,state,ai,kind);
  const maximizing=side===ai,branchLimit=depth>=4?(kind==='chess'?18:20):depth===3?(kind==='chess'?24:28):40,moves=orderedMoves(game,state,side,kind,branchLimit);if(!moves.length)return staticEval(game,state,ai,kind);
  let best=maximizing?-Infinity:Infinity;
  for(const move of moves){checkDeadline(deadline);let applied;try{applied=game.apply(state,move,side);}catch{continue;}const t=terminalScore(applied.result,ai,depth);const v=t==null?alphaBeta(game,applied.state,ai,kind,depth-1,alpha,beta,deadline,ply+1):t;
    if(maximizing){if(v>best)best=v;if(best>alpha)alpha=best;}else{if(v<best)best=v;if(best<beta)beta=best;}if(alpha>=beta)break;
  }
  return best;
}
// Medium board AI: one-ply positional evaluation + cheap opponent threat scan.
// It deliberately avoids deep alpha-beta search so multiple concurrent AI games do not block Node's event loop.
function mediumReplyThreat(state,ai,kind){
  const opp=1-ai,candidates=generateCandidates(kind,state,opp);let biggest=0;
  for(const m of candidates){const target=state.board[m.to];if(target&&boardSide(kind,target)===ai){const victim=pieceValue(kind,target),attacker=pieceValue(kind,state.board[m.from]);biggest=Math.max(biggest,victim-Math.min(victim*.35,attacker*.08));}}
  return Math.max(0,biggest);
}
function mediumBoardMove(game,state,ai,legalMoves,kind){
  // Hard ceiling is intentionally tiny compared with the former 900/1050ms MAX search.
  const budget=kind==='chess'?90:110,deadline=Date.now()+budget,rootLimit=kind==='chess'?18:20;
  const root=[...legalMoves].sort((a,b)=>moveOrderScore(state,b,kind)-moveOrderScore(state,a,kind)).slice(0,rootLimit);
  let best=root[0]||legalMoves[0],bestScore=-Infinity;
  for(const m of root){
    if(Date.now()>deadline)break;
    let applied;try{applied=game.apply(state,m,ai);}catch{continue;}
    if(applied.result?.winnerIndex===ai)return m;
    if(applied.result?.winnerIndex===1-ai)continue;
    const target=state.board[m.to],captureBonus=target?pieceValue(kind,target)*.12:0;
    const checkBonus=applied.state.inCheck&&applied.state.turn===1-ai?(kind==='chess'?85:95):0;
    const threatPenalty=mediumReplyThreat(applied.state,ai,kind)*(kind==='chess'?.72:.68);
    const score=staticEval(game,applied.state,ai,kind)+captureBonus+checkBonus+moveOrderScore(state,m,kind)*.08-threatPenalty;
    if(score>bestScore){bestScore=score;best=m;}
  }
  return best;
}

function maxBoardMove(game,state,ai,legalMoves,kind){
  const info=materialEval(state,ai,kind),budget=kind==='chess'?900:1050,deadline=Date.now()+budget;
  let root=[...legalMoves].sort((a,b)=>moveOrderScore(state,b,kind)-moveOrderScore(state,a,kind)),best=root[0],bestScore=-Infinity;
  // Always take a forced mate/capture immediately if available.
  for(const m of root){try{const a=game.apply(state,m,ai);if(a.result?.winnerIndex===ai)return m;}catch{}}
  const maxDepth=info.pieces<=12?5:4;
  for(let depth=1;depth<=maxDepth;depth++){
    try{let localBest=best,localScore=-Infinity;for(const m of root){checkDeadline(deadline);let a;try{a=game.apply(state,m,ai);}catch{continue;}const t=terminalScore(a.result,ai,depth);const v=t==null?alphaBeta(game,a.state,ai,kind,depth-1,-Infinity,Infinity,deadline,1):t;if(v>localScore){localScore=v;localBest=m;}}best=localBest;bestScore=localScore;
      // Principal variation first on the next iteration for better pruning.
      root=[best,...root.filter(m=>m!==best)];if(bestScore>900000)break;
    }catch(e){if(e!==SEARCH_TIMEOUT)throw e;break;}
  }
  return best;
}

// ----- Other games (kept deterministic/strong enough) -------------------------
function tttBest(game,state,ai,legalMoves){
  function mm(s,side){const moves=enumerateLegalMoves(game,s,side);if(!moves.length)return 0;let best=side===ai?-Infinity:Infinity;for(const m of moves){const a=game.apply(s,m,side);let v;if(a.result)v=a.result.winnerIndex==null?0:a.result.winnerIndex===ai?100:-100;else v=mm(a.state,a.state.turn);best=side===ai?Math.max(best,v):Math.min(best,v);}return best;}
  let best=legalMoves[0],score=-Infinity;for(const m of legalMoves){const a=game.apply(state,m,ai),v=a.result?(a.result.winnerIndex===ai?100:0):mm(a.state,a.state.turn);if(v>score){score=v;best=m;}}return best;
}
function connect4Best(game,state,ai,legalMoves){
  const deadline=Date.now()+220;let best=legalMoves[0],bestScore=-Infinity;
  const evalState=s=>{let sc=0;for(let i=0;i<s.board.length;i++){if(s.board[i]===ai)sc+=(i%7===3?7:2);else if(s.board[i]===1-ai)sc-=(i%7===3?7:2);}return sc;};
  function ab(s,side,d,a,b){checkDeadline(deadline);if(d<=0)return evalState(s);const moves=enumerateLegalMoves(game,s,side).sort((x,y)=>Math.abs(x.col-3)-Math.abs(y.col-3));let val=side===ai?-Infinity:Infinity;for(const m of moves){const x=game.apply(s,m,side);const v=x.result?(x.result.winnerIndex==null?0:x.result.winnerIndex===ai?100000:-100000):ab(x.state,x.state.turn,d-1,a,b);if(side===ai){val=Math.max(val,v);a=Math.max(a,val);}else{val=Math.min(val,v);b=Math.min(b,val);}if(a>=b)break;}return val;}
  try{for(const m of legalMoves){const x=game.apply(state,m,ai),v=x.result?100000:ab(x.state,x.state.turn,4,-Infinity,Infinity);if(v>bestScore){bestScore=v;best=m;}}}catch(e){if(e!==SEARCH_TIMEOUT)throw e;}return best;
}
function reversiBest(game,state,ai,legalMoves){const weights=[120,-20,20,5,5,20,-20,120,-20,-40,-5,-5,-5,-5,-40,-20,20,-5,15,3,3,15,-5,20,5,-5,3,3,3,3,-5,5,5,-5,3,3,3,3,-5,5,20,-5,15,3,3,15,-5,20,-20,-40,-5,-5,-5,-5,-40,-20,120,-20,20,5,5,20,-20,120];let best=legalMoves[0],score=-Infinity;for(const m of legalMoves){const a=game.apply(state,m,ai);let s=0;a.state.board.forEach((v,i)=>{if(v===ai)s+=weights[i];else if(v===1-ai)s-=weights[i];});if(s>score){score=s;best=m;}}return best;}

function selectBestMove(game,state,ai,legalMoves){
  switch(game.key){
    case 'caro':return maxCaroMove(state,ai,legalMoves);
    case 'chess':return mediumBoardMove(game,state,ai,legalMoves,'chess');
    case 'xiangqi':return mediumBoardMove(game,state,ai,legalMoves,'xiangqi');
    case 'ttt':return tttBest(game,state,ai,legalMoves);
    case 'connect4':return connect4Best(game,state,ai,legalMoves);
    case 'reversi':return reversiBest(game,state,ai,legalMoves);
    default:return randomChoice(legalMoves);
  }
}

export async function computeAiMove(state,gameKey,aiPlayerIndex){
  const game=getGame(gameKey),difficulty=await getAiDifficulty(gameKey),legalMoves=enumerateLegalMoves(game,state,aiPlayerIndex);
  if(!legalMoves.length)return {state,result:null,action:null};
  let selectedAction;
  if(MEDIUM_AI_GAMES.has(gameKey))selectedAction=selectBestMove(game,state,aiPlayerIndex,legalMoves);
  else if(MAX_AI_GAMES.has(gameKey)||difficulty==='impossible')selectedAction=selectBestMove(game,state,aiPlayerIndex,legalMoves);
  else if(difficulty==='nightmare')selectedAction=Math.random()<.9?selectBestMove(game,state,aiPlayerIndex,legalMoves):randomChoice(legalMoves);
  else selectedAction=Math.random()<.7?selectBestMove(game,state,aiPlayerIndex,legalMoves):randomChoice(legalMoves);
  const applied=game.apply(state,selectedAction,aiPlayerIndex);return {state:applied.state,result:applied.result||null,action:selectedAction};
}
