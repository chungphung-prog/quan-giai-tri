import { GameRuleError, asInt, assertTurn, clone } from './common.js';
const N = 15;
function win(board, index, player) {
  const r = Math.floor(index / N), c = index % N;
  for (const [dr, dc] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let count = 1;
    for (const sign of [-1,1]) {
      let rr = r + dr*sign, cc = c + dc*sign;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr*N+cc] === player) {
        count++; rr += dr*sign; cc += dc*sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}
export const caro = {
  key: 'caro', name: 'Cờ caro 15×15', icon: '⭕',
  create: () => ({ board: Array(N*N).fill(null), turn: 0, moves: 0, size: N }),
  apply(input, action, playerIndex) {
    const state = clone(input); assertTurn(state, playerIndex);
    const index = asInt(action.index, 0, N*N-1, 'ô');
    if (state.board[index] != null) throw new GameRuleError('Ô đã có quân');
    state.board[index] = playerIndex; state.moves++;
    if (win(state.board, index, playerIndex)) return { state, result: { winnerIndex: playerIndex } };
    if (state.moves === N*N) return { state, result: { winnerIndex: null } };
    state.turn = 1 - playerIndex; return { state };
  },
  view: (state) => state
};
