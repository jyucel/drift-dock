// Rule-level tests for the Drift Dock engine. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, slide, Session, isWon, stateKey, blockAt } from '../src/engine.js';

const lvl = (map, extra = {}) => parseLevel({ id: 't', name: 't', par: 1, map, ...extra });

test('parses size, blocks, docks, portals and cells', () => {
  const l = lvl(['##R##', '~.S.~', '#rB##', '#####']);
  assert.equal(l.W, 3);
  assert.equal(l.H, 2);
  assert.deepEqual(l.blocks.map((b) => [b.color, b.x, b.y]), [['S', 1, 0], ['B', 1, 1]]);
  assert.deepEqual(l.border.get('1,-1'), { kind: 'dock', color: 'R' });
  assert.equal(l.border.get('-1,0').kind, 'wrap');
  assert.equal(l.cells[1 * 3 + 0].kind, 'paint');
  assert.equal(l.cells[1 * 3 + 2].kind, 'wall');
});

test('rejects malformed maps', () => {
  assert.throws(() => lvl(['####', '#..', '####']), /ragged/);
  assert.throws(() => lvl(['#####', '~...#', '#####']), /unpaired/);
  assert.throws(() => lvl(['R####', '#...#', '#####']), /corner/);
  assert.throws(() => lvl(['#####', '#.x.#', '#####']), /bad interior/);
});

test('a block glides until it hits the frame', () => {
  const l = lvl(['#######', '#R....#', '#######']);
  const r = slide(l, l.blocks, 0, 'right');
  assert.ok(r.ok);
  assert.deepEqual([r.blocks[0].x, r.blocks[0].y], [4, 0]);
  assert.equal(r.path.length, 5);
  assert.equal(r.exited, false);
});

test('a block stops against pillars and other blocks', () => {
  const l = lvl(['#######', '#R..#.#', '#G..B.#', '#######']);
  assert.equal(slide(l, l.blocks, 0, 'right').blocks[0].x, 2);
  const g = l.blocks.find((b) => b.color === 'G');
  assert.equal(slide(l, l.blocks, g.id, 'right').blocks.find((b) => b.id === g.id).x, 2);
});

test('moving into an adjacent obstacle is illegal and changes nothing', () => {
  const l = lvl(['#####', '#RG.#', '#####']);
  const r = slide(l, l.blocks, 0, 'right');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'blocked');
  assert.equal(slide(l, l.blocks, 0, 'up').ok, false);
});

test('a matching dock removes the block; a different dock is solid', () => {
  const l = lvl(['#####', '#R..R', '#B..R', '#####']);
  const r = slide(l, l.blocks, 0, 'right');
  assert.ok(r.exited);
  assert.equal(r.blocks.length, 1);
  assert.deepEqual(r.path.at(-1), { x: 3, y: 0, color: 'R', exit: true });
  const b = l.blocks.find((x) => x.color === 'B');
  const r2 = slide(l, l.blocks, b.id, 'right');
  assert.equal(r2.exited, false);
  assert.equal(r2.blocks.find((x) => x.id === b.id).x, 2);
});

test('paint pads recolour gliding blocks, which can then dock', () => {
  const l = lvl(['######', '#Bg..G', '######']);
  const r = slide(l, l.blocks, 0, 'right');
  assert.ok(r.painted);
  assert.ok(r.exited, 'repainted block should leave through the green dock');
  assert.ok(isWon(r.blocks));
});

test('stones are never painted and never dock', () => {
  const l = lvl(['######', '#Sr..R', '######']);
  const r = slide(l, l.blocks, 0, 'right');
  assert.equal(r.exited, false);
  assert.equal(r.blocks[0].color, 'S');
  assert.equal(r.blocks[0].x, 3);
});

test('portals wrap blocks to the opposite edge', () => {
  const l = lvl(['#######', '~.#.R.~', '#######']);
  const r = slide(l, l.blocks, 0, 'right');
  assert.ok(r.ok && r.wrapped);
  assert.deepEqual([r.blocks[0].x, r.blocks[0].y], [0, 0]);
  assert.ok(r.path.some((p) => p.wrap));
});

test('a block that would circle forever does not move', () => {
  const l = lvl(['#####', '~.R.~', '#####']);
  const r = slide(l, l.blocks, 0, 'left');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'endless-loop');
});

test('a portal exit blocked by another block stops the slider at the edge', () => {
  const l = lvl(['######', '~G.R.~', '######']);
  const r = slide(l, l.blocks, l.blocks.find((b) => b.color === 'R').id, 'right');
  assert.deepEqual([r.blocks.find((b) => b.color === 'R').x], [3]);
  assert.equal(r.wrapped, false);
});

test('win condition: only stones (or nothing) left', () => {
  assert.ok(isWon([]));
  assert.ok(isWon([{ id: 0, color: 'S', x: 0, y: 0 }]));
  assert.ok(!isWon([{ id: 0, color: 'R', x: 0, y: 0 }]));
});

test('state keys ignore block ids and order', () => {
  const a = [{ id: 0, color: 'R', x: 1, y: 2 }, { id: 1, color: 'R', x: 3, y: 0 }];
  const b = [{ id: 7, color: 'R', x: 3, y: 0 }, { id: 2, color: 'R', x: 1, y: 2 }];
  assert.equal(stateKey(a), stateKey(b));
});

test('session undo restores the previous state exactly, restart restores the start', () => {
  const l = lvl(['#######', '#R....R', '#..G..#', '###G###']);
  const s = new Session(l);
  const start = JSON.stringify(s.blocks);
  assert.equal(s.undo(), false, 'nothing to undo initially');
  const g = blockAt(s.blocks, 2, 1);
  s.move(g.id, 'left');
  const afterOne = JSON.stringify(s.blocks);
  s.move(0, 'right');
  assert.equal(s.moves, 2);
  assert.ok(s.undo());
  assert.equal(JSON.stringify(s.blocks), afterOne);
  assert.equal(s.moves, 1);
  assert.ok(s.undo());
  assert.equal(JSON.stringify(s.blocks), start);
  assert.equal(s.moves, 0);
  s.move(0, 'right');
  s.move(g.id, 'right');
  s.restart();
  assert.equal(JSON.stringify(s.blocks), start);
  assert.equal(s.moves, 0);
  assert.equal(s.history.length, 0);
});

test('illegal moves are not recorded in the session', () => {
  const l = lvl(['#####', '#RG.#', '#####']);
  const s = new Session(l);
  assert.equal(s.move(0, 'right').ok, false);
  assert.equal(s.moves, 0);
  assert.equal(s.history.length, 0);
});

test('slide never mutates its input', () => {
  const l = lvl(['######', '#Bg..G', '######']);
  const before = JSON.stringify(l.blocks);
  slide(l, l.blocks, 0, 'right');
  assert.equal(JSON.stringify(l.blocks), before);
});
