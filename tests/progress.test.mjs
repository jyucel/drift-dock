// Progress, scoring and unlock rules (localStorage is stubbed in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProgress, saveProgress, resetProgress, recordWin, isUnlocked, starsFor } from '../src/storage.js';
import { LEVELS } from '../src/levels.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

test('star thresholds', () => {
  assert.equal(starsFor(5, 5), 3);
  assert.equal(starsFor(4, 5), 3);
  assert.equal(starsFor(7, 5), 2);
  assert.equal(starsFor(8, 5), 1);
  assert.equal(starsFor(13, 10), 2);
  assert.equal(starsFor(14, 10), 1);
});

test('the first three levels start unlocked; at most two unsolved levels may be skipped', () => {
  resetProgress();
  const p = loadProgress();
  assert.ok(isUnlocked(p, LEVELS, 0));
  assert.ok(isUnlocked(p, LEVELS, 2));
  assert.ok(!isUnlocked(p, LEVELS, 3));
  recordWin(p, LEVELS[0].id, 1, 1);
  assert.ok(isUnlocked(p, LEVELS, 3));
  assert.ok(!isUnlocked(p, LEVELS, 4));
  // solving out of order also counts
  recordWin(p, LEVELS[2].id, 3, 3);
  assert.ok(isUnlocked(p, LEVELS, 4));
  assert.ok(!isUnlocked(p, LEVELS, 5));
  // solving everything unlocks everything
  for (const l of LEVELS) recordWin(p, l.id, l.par, l.par);
  assert.ok(LEVELS.every((_, i) => isUnlocked(p, LEVELS, i)));
});

test('best score and stars only improve, and persist across loads', () => {
  resetProgress();
  const p = loadProgress();
  let r = recordWin(p, 'x', 9, 6);
  assert.deepEqual(r, { stars: 1, newBest: true });
  r = recordWin(p, 'x', 6, 6);
  assert.deepEqual(r, { stars: 3, newBest: true });
  r = recordWin(p, 'x', 8, 6);
  assert.deepEqual(r, { stars: 2, newBest: false });
  assert.equal(p.best.x, 6);
  assert.equal(p.stars.x, 3);
  p.muted = true;
  saveProgress(p);
  const q = loadProgress();
  assert.equal(q.best.x, 6);
  assert.equal(q.stars.x, 3);
  assert.equal(q.muted, true);
});

test('corrupt or missing storage falls back to a fresh profile', () => {
  store.set('driftdock.progress.v1', '{not json');
  assert.deepEqual(loadProgress().best, {});
  const saved = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {},
  };
  assert.deepEqual(loadProgress().best, {});
  assert.doesNotThrow(() => saveProgress({ best: {} }));
  globalThis.localStorage = saved;
});
