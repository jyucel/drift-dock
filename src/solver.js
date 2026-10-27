/**
 * Breadth-first solver for Drift Dock levels.
 *
 * Because every move costs exactly one, BFS returns an optimal (minimum-move)
 * solution. Moves are reported by block *position* rather than id, so a
 * solution found from any state can be replayed on any equivalent state.
 */
import { DIR_NAMES, slide, stateKey, isWon, blockAt } from './engine.js';

/** All legal moves from a block configuration. */
export function legalMoves(level, blocks) {
  const out = [];
  for (const b of blocks) {
    for (const dir of DIR_NAMES) {
      const res = slide(level, blocks, b.id, dir);
      if (res.ok) out.push({ x: b.x, y: b.y, dir, res });
    }
  }
  return out;
}

/**
 * Find a shortest solution from `blocks` (defaults to the level start).
 * Returns { solvable, moves: [{x,y,dir}], explored, capped }.
 */
export function solve(level, blocks = level.blocks, maxStates = 400000) {
  const startKey = stateKey(blocks);
  if (isWon(blocks)) return { solvable: true, moves: [], explored: 1, capped: false };
  const parent = new Map([[startKey, null]]);
  let frontier = [blocks];
  let explored = 1;
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      const curKey = stateKey(cur);
      for (const m of legalMoves(level, cur)) {
        const k = stateKey(m.res.blocks);
        if (parent.has(k)) continue;
        parent.set(k, { prev: curKey, move: { x: m.x, y: m.y, dir: m.dir } });
        explored++;
        if (isWon(m.res.blocks)) {
          const moves = [];
          let key = k;
          while (parent.get(key)) {
            const p = parent.get(key);
            moves.push(p.move);
            key = p.prev;
          }
          return { solvable: true, moves: moves.reverse(), explored, capped: false };
        }
        if (explored >= maxStates) return { solvable: false, moves: null, explored, capped: true };
        next.push(m.res.blocks);
      }
    }
    frontier = next;
  }
  return { solvable: false, moves: null, explored, capped: false };
}

/**
 * Exhaustively explore a level's state graph. Used by the generator and tests
 * to measure difficulty: optimal length, number of reachable states and the
 * share of reachable states from which the level can no longer be won.
 */
export function analyze(level, maxStates = 300000) {
  const index = new Map();
  const states = [];
  const edges = [];
  const push = (b) => {
    const k = stateKey(b);
    if (index.has(k)) return index.get(k);
    const i = states.length;
    index.set(k, i);
    states.push(b);
    edges.push(null);
    return i;
  };
  push(level.blocks);
  for (let i = 0; i < states.length; i++) {
    if (states.length > maxStates) return { capped: true, states: states.length };
    const succ = [];
    for (const m of legalMoves(level, states[i])) succ.push(push(m.res.blocks));
    edges[i] = succ;
  }
  // Reverse BFS from winning states for distance-to-goal.
  const rev = states.map(() => []);
  edges.forEach((succ, i) => succ.forEach((j) => rev[j].push(i)));
  const dist = new Array(states.length).fill(-1);
  let q = [];
  states.forEach((b, i) => {
    if (isWon(b)) {
      dist[i] = 0;
      q.push(i);
    }
  });
  while (q.length) {
    const nq = [];
    for (const j of q) for (const i of rev[j]) if (dist[i] < 0) { dist[i] = dist[j] + 1; nq.push(i); }
    q = nq;
  }
  const dead = dist.filter((v) => v < 0).length;
  const firstMoves = edges[0].length;
  const goodFirst = edges[0].filter((j) => dist[j] === dist[0] - 1).length;
  return {
    capped: false,
    states: states.length,
    optimal: dist[0],
    deadShare: dead / states.length,
    firstMoves,
    goodFirst,
  };
}

/** Apply a position-based move to a block list (used for replaying solutions). */
export function applyMove(level, blocks, move) {
  const b = blockAt(blocks, move.x, move.y);
  if (!b) return { ok: false, reason: 'no-block' };
  return slide(level, blocks, b.id, move.dir);
}
