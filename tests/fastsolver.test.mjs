// Fast solver checks beyond the per-level cross-check in level-checks.mjs:
// mid-game positions and dead-end detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { parseLevel } from '../src/engine.js';

test('fast solver finds optimal, legal solutions from the start and mid-game', async () => {
  const { fastSolve } = await import('../src/fastsolver.js');
  const { solve, applyMove } = await import('../src/solver.js');
  for (const def of LEVELS.filter((_, i) => i % 5 === 0)) {
    const level = parseLevel(def);
    const r = fastSolve(level);
    assert.ok(r.solvable, def.id);
    assert.equal(r.moves.length, def.par, `${def.id}: fast par`);
    // replay with the reference engine
    let blocks = level.blocks;
    for (const m of r.moves) {
      const res = applyMove(level, blocks, m);
      assert.ok(res.ok, `${def.id}: illegal fast move`);
      blocks = res.blocks;
    }
    assert.ok(blocks.every((b) => b.color === 'S'), `${def.id}: fast solution must win`);
    // from the position after the first optimal move, both solvers agree
    const mid = applyMove(level, level.blocks, r.moves[0]).blocks;
    assert.equal(fastSolve(level, mid).moves.length, solve(level, mid, 3_000_000).moves.length, `${def.id}: mid-game`);
  }
});

test('fast solver reports dead ends', async () => {
  const { fastSolve } = await import('../src/fastsolver.js');
  // blue leaves first in "Wrong Door", then red slides past its column: lost
  const level = parseLevel(LEVELS.find((l) => l.id === 'stopper'));
  const lost = [{ id: 0, color: 'R', x: 4, y: 3 }];
  const r = fastSolve(level, lost);
  assert.equal(r.solvable, false);
  assert.equal(r.capped, false);
});
