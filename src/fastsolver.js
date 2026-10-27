/**
 * Fast solver: the rules of engine.js compiled into flat lookup tables with
 * integer-coded states, exploring hundreds of thousands of states per second.
 *
 * Used by the in-game hint / dead-end checks (inside a Web Worker) and by the
 * level generator. Every shipped level is still verified by the reference
 * engine and solver in the tests, and tests/fastsolver.test.mjs cross-checks
 * the two implementations on every level.
 */
import { DIR_NAMES, DIRS } from './engine.js';

const COLOR_IDX = { R: 0, G: 1, B: 2, Y: 3, P: 4, S: 5 };
const STONE = 5;

/** Compile a parsed level into lookup tables. */
export function compile(level, blocks = level.blocks) {
  const { W, H } = level;
  const N = W * H;
  // next[cell*4+d]: >=0 next cell, -1 solid, <=-2 dock of colour (-2 - n)
  const next = new Int16Array(N * 4).fill(-1);
  const paint = new Int8Array(N).fill(-1);
  const wall = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const c = level.cells[i];
    if (c.kind === 'wall') wall[i] = 1;
    if (c.kind === 'paint') paint[i] = COLOR_IDX[c.color];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      DIR_NAMES.forEach((dir, d) => {
        const [dx, dy] = DIRS[dir];
        let nx = x + dx;
        let ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
          const edge = level.border.get(`${nx},${ny}`);
          if (!edge) return;
          if (edge.kind === 'dock') {
            next[i * 4 + d] = -2 - COLOR_IDX[edge.color];
            return;
          }
          nx = (nx + W) % W;
          ny = (ny + H) % H;
        }
        const j = ny * W + nx;
        if (!wall[j]) next[i * 4 + d] = j;
      });
    }
  }
  const start = blocks.map((b) => COLOR_IDX[b.color] * 64 + b.y * W + b.x).sort((a, b) => a - b);
  return { N, next, paint, start };
}

const keyOf = (codes) => String.fromCharCode(...codes);
const won = (codes) => codes.every((c) => c >> 6 === STONE);

/** Successor states of `codes` (sorted block codes). Calls emit(newCodes). */
function expand(t, codes, occ, emit) {
  const { next, paint, N } = t;
  for (const c of codes) occ[c & 63] = 1;
  const limit = N * 6 + 2;
  for (let k = 0; k < codes.length; k++) {
    const code = codes[k];
    const color0 = code >> 6;
    const cell0 = code & 63;
    for (let d = 0; d < 4; d++) {
      let cur = cell0;
      let col = color0;
      let steps = 0;
      let exited = false;
      occ[cell0] = 0;
      for (;;) {
        const n = next[cur * 4 + d];
        if (n === -1) break;
        if (n <= -2) {
          if (col !== STONE && col === -2 - n) exited = true;
          break;
        }
        if (occ[n]) break;
        cur = n;
        if (paint[cur] >= 0 && col !== STONE) col = paint[cur];
        if (++steps > limit) {
          steps = -1; // endless loop: illegal
          break;
        }
      }
      occ[cell0] = 1;
      if (steps === -1 || (steps === 0 && !exited)) continue;
      const out = codes.slice();
      if (exited) out.splice(k, 1);
      else {
        out[k] = col * 64 + cur;
        out.sort((a, b) => a - b);
      }
      emit(out, cell0, d);
    }
  }
  for (const c of codes) occ[c & 63] = 0;
}

/**
 * Explore the full reachable state graph (up to `cap` states).
 * Returns { capped, states, optimal, deadShare, goodFirst, firstMoves }.
 */
export function fastAnalyze(level, cap = 200000) {
  const t = compile(level);
  const index = new Map();
  const states = [];
  const succStart = [0];
  const succ = [];
  const occ = new Uint8Array(t.N);
  const add = (codes) => {
    const k = keyOf(codes);
    let i = index.get(k);
    if (i === undefined) {
      i = states.length;
      index.set(k, i);
      states.push(codes);
    }
    return i;
  };
  add(t.start);
  for (let i = 0; i < states.length; i++) {
    if (states.length > cap) return { capped: true, states: states.length };
    expand(t, states[i], occ, (codes) => succ.push(add(codes)));
    succStart.push(succ.length);
  }
  const S = states.length;
  // reverse adjacency (CSR)
  const revCount = new Int32Array(S + 1);
  for (const j of succ) revCount[j + 1]++;
  for (let i = 0; i < S; i++) revCount[i + 1] += revCount[i];
  const rev = new Int32Array(succ.length);
  const fill = revCount.slice();
  for (let i = 0; i < S; i++) for (let e = succStart[i]; e < succStart[i + 1]; e++) rev[fill[succ[e]]++] = i;
  const dist = new Int32Array(S).fill(-1);
  let q = [];
  for (let i = 0; i < S; i++) if (won(states[i])) { dist[i] = 0; q.push(i); }
  while (q.length) {
    const nq = [];
    for (const j of q) for (let e = revCount[j]; e < revCount[j + 1]; e++) {
      const i = rev[e];
      if (dist[i] < 0) { dist[i] = dist[j] + 1; nq.push(i); }
    }
    q = nq;
  }
  let dead = 0;
  for (let i = 0; i < S; i++) if (dist[i] < 0) dead++;
  let goodFirst = 0;
  for (let e = succStart[0]; e < succStart[1]; e++) if (dist[succ[e]] === dist[0] - 1) goodFirst++;
  return {
    capped: false,
    states: S,
    optimal: dist[0],
    deadShare: dead / S,
    goodFirst,
    firstMoves: succStart[1] - succStart[0],
  };
}

/**
 * Shortest solution from `blocks` (breadth-first, so optimal).
 * Returns { solvable, capped, moves: [{ x, y, dir }] | null, explored }.
 */
export function fastSolve(level, blocks = level.blocks, cap = 400000) {
  const t = compile(level, blocks);
  if (won(t.start)) return { solvable: true, capped: false, moves: [], explored: 1 };
  const seen = new Map([[keyOf(t.start), -1]]);
  const states = [t.start];
  const parent = [-1];
  const via = [0]; // cell * 4 + dir of the move that produced the state
  const occ = new Uint8Array(t.N);
  for (let i = 0; i < states.length; i++) {
    let goal = -1;
    expand(t, states[i], occ, (codes, cell, d) => {
      if (goal >= 0) return;
      const k = keyOf(codes);
      if (seen.has(k)) return;
      seen.set(k, states.length);
      states.push(codes);
      parent.push(i);
      via.push(cell * 4 + d);
      if (won(codes)) goal = states.length - 1;
    });
    if (goal >= 0) {
      const moves = [];
      for (let s = goal; parent[s] >= 0; s = parent[s]) {
        const cell = via[s] >> 2;
        moves.push({ x: cell % level.W, y: Math.floor(cell / level.W), dir: DIR_NAMES[via[s] & 3] });
      }
      return { solvable: true, capped: false, moves: moves.reverse(), explored: states.length };
    }
    if (states.length > cap) return { solvable: false, capped: true, moves: null, explored: states.length };
  }
  return { solvable: false, capped: false, moves: null, explored: states.length };
}
