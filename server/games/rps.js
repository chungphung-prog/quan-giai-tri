import { GameRuleError, clone } from './common.js';
const choices=new Set(['rock','paper','scissors']);
function winner(a,b){if(a===b)return null;if((a==='rock'&&b==='scissors')||(a==='paper'&&b==='rock')||(a==='scissors'&&b==='paper'))return 0;return 1;}
export const rps={
  key:'rps',name:'Oẳn tù tì',icon:'✊',
  create:()=>({picks:[null,null]}),
  apply(input,action,playerIndex){const state=clone(input);if(state.picks[playerIndex])throw new GameRuleError('Bạn đã chốt lựa chọn');if(!choices.has(action.choice))throw new GameRuleError('Lựa chọn không hợp lệ');state.picks[playerIndex]=action.choice;if(state.picks[0]&&state.picks[1])return {state,result:{winnerIndex:winner(state.picks[0],state.picks[1])}};return {state};},
  view(state,playerIndex){const done=Boolean(state.picks[0]&&state.picks[1]);return {picks:done?state.picks:state.picks.map((v,i)=>i===playerIndex?v:(v?'locked':null)),done};}
};
