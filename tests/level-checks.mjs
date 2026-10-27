// Shared level verification, run per chapter (tests/levels-ch*.test.mjs) so
// the node test runner can verify chapters in parallel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { parseLevel, Session, isWon, blockAt } from '../src/engine.js';
import { analyze } from '../src/solver.js';
import { fastAnalyze, fastSolve } from '../src/fastsolver.js';

export function verifyChapter(chapter) {
  const defs = LEVELS.map((def, i) => [def, i]).filter(([def]) => def.chapter === chapter);
  test(`chapter ${chapter} has levels`, () => assert.ok(defs.length > 0));
  for (const [def, i] of defs) {
    test(`level ${i + 1} "${def.name}": valid, solvable, par optimal, solvers agree`, () => {
      const level = parseLevel(def);
      assert.ok(!isWon(level.blocks), 'level must not start already won');
      assert.ok(level.blocks.some((b) => b.color !== 'S'), 'level needs coloured blocks');

      // Exhaustive reference analysis of every reachable position: proves the
      // level is solvable and that no solution is shorter than par.
      const ref = analyze(level, 3_000_000);
      assert.ok(!ref.capped, 'state graph must be fully explored');
      assert.ok(ref.optimal > 0, 'level must be solvable');
      assert.equal(ref.optimal, def.par, 'stored par must equal the optimal solution length');

      // The fast solver (used for hints and the generator) must agree exactly.
      const fast = fastAnalyze(level, 3_000_000);
      assert.deepEqual(
        [fast.optimal, fast.states, fast.deadShare, fast.goodFirst],
        [ref.optimal, ref.states, ref.deadShare, ref.goodFirst],
        'fast and reference solvers disagree',
      );

      // Replay an optimal solution through the reference Session: every move
      // must be legal under the rules and the final move must win.
      const sol = fastSolve(level);
      assert.equal(sol.moves.length, def.par);
      const s = new Session(level);
      for (const [k, m] of sol.moves.entries()) {
        assert.ok(!s.won, `won early at move ${k}`);
        const b = blockAt(s.blocks, m.x, m.y);
        assert.ok(b, `move ${k}: no block at ${m.x},${m.y}`);
        assert.ok(s.move(b.id, m.dir).ok, `move ${k} is illegal`);
      }
      assert.ok(s.won, 'optimal solution must win');
      assert.equal(s.moves, def.par);
    });
  }
}
