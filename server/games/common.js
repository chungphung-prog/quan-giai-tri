export class GameRuleError extends Error {
  constructor(message, code = 'INVALID_MOVE') {
    super(message);
    this.name = 'GameRuleError';
    this.code = code;
  }
}

export const asInt = (value, min, max, label = 'value') => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new GameRuleError(`${label} không hợp lệ`);
  }
  return value;
};

export const assertTurn = (state, playerIndex) => {
  if (state.turn !== playerIndex) throw new GameRuleError('Chưa tới lượt của bạn', 'NOT_YOUR_TURN');
};

export const clone = (value) => structuredClone(value);
