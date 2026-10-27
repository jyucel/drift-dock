/**
 * Web Worker that runs the fast solver off the main thread, so hints and
 * dead-end checks never stall animations or input on large boards.
 * Message in:  { id, def, blocks, cap }   Message out: { id, solvable, capped, moves }
 */
import { parseLevel } from './engine.js';
import { fastSolve } from './fastsolver.js';

const cache = new Map();

self.onmessage = (e) => {
  const { id, def, blocks, cap } = e.data;
  let level = cache.get(def.id);
  if (!level) {
    level = parseLevel(def);
    cache.set(def.id, level);
  }
  const r = fastSolve(level, blocks, cap);
  self.postMessage({ id, solvable: r.solvable, capped: r.capped, moves: r.moves });
};
