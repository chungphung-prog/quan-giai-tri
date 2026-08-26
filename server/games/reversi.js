import { GameRuleError, asInt, assertTurn, clone } from './common.js';
const N=8; const DIRS=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
function flips(board,index,player){
  if(board[index]!=null)return [];
  const r=Math.floor(index/N),c=index%N,out=[];
  for(const [dr,dc] of DIRS){let rr=r+dr,cc=c+dc,line=[];while(rr>=0&&rr<N&&cc>=0&&cc<N&&board[rr*N+cc]===1-player){line.push(rr*N+cc);rr+=dr;cc+=dc;}if(line.length&&rr>=0&&rr<N&&cc>=0&&cc<N&&board[rr*N+cc]===player)out.push(...line);}
  return out;
}
function hasMove(board,p){return board.some((_,i)=>flips(board,i,p).length>0)}
function result(board){const a=board.filter(x=>x===0).length,b=board.filter(x=>x===1).length;return {winnerIndex:a===b?null:(a>b?0:1),score:[a,b]};}
export const reversi={
  key:'reversi',name:'Reversi',icon:'⚫',
  create:()=>{const board=Array(N*N).fill(null);board[27]=board[36]=1;board[28]=board[35]=0;return {board,turn:0,size:N};},
  apply(input,action,playerIndex){const state=clone(input);assertTurn(state,playerIndex);const index=asInt(action.index,0,N*N-1,'ô');const f=flips(state.board,index,playerIndex);if(!f.length)throw new GameRuleError('Nước đi không hợp lệ');state.board[index]=playerIndex;f.forEach(i=>state.board[i]=playerIndex);const other=1-playerIndex;if(hasMove(state.board,other)){state.turn=other;return {state};}if(hasMove(state.board,playerIndex)){state.turn=playerIndex;return {state};}return {state,result:result(state.board)};},
  view:(state)=>state
};
