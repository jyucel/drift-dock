#!/usr/bin/env node
/**
 * Offline level generator for Drift Dock.
 *
 * Builds random boards for each difficulty tier, analyses them with the exact
 * solver and keeps the most interesting ones (long optimal solutions, many
 * dead-end states, few correct first moves, and the tier's featured mechanic
 * actually used by the optimal solution).
 *
 * Usage: node tools/generate.mjs <tier> [seed] [seconds]
 *   -> writes tools/out/<tier>-<seed>.json (run one process per tier in parallel)
 * The curated output is copied by hand into src/levels.js; tests re-verify it.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseLevel, COLORS } from '../src/engine.js';
import { solve, applyMove } from '../src/solver.js';
import { fastAnalyze } from '../src/fastsolver.js';

const tierArg = process.argv[2];
const seedArg = Number(process.argv[3] || 7);
const budgetMs = Number(process.argv[4] || 240) * 1000;
let seed = seedArg >>> 0;
const rand = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const TIERS = [
  { name: 'basic', count: 4, w: [5, 5], h: [5, 6], colors: [2, 2], perColor: [1, 2], walls: [2, 4], paint: [0, 0], stones: [0, 0], wraps: [0, 0], L: [4, 7], need: [] },
  { name: 'paint', count: 4, w: [5, 6], h: [5, 6], colors: [2, 3], perColor: [1, 1], walls: [2, 4], paint: [1, 2], stones: [0, 0], wraps: [0, 0], L: [5, 9], need: ['paint'] },
  { name: 'stone', count: 4, w: [5, 6], h: [5, 6], colors: [2, 2], perColor: [1, 2], walls: [1, 4], paint: [0, 1], stones: [1, 2], wraps: [0, 0], L: [5, 11], need: ['stone'] },
  { name: 'wrap', count: 4, w: [5, 6], h: [5, 6], colors: [2, 3], perColor: [1, 2], walls: [2, 5], paint: [0, 1], stones: [0, 1], wraps: [1, 2], L: [5, 12], need: ['wrap'] },
  { name: 'master', count: 5, w: [6, 6], h: [6, 6], colors: [2, 3], perColor: [1, 2], walls: [3, 6], paint: [1, 2], stones: [0, 1], wraps: [0, 1], L: [9, 18], need: [] },
  // chapters 2-6 (levels 25-124): denser pillars keep boards tight and focused
  { name: 'c2', w: [5, 6], h: [5, 6], colors: [2, 3], perColor: [1, 2], walls: [4, 8], paint: [0, 2], stones: [0, 1], wraps: [0, 0], L: [7, 11], need: [] },
  { name: 'c3', w: [5, 6], h: [5, 7], colors: [2, 3], perColor: [1, 1], walls: [5, 9], paint: [0, 2], stones: [1, 2], wraps: [0, 0], L: [8, 14], need: ['stone'] },
  { name: 'c4', w: [5, 6], h: [5, 7], colors: [2, 3], perColor: [1, 2], walls: [5, 9], paint: [0, 1], stones: [0, 1], wraps: [1, 2], L: [9, 15], need: ['wrap'] },
  { name: 'c5', w: [6, 7], h: [6, 7], colors: [3, 4], perColor: [1, 1], walls: [8, 14], paint: [1, 2], stones: [0, 1], wraps: [0, 1], L: [11, 18], need: ['paint'] },
  { name: 'c6', w: [6, 7], h: [6, 7], colors: [3, 4], perColor: [1, 1], walls: [8, 14], paint: [1, 3], stones: [0, 2], wraps: [0, 2], L: [13, 26], need: [] },
];

function randomDef(t) {
  const W = ri(...t.w);
  const H = ri(...t.h);
  const grid = Array.from({ length: H + 2 }, (_, y) =>
    Array.from({ length: W + 2 }, (_, x) => (x === 0 || y === 0 || x === W + 1 || y === H + 1 ? '#' : '.')),
  );
  const free = () => {
    for (let i = 0; i < 200; i++) {
      const x = ri(1, W);
      const y = ri(1, H);
      if (grid[y][x] === '.') return [x, y];
    }
    return null;
  };
  const freeBorder = () => {
    for (let i = 0; i < 200; i++) {
      const side = ri(0, 3);
      let x;
      let y;
      if (side === 0) [x, y] = [ri(1, W), 0];
      else if (side === 1) [x, y] = [ri(1, W), H + 1];
      else if (side === 2) [x, y] = [0, ri(1, H)];
      else [x, y] = [W + 1, ri(1, H)];
      if (grid[y][x] === '#') return [x, y];
    }
    return null;
  };
  const palette = [...COLORS].sort(() => rand() - 0.5);
  const nColors = ri(...t.colors);
  const used = palette.slice(0, nColors);
  // wraps first so docks don't collide with them
  for (let i = ri(...t.wraps); i > 0; i--) {
    if (rand() < 0.5) {
      const y = ri(1, H);
      if (grid[y][0] === '#' && grid[y][W + 1] === '#') grid[y][0] = grid[y][W + 1] = '~';
    } else {
      const x = ri(1, W);
      if (grid[0][x] === '#' && grid[H + 1][x] === '#') grid[0][x] = grid[H + 1][x] = '~';
    }
  }
  for (let i = ri(...t.walls); i > 0; i--) {
    const p = free();
    if (p) grid[p[1]][p[0]] = '#';
  }
  const paintColors = [];
  for (let i = ri(...t.paint); i > 0; i--) {
    const p = free();
    const c = rand() < 0.6 ? pick(palette.slice(0, nColors + 1)) : pick(used);
    if (p) {
      grid[p[1]][p[0]] = c.toLowerCase();
      paintColors.push(c);
    }
  }
  const dockColors = new Set([...used, ...paintColors]);
  for (const c of dockColors) {
    const p = freeBorder();
    if (p) grid[p[1]][p[0]] = c;
  }
  for (const c of used) {
    for (let i = ri(...t.perColor); i > 0; i--) {
      const p = free();
      if (p) grid[p[1]][p[0]] = c;
    }
  }
  for (let i = ri(...t.stones); i > 0; i--) {
    const p = free();
    if (p) grid[p[1]][p[0]] = 'S';
  }
  return { map: grid.map((r) => r.join('')) };
}

function mechanicsUsed(level, moves) {
  const used = new Set();
  let blocks = level.blocks;
  for (const m of moves) {
    const res = applyMove(level, blocks, m);
    const mover = blocks.find((b) => b.x === m.x && b.y === m.y);
    if (res.painted) used.add('paint');
    if (res.wrapped) used.add('wrap');
    if (mover.color === 'S') used.add('stone');
    blocks = res.blocks;
  }
  return used;
}

const seen = new Set();
const t = TIERS.find((x) => x.name === tierArg);
if (!t) throw new Error(`unknown tier ${tierArg}; use one of ${TIERS.map((x) => x.name)}`);
{
  const found = [];
  const t0 = Date.now();
  const save = () => {
    found.sort((p, q) => q.score - p.score);
    mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`./out/${t.name}-${seedArg}.json`, import.meta.url), JSON.stringify(found.slice(0, 80), null, 1));
  };
  let lastSave = t0;
  while (Date.now() - t0 < budgetMs) {
    if (Date.now() - lastSave > 60000) {
      save();
      lastSave = Date.now();
    }
    const def = randomDef(t);
    const key = def.map.join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    let level;
    try {
      level = parseLevel({ id: 'gen', ...def });
    } catch {
      continue;
    }
    if (level.blocks.filter((b) => b.color !== 'S').length < 2) continue;
    // screen with the fast solver; small caps also favour tight, focused boards
    const a = fastAnalyze(level, t.cap || 40000);
    if (a.capped || a.optimal < t.L[0] || a.optimal > t.L[1]) continue;
    const sol = solve(level, level.blocks, 2_000_000);
    const used = mechanicsUsed(level, sol.moves);
    if (!t.need.every((n) => used.has(n))) continue;
    const score = a.optimal + a.deadShare * 8 - a.goodFirst * 0.7 + used.size * 0.5 - Math.log10(a.states) * 0.5;
    found.push({ ...def, optimal: a.optimal, states: a.states, deadShare: +a.deadShare.toFixed(3), goodFirst: a.goodFirst, used: [...used], score });
  }
  save();
  console.log(`${t.name}: ${found.length} candidates, best L=${found[0]?.optimal}`);
}
