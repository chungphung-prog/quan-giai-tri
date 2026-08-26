import { GameRuleError, asInt, assertTurn, clone } from './common.js';
const R=10,C=9;
const red=new Set(['帥','仕','相','俥','傌','炮','兵']), black=new Set(['將','士','象','車','馬','砲','卒']);
const side=(p)=>red.has(p)?0:black.has(p)?1:null;
function start(){const b=Array(R*C).fill(null);const top=['車','馬','象','士','將','士','象','馬','車'],bot=['俥','傌','相','仕','帥','仕','相','傌','俥'];top.forEach((p,c)=>b[c]=p);bot.forEach((p,c)=>b[9*C+c]=p);b[2*C+1]=b[2*C+7]='砲';b[7*C+1]=b[7*C+7]='炮';for(const c of[0,2,4,6,8]){b[3*C+c]='卒';b[6*C+c]='兵';}return b;}
const rc=i=>[Math.floor(i/C),i%C];
function pathClear(board,r,c,rr,cc){const dr=Math.sign(rr-r),dc=Math.sign(cc-c);let a=r+dr,b=c+dc;while(a!==rr||b!==cc){if(board[a*C+b]!=null)return false;a+=dr;b+=dc;}return true;}
function between(board,r,c,rr,cc){const dr=Math.sign(rr-r),dc=Math.sign(cc-c);let n=0,a=r+dr,b=c+dc;while(a!==rr||b!==cc){if(board[a*C+b]!=null)n++;a+=dr;b+=dc;}return n;}
function legalMove(board,from,to){const p=board[from],s=side(p);if(s==null||side(board[to])===s)return false;const[r,c]=rc(from),[rr,cc]=rc(to),dr=rr-r,dc2=cc-c,adr=Math.abs(dr),adc=Math.abs(dc2);
  if('車俥'.includes(p))return (dr===0||dc2===0)&&pathClear(board,r,c,rr,cc);
  if('砲炮'.includes(p)){if(!(dr===0||dc2===0))return false;const n=between(board,r,c,rr,cc);return board[to]==null?n===0:n===1;}
  if('馬傌'.includes(p)){if(!((adr===2&&adc===1)||(adr===1&&adc===2)))return false;const lr=r+(adr===2?Math.sign(dr):0),lc=c+(adc===2?Math.sign(dc2):0);return board[lr*C+lc]==null;}
  if('象相'.includes(p)){if(adr!==2||adc!==2)return false;if(p==='象'&&rr>4)return false;if(p==='相'&&rr<5)return false;return board[(r+dr/2)*C+(c+dc2/2)]==null;}
  if('士仕'.includes(p)){const palace=s===1?rr<=2:rr>=7;return palace&&cc>=3&&cc<=5&&adr===1&&adc===1;}
  if('將帥'.includes(p)){const palace=s===1?rr<=2:rr>=7;return palace&&cc>=3&&cc<=5&&adr+adc===1;}
  if(p==='卒')return (r<5?(dr===1&&dc2===0):(dr===1&&dc2===0||dr===0&&adc===1));
  if(p==='兵')return (r>4?(dr===-1&&dc2===0):(dr===-1&&dc2===0||dr===0&&adc===1));
  return false;
}
function findGeneral(board,s){const g=s===0?'帥':'將';return board.indexOf(g);}
function isInCheck(board,s){
  const gPos=findGeneral(board,s);if(gPos<0)return false;
  const enemy=1-s;
  for(let i=0;i<R*C;i++){if(side(board[i])!==enemy)continue;if(legalMove(board,i,gPos))return true;}
  // Flying general check (generals facing each other on same column with nothing between)
  const ePos=findGeneral(board,enemy);if(ePos<0)return false;
  const[gr,gc]=rc(gPos),[er,ec]=rc(ePos);
  if(gc===ec){let clear=true;const minR=Math.min(gr,er),maxR=Math.max(gr,er);for(let r2=minR+1;r2<maxR;r2++){if(board[r2*C+gc]!=null){clear=false;break;}}if(clear)return true;}
  return false;
}
function hasLegalMoves(board,s){
  for(let from=0;from<R*C;from++){
    if(side(board[from])!==s)continue;
    for(let to=0;to<R*C;to++){
      if(from===to)continue;
      if(!legalMove(board,from,to))continue;
      const testBoard=[...board];testBoard[to]=testBoard[from];testBoard[from]=null;
      if(!isInCheck(testBoard,s))return true;
    }
  }
  return false;
}
export const xiangqi={key:'xiangqi',name:'Cờ tướng mini',icon:'🀄',
  create:()=>({board:start(),turn:0,rows:R,cols:C,inCheck:false}),
  apply(input,action,playerIndex){
    const state=clone(input);assertTurn(state,playerIndex);
    const from=asInt(action.from,0,R*C-1,'ô đi'),to=asInt(action.to,0,R*C-1,'ô đến');
    if(side(state.board[from])!==playerIndex)throw new GameRuleError('Không phải quân của bạn');
    if(!legalMove(state.board,from,to))throw new GameRuleError('Nước đi không hợp lệ');
    // Simulate
    const testBoard=[...state.board];testBoard[to]=testBoard[from];testBoard[from]=null;
    // Cannot leave own general in check
    if(isInCheck(testBoard,playerIndex))throw new GameRuleError('Nước đi để tướng bị chiếu','GENERAL_IN_CHECK');
    // Apply
    state.board=testBoard;
    const enemy=1-playerIndex;
    state.inCheck=isInCheck(state.board,enemy);
    // Checkmate or stalemate
    if(!hasLegalMoves(state.board,enemy)){
      if(state.inCheck){
        return {state,result:{winnerIndex:playerIndex}};
      }else{
        return {state,result:{winnerIndex:null}}; // stalemate = draw
      }
    }
    state.turn=enemy;
    return {state};
  },
  view:(state)=>state
};
