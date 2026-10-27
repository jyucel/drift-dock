/**
 * Drift Dock — pure game rules.
 *
 * This module has no DOM dependencies so it can be shared by the browser UI,
 * the solver, the level generator and the automated tests.
 *
 * Level map format (one string per row, including a one-cell border ring):
 *
 *   Border cells         Interior cells
 *   #   wall              .   ice floor
 *   R G B Y P  dock       #   pillar (wall)
 *   ~   wrap portal       r g b y p  paint pad
 *                         R G B Y P  coloured block (on ice)
 *                         S          stone block (never leaves)
 *
 * A wrap portal must have a partner '~' at the opposite end of its row/column.
 */

export const COLORS = ['R', 'G', 'B', 'Y', 'P'];
export const STONE = 'S';

export const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const DIR_NAMES = Object.keys(DIRS);

/** Parse a level definition ({ map: string[] , ...meta }) into a level object. */
export function parseLevel(def) {
  const rows = def.map;
  const H = rows.length - 2;
  const W = rows[0].length - 2;
  if (W < 1 || H < 1) throw new Error(`Level ${def.id}: map too small`);
  for (const r of rows) {
    if (r.length !== W + 2) throw new Error(`Level ${def.id}: ragged map row "${r}"`);
  }
  const cells = []; // interior: { kind: 'floor'|'wall'|'paint', color? }
  const blocks = [];
  const border = new Map(); // "x,y" (interior coords, may be -1 or W/H) -> { kind, color? }
  let nextId = 0;

  for (let y = -1; y <= H; y++) {
    for (let x = -1; x <= W; x++) {
      const ch = rows[y + 1][x + 1];
      const isBorder = x < 0 || y < 0 || x >= W || y >= H;
      if (isBorder) {
        if (ch === '#') continue;
        const corner = (x < 0 || x >= W) && (y < 0 || y >= H);
        if (corner) throw new Error(`Level ${def.id}: corner must be '#'`);
        if (ch === '~') border.set(`${x},${y}`, { kind: 'wrap' });
        else if (COLORS.includes(ch)) border.set(`${x},${y}`, { kind: 'dock', color: ch });
        else throw new Error(`Level ${def.id}: bad border char '${ch}'`);
        continue;
      }
      let cell = { kind: 'floor' };
      if (ch === '#') cell = { kind: 'wall' };
      else if (COLORS.includes(ch.toUpperCase()) && ch === ch.toLowerCase()) {
        cell = { kind: 'paint', color: ch.toUpperCase() };
      } else if (COLORS.includes(ch) || ch === STONE) {
        blocks.push({ id: nextId++, color: ch, x, y });
      } else if (ch !== '.') {
        throw new Error(`Level ${def.id}: bad interior char '${ch}'`);
      }
      cells.push(cell);
    }
  }

  // Validate wrap portals come in opposite pairs.
  for (const [k, v] of border) {
    if (v.kind !== 'wrap') continue;
    const [x, y] = k.split(',').map(Number);
    const partner = oppositeBorder(W, H, x, y);
    const p = border.get(`${partner[0]},${partner[1]}`);
    if (!p || p.kind !== 'wrap') throw new Error(`Level ${def.id}: unpaired wrap portal at ${k}`);
  }

  return { ...def, W, H, cells, border, blocks };
}

function oppositeBorder(W, H, x, y) {
  if (x < 0) return [W, y];
  if (x >= W) return [-1, y];
  if (y < 0) return [x, H];
  return [x, -1];
}

export function cellAt(level, x, y) {
  if (x < 0 || y < 0 || x >= level.W || y >= level.H) return null;
  return level.cells[y * level.W + x];
}

export function borderAt(level, x, y) {
  return level.border.get(`${x},${y}`) || null;
}

export function cloneBlocks(blocks) {
  return blocks.map((b) => ({ ...b }));
}

export function isWon(blocks) {
  return blocks.every((b) => b.color === STONE);
}

export function blockAt(blocks, x, y) {
  return blocks.find((b) => b.x === x && b.y === y) || null;
}

