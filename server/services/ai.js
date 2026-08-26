import crypto from 'node:crypto';
import { pool } from '../db.js';
import { getGame } from '../games/index.js';
import { GameRuleError } from '../games/common.js';

/**
 * Well-known UUID for the AI player.
 * This constant is used across the system to identify AI-controlled matches.
 */
export const AI_PLAYER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Ensures the AI player user record exists in the database.
 * Uses INSERT IGNORE so it's idempotent — safe to call on every startup.
 */
export async function ensureAiPlayer() {
  await pool.query(
    `INSERT IGNORE INTO users (id, google_sub, email, display_name, avatar_url, role, status, office_group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      AI_PLAYER_ID,
      'ai-bot-internal',
      'ai-bot@system.internal',
      'AI Bot',
      null,
      'user',
      'active',
      null
    ]
  );
}

/**
 * Returns true if the given userId is the AI player.
 */
export function isAiPlayer(userId) {
  return userId === AI_PLAYER_ID;
}

// ─── AI Difficulty Loading ──────────────────────────────────────────────────────

/**
 * Query ai_difficulty from game_configs for a given gameKey.
 * Falls back to 'nightmare' if not found.
 */
async function getAiDifficulty(gameKey) {
  const { rows } = await pool.query(
    'SELECT ai_difficulty FROM game_configs WHERE game_key = $1',
    [gameKey]
  );
  return rows[0]?.ai_difficulty || 'nightmare';
}

// ─── Move Enumeration ───────────────────────────────────────────────────────────

/**
 * Enumerate all legal moves for a given player in the current state.
 * Strategy: generate all candidate actions and filter via game.apply().
 */
export function enumerateLegalMoves(game, state, playerIndex) {
  const key = game.key;

  // Generate candidate moves based on game type
  const candidates = generateCandidates(key, state, playerIndex);

  // Filter to only legal moves by trying apply()
  const legal = [];
  for (const action of candidates) {
    try {
      game.apply(state, action, playerIndex);
      legal.push(action);
    } catch (e) {
      if (e instanceof GameRuleError) continue;
      throw e; // re-throw unexpected errors
    }
  }
  return legal;
}

/**
 * Generate candidate action objects for each game type.
 */
function generateCandidates(key, state, playerIndex) {
  switch (key) {
    case 'ttt':
      // index 0-8, only empty cells
      return state.board
        .map((v, i) => (v == null ? { index: i } : null))
        .filter(Boolean);

    case 'caro':
      // index 0-224, only empty cells
      return state.board
        .map((v, i) => (v == null ? { index: i } : null))
        .filter(Boolean);

    case 'connect4':
      // col 0-6, only non-full columns
      return Array.from({ length: 7 }, (_, col) => ({ col }))
        .filter(a => state.board[a.col] == null); // top row of column is empty

    case 'reversi':
      // index 0-63, only empty cells (apply will validate flips)
      return state.board
        .map((v, i) => (v == null ? { index: i } : null))
        .filter(Boolean);

    case 'rps':
      // All three choices
      return [{ choice: 'rock' }, { choice: 'paper' }, { choice: 'scissors' }];

    case 'dots': {
      // All valid edges that haven't been drawn
      const D = state.dots || 5;
      const candidates = [];
      // Horizontal edges
      for (let r = 0; r < D; r++) {
        for (let c = 0; c < D - 1; c++) {
          candidates.push({ orientation: 'h', r, c });
        }
      }
      // Vertical edges
      for (let r = 0; r < D - 1; r++) {
        for (let c = 0; c < D; c++) {
          candidates.push({ orientation: 'v', r, c });
        }
      }
      // Filter out already-drawn edges
      const edgeSet = new Set(state.edges || []);
      return candidates.filter(a => !edgeSet.has(`${a.orientation}:${a.r}:${a.c}`));
    }

    case 'battleship': {
      // index 0-63, only cells not yet shot
      const shots = state.shots[playerIndex];
      return shots
        .map((v, i) => (v === 0 ? { index: i } : null))
        .filter(Boolean);
    }

    case 'chess': {
      // Generate moves using piece movement rules (no brute force)
      const WHITE = new Set(['♙', '♖', '♘', '♗', '♕', '♔']);
      const BLACK = new Set(['♟', '♜', '♞', '♝', '♛', '♚']);
      const ownSet = playerIndex === 0 ? WHITE : BLACK;
      const colorOf = p => WHITE.has(p) ? 0 : BLACK.has(p) ? 1 : null;
      const candidates = [];
      for (let from = 0; from < 64; from++) {
        const p = state.board[from];
        if (!ownSet.has(p)) continue;
        const r = Math.floor(from / 8), c = from % 8;
        const add = (rr, cc) => { if (rr >= 0 && rr <= 7 && cc >= 0 && cc <= 7) { const to = rr * 8 + cc; if (colorOf(state.board[to]) !== playerIndex) candidates.push({ from, to }); } };
        const slide = (dirs) => { for (const [dr, dc] of dirs) { let rr = r + dr, cc2 = c + dc; while (rr >= 0 && rr <= 7 && cc2 >= 0 && cc2 <= 7) { const to = rr * 8 + cc2; if (state.board[to] == null) { candidates.push({ from, to }); } else { if (colorOf(state.board[to]) !== playerIndex) candidates.push({ from, to }); break; } rr += dr; cc2 += dc; } } };
        if (p === '♙' || p === '♟') { const d = p === '♙' ? -1 : 1, start = p === '♙' ? 6 : 1; const nr = r + d; if (nr >= 0 && nr < 8) { if (state.board[nr * 8 + c] == null) { candidates.push({ from, to: nr * 8 + c }); if (r === start && state.board[(r + 2 * d) * 8 + c] == null) candidates.push({ from, to: (r + 2 * d) * 8 + c }); } for (const dc of [-1, 1]) { const cc2 = c + dc; if (cc2 >= 0 && cc2 < 8 && state.board[nr * 8 + cc2] != null && colorOf(state.board[nr * 8 + cc2]) !== playerIndex) candidates.push({ from, to: nr * 8 + cc2 }); } } }
        else if (p === '♘' || p === '♞') for (const [dr, dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) add(r + dr, c + dc);
        else if (p === '♗' || p === '♝') slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
        else if (p === '♖' || p === '♜') slide([[1,0],[-1,0],[0,1],[0,-1]]);
        else if (p === '♕' || p === '♛') slide([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);
        else if (p === '♔' || p === '♚') for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) add(r + dr, c + dc);
      }
      return candidates;
    }

    case 'xiangqi': {
      // Generate moves using piece movement rules (no brute force)
      const red = new Set(['帥', '仕', '相', '俥', '傌', '炮', '兵']);
      const black = new Set(['將', '士', '象', '車', '馬', '砲', '卒']);
      const ownSet = playerIndex === 0 ? red : black;
      const sd = p => red.has(p) ? 0 : black.has(p) ? 1 : null;
      const R2 = 10, C2 = 9;
      const candidates = [];
      for (let from = 0; from < R2 * C2; from++) {
        const p = state.board[from];
        if (!ownSet.has(p)) continue;
        const r = Math.floor(from / C2), c = from % C2;
        const tryAdd = (rr, cc) => { if (rr < 0 || rr >= R2 || cc < 0 || cc >= C2) return; const to = rr * C2 + cc; if (sd(state.board[to]) !== playerIndex) candidates.push({ from, to }); };
        if ('車俥'.includes(p)) { for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { let rr = r + dr, cc2 = c + dc; while (rr >= 0 && rr < R2 && cc2 >= 0 && cc2 < C2) { const to = rr * C2 + cc2; if (state.board[to] == null) { candidates.push({ from, to }); } else { if (sd(state.board[to]) !== playerIndex) candidates.push({ from, to }); break; } rr += dr; cc2 += dc; } } }
        else if ('砲炮'.includes(p)) { for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { let rr = r + dr, cc2 = c + dc, jumped = false; while (rr >= 0 && rr < R2 && cc2 >= 0 && cc2 < C2) { const to = rr * C2 + cc2; if (!jumped) { if (state.board[to] == null) candidates.push({ from, to }); else jumped = true; } else { if (state.board[to] != null) { if (sd(state.board[to]) !== playerIndex) candidates.push({ from, to }); break; } } rr += dr; cc2 += dc; } } }
        else if ('馬傌'.includes(p)) { for (const [dr, dc, lr, lc] of [[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0],[1,2,0,1],[1,-2,0,-1],[-1,2,0,1],[-1,-2,0,-1]]) { if (state.board[(r + lr) * C2 + (c + lc)] != null) continue; tryAdd(r + dr, c + dc); } }
        else if ('象相'.includes(p)) { const limit = p === '象' ? 4 : 5; for (const [dr, dc] of [[2,2],[2,-2],[-2,2],[-2,-2]]) { const rr = r + dr, cc2 = c + dc; if (rr < 0 || rr >= R2 || cc2 < 0 || cc2 >= C2) continue; if (p === '象' && rr > limit) continue; if (p === '相' && rr < limit) continue; if (state.board[(r + dr / 2) * C2 + (c + dc / 2)] != null) continue; tryAdd(rr, cc2); } }
        else if ('士仕'.includes(p)) { const s = playerIndex; for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) { const rr = r + dr, cc2 = c + dc; const inPalace = s === 1 ? rr <= 2 : rr >= 7; if (inPalace && cc2 >= 3 && cc2 <= 5) tryAdd(rr, cc2); } }
        else if ('將帥'.includes(p)) { const s = playerIndex; for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const rr = r + dr, cc2 = c + dc; const inPalace = s === 1 ? rr <= 2 : rr >= 7; if (inPalace && cc2 >= 3 && cc2 <= 5) tryAdd(rr, cc2); } }
        else if (p === '卒') { if (r < 5) tryAdd(r + 1, c); else { tryAdd(r + 1, c); tryAdd(r, c - 1); tryAdd(r, c + 1); } }
        else if (p === '兵') { if (r > 4) tryAdd(r - 1, c); else { tryAdd(r - 1, c); tryAdd(r, c - 1); tryAdd(r, c + 1); } }
      }
      return candidates;
    }

    default:
      return [];
  }
}

// ─── Best Move Selection ────────────────────────────────────────────────────────

/**
 * Select the best move based on game-specific strategy.
 * - ttt, connect4: minimax with alpha-beta pruning
 * - reversi, caro: heuristic/positional scoring
 * - chess, xiangqi: material + positional evaluation
 * - rps, battleship, dots: random
 */
function selectBestMove(game, state, aiPlayerIndex, legalMoves) {
  const key = game.key;

  switch (key) {
    case 'ttt':
      return minimaxTTT(game, state, aiPlayerIndex, legalMoves);
    case 'connect4':
      return minimaxConnect4(game, state, aiPlayerIndex, legalMoves);
    case 'reversi':
      return heuristicReversi(game, state, aiPlayerIndex, legalMoves);
    case 'caro':
      return heuristicCaro(game, state, aiPlayerIndex, legalMoves);
    case 'chess':
      return fastChessMove(game, state, aiPlayerIndex, legalMoves);
    case 'xiangqi':
      return fastXiangqiMove(game, state, aiPlayerIndex, legalMoves);
    case 'rps':
    case 'battleship':
    case 'dots':
    default:
      return randomChoice(legalMoves);
  }
}

// ─── TTT Minimax ────────────────────────────────────────────────────────────────

function minimaxTTT(game, state, aiPlayerIndex, legalMoves) {
  let bestScore = -Infinity;
  let bestMove = legalMoves[0];

  for (const move of legalMoves) {
    const result = game.apply(state, move, aiPlayerIndex);
    const score = minimaxTTTScore(game, result.state, aiPlayerIndex, false, result.result);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimaxTTTScore(game, state, aiPlayerIndex, isMaximizing, result) {
  // Terminal check
  if (result) {
    if (result.winnerIndex === aiPlayerIndex) return 10;
    if (result.winnerIndex === null) return 0;
    return -10;
  }

  const currentPlayer = state.turn;
  const moves = state.board
    .map((v, i) => (v == null ? { index: i } : null))
    .filter(Boolean);

  if (moves.length === 0) return 0;

  if (isMaximizing) {
    let best = -Infinity;
    for (const move of moves) {
      const applied = game.apply(state, move, currentPlayer);
      const score = minimaxTTTScore(game, applied.state, aiPlayerIndex, false, applied.result);
      best = Math.max(best, score);
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      const applied = game.apply(state, move, currentPlayer);
      const score = minimaxTTTScore(game, applied.state, aiPlayerIndex, true, applied.result);
      best = Math.min(best, score);
    }
    return best;
  }
}

// ─── Connect4 Minimax with Alpha-Beta ───────────────────────────────────────────

const C4_COLS = 7;
const C4_ROWS = 6;
const C4_MAX_DEPTH = 5;

function minimaxConnect4(game, state, aiPlayerIndex, legalMoves) {
  let bestScore = -Infinity;
  let bestMove = legalMoves[0];

  for (const move of legalMoves) {
    try {
      const result = game.apply(state, move, aiPlayerIndex);
      const score = c4AlphaBeta(
        game, result.state, aiPlayerIndex, C4_MAX_DEPTH - 1,
        -Infinity, Infinity, false, result.result
      );
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    } catch { continue; }
  }
  return bestMove;
}

function c4AlphaBeta(game, state, aiPlayerIndex, depth, alpha, beta, isMaximizing, result) {
  if (result) {
    if (result.winnerIndex === aiPlayerIndex) return 1000 + depth;
    if (result.winnerIndex === null) return 0;
    return -1000 - depth;
  }
  if (depth === 0) return c4Evaluate(state, aiPlayerIndex);

  const currentPlayer = state.turn;
  const moves = [];
  for (let col = 0; col < C4_COLS; col++) {
    if (state.board[col] == null) moves.push({ col });
  }
  if (moves.length === 0) return 0;

  if (isMaximizing) {
    let value = -Infinity;
    for (const move of moves) {
      try {
        const applied = game.apply(state, move, currentPlayer);
        const score = c4AlphaBeta(game, applied.state, aiPlayerIndex, depth - 1, alpha, beta, false, applied.result);
        value = Math.max(value, score);
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break;
      } catch { continue; }
    }
    return value;
  } else {
    let value = Infinity;
    for (const move of moves) {
      try {
        const applied = game.apply(state, move, currentPlayer);
        const score = c4AlphaBeta(game, applied.state, aiPlayerIndex, depth - 1, alpha, beta, true, applied.result);
        value = Math.min(value, score);
        beta = Math.min(beta, value);
        if (alpha >= beta) break;
      } catch { continue; }
    }
    return value;
  }
}

function c4Evaluate(state, aiPlayerIndex) {
  const opponent = 1 - aiPlayerIndex;
  let score = 0;

  // Center column preference
  const centerCol = 3;
  for (let r = 0; r < C4_ROWS; r++) {
    const cell = state.board[r * C4_COLS + centerCol];
    if (cell === aiPlayerIndex) score += 3;
    else if (cell === opponent) score -= 3;
  }

  // Evaluate all windows of 4
  // Horizontal
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c <= C4_COLS - 4; c++) {
      score += c4WindowScore(state.board, r * C4_COLS + c, 1, aiPlayerIndex);
    }
  }
  // Vertical
  for (let r = 0; r <= C4_ROWS - 4; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      score += c4WindowScore(state.board, r * C4_COLS + c, C4_COLS, aiPlayerIndex);
    }
  }
  // Diagonal (down-right)
  for (let r = 0; r <= C4_ROWS - 4; r++) {
    for (let c = 0; c <= C4_COLS - 4; c++) {
      score += c4WindowScore(state.board, r * C4_COLS + c, C4_COLS + 1, aiPlayerIndex);
    }
  }
  // Diagonal (down-left)
  for (let r = 0; r <= C4_ROWS - 4; r++) {
    for (let c = 3; c < C4_COLS; c++) {
      score += c4WindowScore(state.board, r * C4_COLS + c, C4_COLS - 1, aiPlayerIndex);
    }
  }

  return score;
}

function c4WindowScore(board, start, step, aiPlayerIndex) {
  let ai = 0, opp = 0, empty = 0;
  for (let i = 0; i < 4; i++) {
    const cell = board[start + i * step];
    if (cell === aiPlayerIndex) ai++;
    else if (cell === 1 - aiPlayerIndex) opp++;
    else empty++;
  }
  if (ai === 4) return 100;
  if (ai === 3 && empty === 1) return 5;
  if (ai === 2 && empty === 2) return 2;
  if (opp === 3 && empty === 1) return -4;
  return 0;
}

// ─── Reversi Heuristic ──────────────────────────────────────────────────────────

const REVERSI_WEIGHTS = [
  120, -20,  20,   5,   5,  20, -20, 120,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
   20,  -5,  15,   3,   3,  15,  -5,  20,
    5,  -5,   3,   3,   3,   3,  -5,   5,
    5,  -5,   3,   3,   3,   3,  -5,   5,
   20,  -5,  15,   3,   3,  15,  -5,  20,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
  120, -20,  20,   5,   5,  20, -20, 120
];

function heuristicReversi(game, state, aiPlayerIndex, legalMoves) {
  let bestScore = -Infinity;
  let bestMove = legalMoves[0];

  for (const move of legalMoves) {
    try {
      const applied = game.apply(state, move, aiPlayerIndex);
      const score = reversiEvaluate(applied.state, aiPlayerIndex);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    } catch { continue; }
  }
  return bestMove;
}

function reversiEvaluate(state, aiPlayerIndex) {
  const opponent = 1 - aiPlayerIndex;
  let score = 0;

  // Positional scoring
  for (let i = 0; i < 64; i++) {
    if (state.board[i] === aiPlayerIndex) score += REVERSI_WEIGHTS[i];
    else if (state.board[i] === opponent) score -= REVERSI_WEIGHTS[i];
  }

  // Mobility bonus: count available moves for AI vs opponent
  const aiMoves = enumerateLegalMovesQuick('reversi', state, aiPlayerIndex);
  const oppMoves = enumerateLegalMovesQuick('reversi', state, opponent);
  score += (aiMoves - oppMoves) * 10;

  return score;
}

/** Quick mobility count for reversi without generating full action objects */
function enumerateLegalMovesQuick(key, state, playerIndex) {
  if (key !== 'reversi') return 0;
  const N = 8;
  const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  let count = 0;
  for (let index = 0; index < 64; index++) {
    if (state.board[index] != null) continue;
    const r = Math.floor(index / N), c = index % N;
    let valid = false;
    for (const [dr, dc] of DIRS) {
      let rr = r + dr, cc = c + dc, line = 0;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && state.board[rr * N + cc] === (1 - playerIndex)) {
        line++; rr += dr; cc += dc;
      }
      if (line > 0 && rr >= 0 && rr < N && cc >= 0 && cc < N && state.board[rr * N + cc] === playerIndex) {
        valid = true;
        break;
      }
    }
    if (valid) count++;
  }
  return count;
}

// ─── Caro Heuristic ─────────────────────────────────────────────────────────────

function heuristicCaro(game, state, aiPlayerIndex, legalMoves) {
  // Only consider moves adjacent to existing pieces (within 2 cells)
  const relevantMoves = getRelevantCaroMoves(state, legalMoves);
  const movesToEvaluate = relevantMoves.length > 0 ? relevantMoves : legalMoves.slice(0, 50);

  let bestScore = -Infinity;
  let bestMove = movesToEvaluate[0];

  for (const move of movesToEvaluate) {
    const score = caroEvaluateMove(state, move.index, aiPlayerIndex);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function getRelevantCaroMoves(state, legalMoves) {
  const N = 15;
  const adjacent = new Set();

  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] == null) continue;
    const r = Math.floor(i / N), c = i % N;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) {
          const idx = nr * N + nc;
          if (state.board[idx] == null) adjacent.add(idx);
        }
      }
    }
  }

  if (adjacent.size === 0) {
    // First move — play center
    return [{ index: Math.floor(N * N / 2) }];
  }

  return legalMoves.filter(m => adjacent.has(m.index));
}

function caroEvaluateMove(state, index, aiPlayerIndex) {
  const N = 15;
  const r = Math.floor(index / N), c = index % N;
  const opponent = 1 - aiPlayerIndex;
  let score = 0;

  // Evaluate placing AI piece here
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

  for (const [dr, dc] of directions) {
    // Count consecutive AI pieces in this direction
    const aiLine = countLine(state.board, N, r, c, dr, dc, aiPlayerIndex);
    const oppLine = countLine(state.board, N, r, c, dr, dc, opponent);

    // Score AI offensive potential
    score += lineScore(aiLine);
    // Score defensive value (blocking opponent)
    score += lineScore(oppLine) * 0.9;
  }

  // Slight center preference
  const centerDist = Math.abs(r - 7) + Math.abs(c - 7);
  score += Math.max(0, 14 - centerDist) * 0.1;

  return score;
}

function countLine(board, N, r, c, dr, dc, player) {
  let count = 0;
  let openEnds = 0;

  // Forward direction
  let rr = r + dr, cc = c + dc, fwd = 0;
  while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === player) {
    fwd++; rr += dr; cc += dc;
  }
  if (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] == null) openEnds++;

  // Backward direction
  rr = r - dr; cc = c - dc;
  let bwd = 0;
  while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === player) {
    bwd++; rr -= dr; cc -= dc;
  }
  if (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] == null) openEnds++;

  count = fwd + bwd;
  return { count, openEnds };
}

function lineScore(line) {
  const { count, openEnds } = line;
  if (count >= 4) return 100000; // winning or near-winning
  if (count === 3 && openEnds === 2) return 10000;
  if (count === 3 && openEnds === 1) return 1000;
  if (count === 2 && openEnds === 2) return 500;
  if (count === 2 && openEnds === 1) return 50;
  if (count === 1 && openEnds === 2) return 10;
  if (count === 1 && openEnds === 1) return 3;
  return 0;
}

// ─── Chess Heuristic ────────────────────────────────────────────────────────────

const CHESS_PIECE_VALUES = {
  '♙': 100, '♖': 500, '♘': 320, '♗': 330, '♕': 900, '♔': 20000,
  '♟': 100, '♜': 500, '♞': 320, '♝': 330, '♛': 900, '♚': 20000
};
const WHITE_PIECES = new Set(['♙', '♖', '♘', '♗', '♕', '♔']);
const BLACK_PIECES = new Set(['♟', '♜', '♞', '♝', '♛', '♚']);

function fastChessMove(game, state, aiPlayerIndex, legalMoves) {
  // Fast 1-ply: prefer captures by piece value, then random
  const captures = [], others = [];
  for (const m of legalMoves) {
    const target = state.board[m.to];
    if (target != null) captures.push({ move: m, value: CHESS_PIECE_VALUES[target] || 0 });
    else others.push(m);
  }
  // If can capture king, do it
  for (const c of captures) if (c.value >= 20000) return c.move;
  // Prefer highest value capture
  if (captures.length) { captures.sort((a, b) => b.value - a.value); return captures[0].move; }
  // Otherwise random
  return randomChoice(others.length ? others : legalMoves);
}

function fastXiangqiMove(game, state, aiPlayerIndex, legalMoves) {
  // Fast 1-ply: prefer captures by piece value, then random
  const captures = [], others = [];
  for (const m of legalMoves) {
    const target = state.board[m.to];
    if (target != null) captures.push({ move: m, value: XIANGQI_VALUES[target] || 0 });
    else others.push(m);
  }
  // If can capture general/king, do it
  for (const c of captures) if (c.value >= 20000) return c.move;
  // Prefer highest value capture
  if (captures.length) { captures.sort((a, b) => b.value - a.value); return captures[0].move; }
  // Otherwise random
  return randomChoice(others.length ? others : legalMoves);
}

// ─── Xiangqi Heuristic ──────────────────────────────────────────────────────────

const XIANGQI_VALUES = {
  '帥': 20000, '仕': 200, '相': 200, '俥': 900, '傌': 450, '炮': 450, '兵': 100,
  '將': 20000, '士': 200, '象': 200, '車': 900, '馬': 450, '砲': 450, '卒': 100
};
const RED_PIECES = new Set(['帥', '仕', '相', '俥', '傌', '炮', '兵']);
const BLACK_XQ_PIECES = new Set(['將', '士', '象', '車', '馬', '砲', '卒']);

// fastXiangqiMove is defined above — remove old heuristic
// (heuristicXiangqi replaced by fastXiangqiMove in selectBestMove)

// xiangqiEvaluate removed — fastXiangqiMove uses direct capture preference

// ─── Utility Functions ──────────────────────────────────────────────────────────

function randomChoice(arr) {
  return arr[crypto.randomInt(arr.length)];
}

function shuffleAndTake(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// ─── Main AI Move Computation ───────────────────────────────────────────────────

/**
 * Compute AI move for a given game state.
 *
 * @param {object} state - Current game state where state.turn === aiPlayerIndex
 * @param {string} gameKey - The game key (e.g., 'ttt', 'connect4')
 * @param {number} aiPlayerIndex - The player index of the AI (0 or 1)
 * @returns {Promise<{state: object, result: object|null, action: object}>}
 */
export async function computeAiMove(state, gameKey, aiPlayerIndex) {
  const game = getGame(gameKey);
  const difficulty = await getAiDifficulty(gameKey);

  // Get all legal moves for the AI
  const legalMoves = enumerateLegalMoves(game, state, aiPlayerIndex);

  if (legalMoves.length === 0) {
    // No valid moves — for reversi this means pass (handled by engine).
    // For other games, if no moves exist, the game should be finalized.
    // Return state unchanged with no action — caller should handle.
    return { state, result: null, action: null };
  }

  // Select move based on difficulty
  let selectedAction;
  switch (difficulty) {
    case 'impossible':
      selectedAction = selectBestMove(game, state, aiPlayerIndex, legalMoves);
      break;
    case 'nightmare':
      // 90% best, 10% random
      selectedAction = Math.random() < 0.9
        ? selectBestMove(game, state, aiPlayerIndex, legalMoves)
        : randomChoice(legalMoves);
      break;
    case 'hard':
    default:
      // 70% best, 30% random
      selectedAction = Math.random() < 0.7
        ? selectBestMove(game, state, aiPlayerIndex, legalMoves)
        : randomChoice(legalMoves);
      break;
  }

  // Apply the selected move through game engine
  const applied = game.apply(state, selectedAction, aiPlayerIndex);
  return { state: applied.state, result: applied.result || null, action: selectedAction };
}
