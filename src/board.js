/**
 * Board view: renders a level with DOM elements, animates moves with the Web
 * Animations API and turns pointer / keyboard input into move requests.
 * Game rules live in engine.js; this file only presents them.
 */
import { DIRS, STONE } from './engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One symbol per colour so colours are never the only cue (colour-blind friendly). */
export const SYMBOLS = {
  R: '<circle cx="12" cy="12" r="9"/>',
  G: '<path d="M12 2.5L22.5 20.5h-21z"/>',
  B: '<path d="M12 1.5l10.5 10.5L12 22.5 1.5 12z"/>',
  Y: '<path d="M12 1.8l3 6.5 7.1.8-5.3 4.8 1.5 7-6.3-3.6-6.3 3.6 1.5-7L1.9 9.1l7.1-.8z"/>',
  P: '<path d="M12 1.5l9.5 5.25v10.5L12 22.5l-9.5-5.25V6.75z"/>',
};

const ARROW = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  left: '<path d="M19 12H5M12 5l-7 7 7 7"/>',
  right: '<path d="M5 12h14M12 5l7 7-7 7"/>',
};

const HAND =
  '<svg viewBox="0 0 48 48"><path fill="#fff" stroke="#24154a" stroke-width="2.5" stroke-linejoin="round" d="M18 26V9a3.5 3.5 0 017 0v12l1-.2V17a3.5 3.5 0 017 0v5l.6-.1A3.4 3.4 0 0137 25v8c0 7-5 12-11.5 12S15 41 12.5 36L8 28.5a3.3 3.3 0 015.3-3.8z"/></svg>';

function svg(inner, cls) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  if (cls) el.setAttribute('class', cls);
  el.innerHTML = inner;
  return el;
}

function div(cls, parent) {
  const el = document.createElement('div');
  el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
}

/** cubic-bezier(x1,y1,x2,y2) helpers for time <-> progress mapping. */
function bezier(x1, y1, x2, y2) {
  const coord = (a, b, u) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  return {
    /** time fraction at which the eased progress reaches `p` */
    timeFor(p) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (coord(y1, y2, mid) < p) lo = mid;
        else hi = mid;
      }
      return coord(x1, x2, (lo + hi) / 2);
    },
  };
}
const GLIDE = bezier(0.35, 0.15, 0.45, 1);

export function speedFactor() {
  const q = new URLSearchParams(location.search);
  if (q.has('fast')) return 0.12;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0.55;
  return 1;
}

