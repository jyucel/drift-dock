// Level-set checks. Per-level proofs (solvable, optimal par, legal replay)
// live in level-checks.mjs and run per chapter in levels-ch*.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, CHAPTERS } from '../src/levels.js';
import { parseLevel, Session, blockAt } from '../src/engine.js';
import { analyze, legalMoves } from '../src/solver.js';

test('there are at least 20 levels with unique ids and names', () => {
  assert.ok(LEVELS.length >= 20, `only ${LEVELS.length} levels`);
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVELS.length);
  for (const l of LEVELS) assert.ok(l.name && l.name.length > 1, `level ${l.id} needs a name`);
});

test('tutorial levels never trap the player in the first two levels', () => {
  for (const def of LEVELS.slice(0, 2)) {
    const a = analyze(parseLevel(def));
    assert.equal(a.deadShare, 0, `${def.id} has dead ends`);
  }
});

test('there are 124 levels in 6 chapters of 24 + 5 x 20, with unique boards', () => {
  assert.equal(LEVELS.length, 124);
  assert.equal(CHAPTERS.length, 6);
  const counts = CHAPTERS.map((_, c) => LEVELS.filter((l) => l.chapter === c + 1).length);
  assert.deepEqual(counts, [24, 20, 20, 20, 20, 20]);
  assert.equal(new Set(LEVELS.map((l) => l.map.join('/'))).size, LEVELS.length, 'duplicate boards');
  // chapters are contiguous so the level numbers read in order
  LEVELS.forEach((l, i) => i && assert.ok(l.chapter >= LEVELS[i - 1].chapter));
});

test('difficulty increases: tutorial < chapter 1 core < later chapters < finale', () => {
  const avg = (arr) => arr.reduce((s, l) => s + l.par, 0) / arr.length;
  const chapter = (c) => LEVELS.filter((l) => l.chapter === c);
  assert.ok(avg(LEVELS.slice(0, 4)) < avg(LEVELS.slice(4, 12)));
  assert.ok(avg(chapter(2)) < avg(chapter(5)));
  assert.ok(avg(chapter(5)) < avg(chapter(6)));
  for (let c = 2; c <= 6; c++) {
    const ch = chapter(c);
    // within a chapter, the second half is at least as demanding as the first
    assert.ok(avg(ch.slice(0, 10)) <= avg(ch.slice(10)), `chapter ${c} ramps up`);
  }
  assert.ok(chapter(6).slice(-5).every((l) => l.par >= 13), 'the finale should be substantial');
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
