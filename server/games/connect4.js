import { GameRuleError, asInt, assertTurn, clone } from './common.js';
const R = 6, C = 7;
function won(board, r, c, player) {
  for (const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let n=1;
    for (const s of [-1,1]) {
      let rr=r+dr*s, cc=c+dc*s;
      while(rr>=0&&rr<R&&cc>=0&&cc<C&&board[rr*C+cc]===player){n++;rr+=dr*s;cc+=dc*s;}
    }
    if(n>=4)return true;
  }
  return false;
}
export const connect4 = {
  key: 'connect4', name: 'Connect 4', icon: '🔴',
  create: () => ({ board: Array(R*C).fill(null), turn: 0, moves: 0, rows: R, cols: C }),
  apply(input, action, playerIndex) {
    const state = clone(input); assertTurn(state, playerIndex);
    const col = asInt(action.col, 0, C-1, 'cột'); let row = -1;
    for (let r=R-1;r>=0;r--) if(state.board[r*C+col] == null){row=r;break;}
    if(row < 0) throw new GameRuleError('Cột đã đầy');
    state.board[row*C+col]=playerIndex; state.moves++;
    if(won(state.board,row,col,playerIndex)) return {state,result:{winnerIndex:playerIndex}};
    if(state.moves===R*C) return {state,result:{winnerIndex:null}};
    state.turn=1-playerIndex; return {state};
  },
  view: (state) => state
};