/**
 * Slide one block in a direction. Blocks glide over ice until they hit a
 * pillar, another block or a solid border. Passing over a paint pad recolours
 * a coloured block. Reaching a dock of the block's own colour removes the
 * block; any other dock behaves like a wall. Wrap portals carry the block to
 * the opposite edge of the board.
 *
 * Returns { ok:false, reason } for an illegal move, or
 * { ok:true, blocks, path, exited, painted, wrapped } where `path` is a list of
 * steps { x, y, color, wrap?, exit? } starting at the block's origin.
 */
export function slide(level, blocks, blockId, dir) {
  const d = DIRS[dir];
  if (!d) return { ok: false, reason: 'bad-direction' };
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return { ok: false, reason: 'no-block' };
  const b = blocks[idx];
  const [dx, dy] = d;
  const { W, H } = level;
  const occupied = new Set();
  for (const o of blocks) if (o.id !== blockId) occupied.add(o.y * W + o.x);

  let x = b.x;
  let y = b.y;
  let color = b.color;
  const path = [{ x, y, color }];
  const seen = new Set([`${x},${y},${color}`]);
  let painted = false;
  let wrapped = false;

  for (;;) {
    let nx = x + dx;
    let ny = y + dy;
    let wrap = false;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
      const edge = borderAt(level, nx, ny);
      if (edge && edge.kind === 'dock' && edge.color === color) {
        path.push({ x: nx, y: ny, color, exit: true });
        const next = blocks.filter((o) => o.id !== blockId);
        return { ok: true, blocks: next, path, exited: true, painted, wrapped };
      }
      if (!edge || edge.kind !== 'wrap') break;
      if (nx < 0) nx = W - 1;
      else if (nx >= W) nx = 0;
      if (ny < 0) ny = H - 1;
      else if (ny >= H) ny = 0;
      wrap = true;
    }
    const cell = cellAt(level, nx, ny);
    if (cell.kind === 'wall' || occupied.has(ny * W + nx)) break;
    x = nx;
    y = ny;
    if (cell.kind === 'paint' && color !== STONE && color !== cell.color) {
      color = cell.color;
      painted = true;
    }
    if (wrap) wrapped = true;
    const key = `${x},${y},${color}`;
    if (seen.has(key)) return { ok: false, reason: 'endless-loop' };
    seen.add(key);
    path.push(wrap ? { x, y, color, wrap: true } : { x, y, color });
  }

  if (path.length === 1) return { ok: false, reason: 'blocked' };
  const next = cloneBlocks(blocks);
  next[idx] = { ...b, x, y, color };
  return { ok: true, blocks: next, path, exited: false, painted, wrapped };
}

/**
 * Canonical string key of a block configuration. Blocks of the same colour are
 * interchangeable, so ids are ignored.
 */
const COLOR_CODE = { R: 1, G: 2, B: 3, Y: 4, P: 5, S: 6 };
export function stateKey(blocks) {
  // one UTF-16 code unit per block: colour | y | x (boards are at most 16x16)
  const codes = blocks.map((b) => (COLOR_CODE[b.color] << 8) | (b.y << 4) | b.x);
  codes.sort((p, q) => p - q);
  return String.fromCharCode(...codes);
}

/**
 * Small game-session helper with undo / restart, shared by UI and tests.
 */
export class Session {
  constructor(level) {
    this.level = level;
    this.restart();
  }

  restart() {
    this.blocks = cloneBlocks(this.level.blocks);
    this.moves = 0;
    this.history = [];
  }

  /** Attempt a move; returns the slide result. */
  move(blockId, dir) {
    const res = slide(this.level, this.blocks, blockId, dir);
    if (!res.ok) return res;
    this.history.push({ blocks: this.blocks, moves: this.moves });
    this.blocks = res.blocks;
    this.moves += 1;
    return res;
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.blocks = prev.blocks;
    this.moves = prev.moves;
    return true;
  }

  get won() {
    return isWon(this.blocks);
  }
}
