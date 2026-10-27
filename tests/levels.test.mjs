// Level verification: every shipped level is proven solvable by the exact
// solver, its par is the true optimum, and the optimal solution replays
// legally move by move under the game rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { parseLevel, Session, isWon, blockAt } from '../src/engine.js';
import { solve, analyze, legalMoves } from '../src/solver.js';

test('there are at least 20 levels with unique ids and names', () => {
  assert.ok(LEVELS.length >= 20, `only ${LEVELS.length} levels`);
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVELS.length);
  for (const l of LEVELS) assert.ok(l.name && l.name.length > 1, `level ${l.id} needs a name`);
});

for (const [i, def] of LEVELS.entries()) {
  test(`level ${i + 1} "${def.name}" is valid, solvable and its par is optimal`, () => {
    const level = parseLevel(def);
    assert.ok(!isWon(level.blocks), 'level must not start already won');
    assert.ok(level.blocks.some((b) => b.color !== 'S'), 'level needs coloured blocks');

    // every coloured block's colour must have at least one dock, or a paint pad leading elsewhere
    const dockColors = new Set([...level.border.values()].filter((f) => f.kind === 'dock').map((f) => f.color));
    const paintColors = new Set(level.cells.filter((c) => c.kind === 'paint').map((c) => c.color));
    for (const b of level.blocks) {
      if (b.color === 'S') continue;
      assert.ok(dockColors.has(b.color) || paintColors.size > 0, `no way out for ${b.color} block`);
    }

    const r = solve(level, level.blocks, 3_000_000);
    assert.ok(!r.capped, 'solver must finish exhaustively');
    assert.ok(r.solvable, 'level must be solvable');
    assert.equal(r.moves.length, def.par, 'stored par must equal the optimal solution length');

    // Replay through the Session API: each move must be legal and the last one must win.
    const s = new Session(level);
    for (const [k, m] of r.moves.entries()) {
      assert.ok(!s.won, `won early at move ${k}`);
      const b = blockAt(s.blocks, m.x, m.y);
      assert.ok(b, `move ${k}: no block at ${m.x},${m.y}`);
      const res = s.move(b.id, m.dir);
      assert.ok(res.ok, `move ${k} illegal: ${res.reason}`);
    }
    assert.ok(s.won, 'optimal solution must win');
    assert.equal(s.moves, def.par);
  });
}

test('no level can be won in fewer moves than par (exhaustive check of the state graph)', () => {
  for (const def of LEVELS) {
    const a = analyze(parseLevel(def), 2_000_000);
    assert.ok(!a.capped, `${def.id}: state graph too large to verify`);
    assert.equal(a.optimal, def.par, `${def.id}: exhaustive optimum differs from par`);
  }
});

test('tutorial levels never trap the player in the first two levels', () => {
  for (const def of LEVELS.slice(0, 2)) {
    const a = analyze(parseLevel(def));
    assert.equal(a.deadShare, 0, `${def.id} has dead ends`);
  }
});

test('difficulty increases: later tiers demand longer solutions', () => {
  const avg = (arr) => arr.reduce((s, l) => s + l.par, 0) / arr.length;
  const first = avg(LEVELS.slice(0, 4));
  const mid = avg(LEVELS.slice(4, 12));
  const last = avg(LEVELS.slice(-4));
  assert.ok(first < mid && mid < last, `averages ${first} < ${mid} < ${last}`);
  assert.ok(LEVELS.slice(-4).every((l) => l.par >= 10), 'final levels should be substantial');
});

test('each introduced mechanic actually appears in its intro level', () => {
  for (const def of LEVELS.filter((l) => l.intro)) {
    const level = parseLevel(def);
    if (def.intro === 'paint') assert.ok(level.cells.some((c) => c.kind === 'paint'));
    if (def.intro === 'stone') assert.ok(level.blocks.some((b) => b.color === 'S'));
    if (def.intro === 'wrap') assert.ok([...level.border.values()].some((f) => f.kind === 'wrap'));
  }
});

test('legal move generation agrees with the session rules', () => {
  const level = parseLevel(LEVELS[4]);
  for (const m of legalMoves(level, level.blocks)) {
    const s = new Session(level);
    assert.ok(s.move(blockAt(s.blocks, m.x, m.y).id, m.dir).ok);
  }
});