export class Board {
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers; // { onMove(id, dir), onSelect(id) }
    this.level = null;
    this.blockEls = new Map();
    this.selected = null;
    this.busy = false;
    this.speed = speedFactor();
    this.coachTimer = null;
    this.#bindInput();
    new ResizeObserver(() => this.layout()).observe(el.parentElement);
  }

  /* ---------------- rendering ---------------- */

  load(level, blocks) {
    this.level = level;
    this.selected = null;
    this.clearCoach();
    this.el.innerHTML = '';
    this.blockEls.clear();
    const { W, H } = level;
    div('frame', this.el);
    const ice = div('ice', this.el);
    ice.style.cssText = 'left:var(--c);top:var(--c);width:calc(var(--c)*' + W + ');height:calc(var(--c)*' + H + ')';

    // interior tiles
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cell = level.cells[y * W + x];
        if (cell.kind === 'floor') continue;
        const t = div('tile ' + (cell.kind === 'wall' ? 'pillar' : `paint c-${cell.color}`), this.el);
        this.#place(t, x, y);
        if (cell.kind === 'paint') {
          t.appendChild(svg(SYMBOLS[cell.color], 'sym'));
          t.title = 'Paint pad';
        }
      }
    }

    // border features
    this.portalEls = new Map();
    let portalId = 0;
    const portalNames = new Map();
    for (const [key, f] of level.border) {
      const [x, y] = key.split(',').map(Number);
      const side = x < 0 ? 'left' : x >= W ? 'right' : y < 0 ? 'top' : 'bottom';
      if (f.kind === 'dock') {
        const d = div(`dock side-${side} c-${f.color}`, this.el);
        div('gate', d);
        d.appendChild(svg(SYMBOLS[f.color], 'sym'));
        d.appendChild(svg('<path d="M9 6l6 6-6 6"/>', 'chev'));
        d.dataset.key = key;
        d.title = 'Dock';
        this.#place(d, x, y);
      } else {
        const pairKey = side === 'left' || side === 'right' ? `r${y}` : `c${x}`;
        if (!portalNames.has(pairKey)) portalNames.set(pairKey, ++portalId);
        const p = div(`portal side-${side}`, this.el);
        div('ring', p);
        const label = div('pid', p);
        label.textContent = String(portalNames.get(pairKey));
        p.title = 'Portal';
        this.portalEls.set(key, p);
        this.#place(p, x, y);
      }
    }
    this.setBlocks(blocks);
    this.layout();
  }

  /** Sync block elements to a block list without animation (undo/restart). */
  setBlocks(blocks) {
    this.blocks = blocks;
    const live = new Set(blocks.map((b) => b.id));
    for (const [id, el] of this.blockEls) {
      if (!live.has(id)) {
        el.remove();
        this.blockEls.delete(id);
      }
    }
    for (const b of blocks) {
      let el = this.blockEls.get(b.id);
      if (!el) {
        el = this.#makeBlock(b);
        this.blockEls.set(b.id, el);
      }
      el.getAnimations().forEach((a) => a.cancel());
      el.style.opacity = '';
      this.#setColor(el, b.color);
      this.#place(el, b.x, b.y, true);
    }
    this.select(this.selected != null && live.has(this.selected) ? this.selected : null);
  }

  #makeBlock(b) {
    const el = div('block', this.el);
    el.dataset.id = b.id;
    const body = div('body', el);
    const eyes = div('eyes', body);
    div('eye', eyes);
    div('eye', eyes);
    eyes.style.setProperty('--blink', `${(b.id * 1.7) % 5}s`);
    el.tabIndex = -1;
    return el;
  }

  #setColor(el, color) {
    el.className = el.className.replace(/\bc-[A-Z]\b/g, '').replace(/\bstone\b/g, '').trim();
    el.classList.add(`c-${color}`);
    if (color === STONE) el.classList.add('stone');
    const body = el.querySelector('.body');
    body.querySelector('.sym')?.remove();
    if (SYMBOLS[color]) body.appendChild(svg(SYMBOLS[color], 'sym'));
    el.setAttribute('aria-label', color === STONE ? 'stone' : `${colorName(color)} block`);
  }

  /** Position an element at interior coordinates (x,y); border cells use -1/W/H. */
  #place(el, x, y, transform = false) {
    if (transform) {
      el.dataset.x = x;
      el.dataset.y = y;
      el.style.transform = `translate(calc(var(--c) * ${x + 1}), calc(var(--c) * ${y + 1}))`;
    } else {
      el.style.left = `calc(var(--c) * ${x + 1})`;
      el.style.top = `calc(var(--c) * ${y + 1})`;
    }
  }

  layout() {
    if (!this.level) return;
    const wrap = this.el.parentElement;
    const cs = getComputedStyle(wrap);
    const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const cols = this.level.W + 2;
    const rows = this.level.H + 2;
    const c = Math.max(24, Math.floor(Math.min(availW / cols, availH / rows, 84)));
    this.cell = c;
    this.el.style.setProperty('--c', `${c}px`);
    this.el.style.width = `${c * cols}px`;
    this.el.style.height = `${c * rows}px`;
  }

  /* ---------------- selection & hints ---------------- */

  select(id) {
    this.selected = id;
    for (const [bid, el] of this.blockEls) el.classList.toggle('selected', bid === id);
    this.el.querySelectorAll('.handle').forEach((h) => h.remove());
    if (id == null) return;
    const b = this.blocks.find((o) => o.id === id);
    if (!b) return;
    for (const dir of Object.keys(DIRS)) {
      const [dx, dy] = DIRS[dir];
      const h = document.createElement('button');
      h.className = 'handle';
      h.dataset.dir = dir;
      h.setAttribute('aria-label', `Slide ${dir}`);
      const inner = document.createElement('span');
      inner.appendChild(svg(ARROW[dir]));
      h.appendChild(inner);
      this.#place(h, b.x + dx, b.y + dy);
      const legal = this.handlers.canMove?.(id, dir) ?? true;
      h.disabled = !legal;
      h.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onMove(id, dir);
      });
      this.el.appendChild(h);
    }
  }

  hint(blockId, on = true) {
    for (const [bid, el] of this.blockEls) el.classList.toggle('hinted', on && bid === blockId);
  }

  /** Looping animated hand showing a swipe of `blockId` in `dir`. */
  coach(blockId, dir) {
    this.clearCoach();
    const b = this.blocks.find((o) => o.id === blockId);
    if (!b) return;
    const [dx, dy] = DIRS[dir];
    const hand = div('coach', this.el);
    hand.innerHTML = HAND;
    const c = () => this.cell;
    const run = () => {
      if (!hand.isConnected) return;
      const x0 = (b.x + 1.35) * c();
      const y0 = (b.y + 1.45) * c();
      const dist = c() * 1.4;
      hand.animate(
        [
          { transform: `translate(${x0}px, ${y0}px) scale(1.15)`, opacity: 0 },
          { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1, offset: 0.2 },
          { transform: `translate(${x0 + dx * dist}px, ${y0 + dy * dist}px) scale(1)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${x0 + dx * dist}px, ${y0 + dy * dist}px) scale(1)`, opacity: 0 },
        ],
        { duration: 1500, easing: 'ease-in-out' },
      );
    };
    run();
    this.coachTimer = setInterval(run, 1900);
    this.hint(blockId, true);
  }

  clearCoach() {
    clearInterval(this.coachTimer);
    this.coachTimer = null;
    this.el.querySelectorAll('.coach').forEach((h) => h.remove());
    this.hint(null, false);
  }

  /* ---------------- animation ---------------- */

  /** Animate a successful slide result. Resolves when the motion has finished. */
  animateMove(blockId, res, dir, sounds) {
    const el = this.blockEls.get(blockId);
    const c = this.cell;
    const [dx, dy] = DIRS[dir];
    const pts = []; // { x, y, units, opacity, scale, color }
    let units = 0;
    res.path.forEach((p, i) => {
      if (i === 0) {
        pts.push({ x: p.x, y: p.y, u: 0, o: 1, s: 1, color: p.color });
        return;
      }
      const prev = res.path[i - 1];
      if (p.wrap) {
        pts.push({ x: prev.x + dx, y: prev.y + dy, u: (units += 1), o: 0, s: 0.4, color: prev.color, wrapOut: true });
        pts.push({ x: p.x - dx, y: p.y - dy, u: units + 0.0001, o: 0, s: 0.4, color: prev.color });
      }
      pts.push({ x: p.x, y: p.y, u: (units += 1), o: 1, s: 1, color: p.color, exit: p.exit });
    });
    const last = pts[pts.length - 1];
    if (last.exit) {
      pts.push({ x: last.x + dx * 0.6, y: last.y + dy * 0.6, u: (units += 0.6), o: 0, s: 0.3, color: last.color });
    }
    const duration = Math.min(950, Math.max(170, 90 + units * 72)) * this.speed;
    const frames = pts.map((p) => ({
      transform: `translate(${(p.x + 1) * c}px, ${(p.y + 1) * c}px) scale(${p.s})`,
      opacity: p.o,
      offset: GLIDE.timeFor(p.u / units),
    }));
    // offsets must be non-decreasing; bisection can wobble by tiny amounts
    for (let i = 1; i < frames.length; i++) frames[i].offset = Math.max(frames[i].offset, frames[i - 1].offset);
    frames[0].offset = 0;
    frames[frames.length - 1].offset = 1;

    this.select(null);
    el.style.zIndex = 5;
    const eyes = el.querySelector('.eyes');
    eyes.style.setProperty('--lx', `${dx * 18}%`);
    eyes.style.setProperty('--ly', `${dy * 18}%`);
    sounds?.slide(duration / 1000);

    // timed side effects: recolouring and portal flashes
    const timers = [];
    let color = pts[0].color;
    pts.forEach((p, i) => {
      const at = frames[i].offset * duration;
      if (p.color !== color) {
        color = p.color;
        const col = p.color;
        timers.push(setTimeout(() => {
          this.#setColor(el, col);
          sounds?.paint();
        }, at));
      }
      if (p.wrapOut) {
        timers.push(setTimeout(() => {
          sounds?.wrap();
          this.portalEls.forEach((pe) => {
            pe.classList.add('flash');
            setTimeout(() => pe.classList.remove('flash'), 500);
          });
        }, at));
      }
    });

    const anim = el.animate(frames, { duration, easing: 'linear', fill: 'forwards' });
    return anim.finished.then(() => {
      timers.forEach(clearTimeout);
      el.style.zIndex = '';
      eyes.style.setProperty('--lx', '0');
      eyes.style.setProperty('--ly', '0');
      if (last.exit) {
        el.remove();
        this.blockEls.delete(blockId);
        const dock = this.el.querySelector(`.dock[data-key="${last.x},${last.y}"]`);
        if (dock) {
          dock.classList.remove('flash');
          void dock.offsetWidth;
          dock.classList.add('flash');
        }
        this.burstAt(last.x, last.y, last.color);
      } else {
        this.#setColor(el, last.color);
        this.#place(el, last.x, last.y, true);
        anim.cancel();
        const squash = dx ? 'scale(0.84, 1.12)' : 'scale(1.12, 0.84)';
        el.querySelector('.body').animate(
          [{ transform: 'scale(1)' }, { transform: squash, offset: 0.35 }, { transform: 'scale(1)' }],
          { duration: 240 * Math.max(this.speed, 0.4), easing: 'ease-out' },
        );
      }
    });
  }

  shake(blockId, dir) {
    const el = this.blockEls.get(blockId);
    if (!el) return;
    const body = el.querySelector('.body');
    const [dx, dy] = DIRS[dir] || [1, 0];
    body.style.setProperty('--sx', `${dx * 5 || 0}px`);
    body.style.setProperty('--sy', `${dy * 5 || 0}px`);
    if (!dx && !dy) body.style.setProperty('--sx', '5px');
    body.classList.remove('shake');
    void body.offsetWidth;
    body.classList.add('shake');
  }

  /** Particle burst at board coordinates (used when a block docks). */
  burstAt(x, y, color) {
    const rect = this.el.getBoundingClientRect();
    const cx = rect.left + (x + 1.5) * this.cell;
    const cy = rect.top + (y + 1.5) * this.cell;
    burst(cx, cy, [`var(--c-${color})`, '#ffffff'], 18, this.cell * 1.6);
  }

  /* ---------------- input ---------------- */

  #bindInput() {
    let start = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.handle') || this.busy) return;
      const blockEl = e.target.closest('.block');
      const id = blockEl ? Number(blockEl.dataset.id) : null;
      start = { x: e.clientX, y: e.clientY, id, done: false, pointer: e.pointerId };
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events in some browsers */
      }
      this.handlers.onInteract?.();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!start || start.done || e.pointerId !== start.pointer) return;
      const ddx = e.clientX - start.x;
      const ddy = e.clientY - start.y;
      const threshold = Math.max(14, this.cell * 0.28);
      if (Math.hypot(ddx, ddy) < threshold) return;
      const dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : ddy > 0 ? 'down' : 'up';
      const id = start.id ?? this.selected;
      start.done = true;
      if (id != null) this.handlers.onMove(id, dir);
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.pointer) return;
      const s = start;
      start = null;
      if (s.done) return;
      if (s.id != null) {
        const id = s.id === this.selected ? null : s.id;
        this.select(id);
        this.handlers.onSelect?.(id);
        return;
      }
      // tap on empty ice in line with the selected block slides it that way
      if (this.selected != null && e.type === 'pointerup') {
        const b = this.blocks.find((o) => o.id === this.selected);
        const rect = this.el.getBoundingClientRect();
        const tx = Math.floor((e.clientX - rect.left) / this.cell) - 1;
        const ty = Math.floor((e.clientY - rect.top) / this.cell) - 1;
        if (b && tx === b.x && ty !== b.y) this.handlers.onMove(b.id, ty < b.y ? 'up' : 'down');
        else if (b && ty === b.y && tx !== b.x) this.handlers.onMove(b.id, tx < b.x ? 'left' : 'right');
        else this.select(null);
      }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}

