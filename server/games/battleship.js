import crypto from 'node:crypto';
import { GameRuleError, asInt, assertTurn, clone } from './common.js';
const N=8, SHIPS=[4,3,3,2,2], TOTAL=14;
function placeFleet(){
  const board=Array(N*N).fill(0);
  for(const len of SHIPS){
    let placed=false;
    for(let tries=0;tries<500&&!placed;tries++){
      const horizontal=crypto.randomInt(2)===0,r=crypto.randomInt(N),c=crypto.randomInt(N),cells=[];
      for(let i=0;i<len;i++){const rr=r+(horizontal?0:i),cc=c+(horizontal?i:0);if(rr>=N||cc>=N){cells.length=0;break;}cells.push(rr*N+cc);}
      if(cells.length===len&&cells.every(i=>board[i]===0)){cells.forEach(i=>board[i]=1);placed=true;}
    }
    if(!placed) throw new Error('Could not place battleship fleet');
  }
  return board;
}
export const battleship={
  key:'battleship',name:'Battleship',icon:'🚢',
  create:()=>({size:N,turn:0,boards:[placeFleet(),placeFleet()],shots:[Array(N*N).fill(0),Array(N*N).fill(0)],hits:[0,0]}),
  apply(input,action,playerIndex){const state=clone(input);assertTurn(state,playerIndex);const index=asInt(action.index,0,N*N-1,'ô');const target=1-playerIndex;if(state.shots[playerIndex][index]!==0)throw new GameRuleError('Bạn đã bắn ô này');const hit=state.boards[target][index]===1;state.shots[playerIndex][index]=hit?2:1;if(hit)state.hits[playerIndex]++;if(state.hits[playerIndex]>=TOTAL)return {state,result:{winnerIndex:playerIndex}};state.turn=target;return {state};},
  view(state,playerIndex){return {size:N,turn:state.turn,myBoard:state.boards[playerIndex],incomingShots:state.shots[1-playerIndex],myShots:state.shots[playerIndex],hits:state.hits};}
};
