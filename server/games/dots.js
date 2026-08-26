import { GameRuleError, asInt, assertTurn, clone } from './common.js';
const D=5;
function edgeKey(o,r,c){return `${o}:${r}:${c}`;}
function validEdge(o,r,c){return o==='h' ? r>=0&&r<D&&c>=0&&c<D-1 : o==='v' ? r>=0&&r<D-1&&c>=0&&c<D : false;}
function boxComplete(edges,r,c){return edges.includes(edgeKey('h',r,c))&&edges.includes(edgeKey('h',r+1,c))&&edges.includes(edgeKey('v',r,c))&&edges.includes(edgeKey('v',r,c+1));}
export const dots={
  key:'dots',name:'Dots & Boxes',icon:'🔳',
  create:()=>({dots:D,edges:[],boxes:{},turn:0}),
  apply(input,action,playerIndex){const state=clone(input);assertTurn(state,playerIndex);const o=action.orientation;const r=asInt(action.r,0,D-1,'hàng'),c=asInt(action.c,0,D-1,'cột');if(!validEdge(o,r,c))throw new GameRuleError('Cạnh không hợp lệ');const k=edgeKey(o,r,c);if(state.edges.includes(k))throw new GameRuleError('Cạnh đã được chọn');state.edges.push(k);let gained=0;for(let br=0;br<D-1;br++)for(let bc=0;bc<D-1;bc++){const bk=`${br}:${bc}`;if(state.boxes[bk]==null&&boxComplete(state.edges,br,bc)){state.boxes[bk]=playerIndex;gained++;}}
    if(state.edges.length===2*D*(D-1)){const scores=[0,0];Object.values(state.boxes).forEach(p=>scores[p]++);return {state,result:{winnerIndex:scores[0]===scores[1]?null:(scores[0]>scores[1]?0:1),score:scores}};}
    if(!gained)state.turn=1-playerIndex;return {state};},
  view:(state)=>state
};