export function colorName(c) {
  return { R: 'red', G: 'green', B: 'blue', Y: 'yellow', P: 'purple', S: 'stone' }[c] || c;
}

/** Spawn decorative particles in the fixed fx layer. */
export function burst(cx, cy, colors, count = 16, spread = 90) {
  const layer = document.getElementById('fx-top');
  if (!layer) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.background = colors[i % colors.length];
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    layer.appendChild(p);
    const a = Math.random() * Math.PI * 2;
    const r = spread * (0.4 + Math.random() * 0.8);
    p.animate(
      [
        { transform: 'translate(-50%,-50%) scale(1) rotate(0)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(0.2) rotate(${Math.random() * 540}deg)`, opacity: 0 },
      ],
      { duration: 600 + Math.random() * 400, easing: 'cubic-bezier(.1,.8,.3,1)' },
    ).finished.then(() => p.remove());
  }
}

/** Full-screen confetti for the victory screen. */
export function confetti() {
  const layer = document.getElementById('fx-layer');
  if (!layer) return;
  const colors = ['var(--c-R)', 'var(--c-G)', 'var(--c-B)', 'var(--c-Y)', 'var(--c-P)', '#fff'];
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.background = colors[i % colors.length];
    p.style.left = `${Math.random() * w}px`;
    p.style.top = '-20px';
    p.style.width = `${6 + Math.random() * 8}px`;
    p.style.height = `${8 + Math.random() * 10}px`;
    layer.appendChild(p);
    const drift = (Math.random() - 0.5) * 200;
    p.animate(
      [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${drift}px, ${h + 40}px) rotate(${720 * Math.random() + 180}deg)`, opacity: 0.9 },
      ],
      { duration: 1800 + Math.random() * 1600, delay: Math.random() * 500, easing: 'cubic-bezier(.25,.4,.5,1)' },
    ).finished.then(() => p.remove());
  }
}

