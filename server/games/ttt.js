import { GameRuleError, asInt, assertTurn, clone } from './common.js';
const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export const ttt = {
  key: 'ttt', name: 'Cờ ca-rô 3×3', icon: '❎',
  create: () => ({ board: Array(9).fill(null), turn: 0, moves: 0 }),
  apply(input, action, playerIndex) {
    const state = clone(input); assertTurn(state, playerIndex);
    const index = asInt(action.index, 0, 8, 'ô');
    if (state.board[index] != null) throw new GameRuleError('Ô đã có quân');
    state.board[index] = playerIndex; state.moves++;
    if (wins.some((line) => line.every((i) => state.board[i] === playerIndex))) return { state, result: { winnerIndex: playerIndex } };
    if (state.moves === 9) return { state, result: { winnerIndex: null } };
    state.turn = 1 - playerIndex; return { state };
  },
  view: (state) => state
};
