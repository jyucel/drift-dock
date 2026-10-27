/**
 * Drift Dock — app shell: screens, progress, tutorial coach, hints and the
 * glue between the rules engine (engine.js) and the board view (board.js).
 */
import { parseLevel, Session, slide, blockAt } from './engine.js';
import { solve } from './solver.js';
import { LEVELS } from './levels.js';
import { Board, burst, confetti } from './board.js';
import * as audio from './audio.js';
import { loadProgress, saveProgress, resetProgress, recordWin, isUnlocked } from './storage.js';

const $ = (id) => document.getElementById(id);
const levels = LEVELS.map((def) => parseLevel(def));
let progress = loadProgress();
audio.setMuted(progress.muted);

const state = {
  index: 0,
  session: null,
  busy: false,
  combo: 0,
  deadEnd: false,
};

/* ------------------------------------------------------------------ screens */

const screens = ['title', 'levels', 'game'];
function show(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  if (name === 'levels') renderLevelGrid();
  if (name === 'title') renderTitle();
  if (name !== 'game') board.clearCoach();
  document.body.dataset.screen = name;
}

function openModal(id) {
  $(id).hidden = false;
  const btn = $(id).querySelector('.btn-primary, .btn');
  btn?.focus({ preventScroll: true });
}
function closeModal(id) {
  $(id).hidden = true;
}
const anyModalOpen = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);

function totalStars() {
  return Object.values(progress.stars).reduce((a, b) => a + b, 0);
}

function firstUnsolved() {
  const i = levels.findIndex((l) => progress.best[l.id] == null);
  return i < 0 ? levels.length - 1 : i;
}

function renderTitle() {
  const solved = Object.keys(progress.best).length;
  $('btn-play').textContent = solved === 0 ? 'Play' : solved >= levels.length ? 'Play again' : `Continue · ${firstUnsolved() + 1}`;
  $('title-stars').textContent = solved ? `★ ${totalStars()} / ${levels.length * 3}` : '';
}

const STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z"/></svg>';
const LOCK_SVG = '<svg class="lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';

function renderLevelGrid() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  const current = firstUnsolved();
  levels.forEach((lvl, i) => {
    const b = document.createElement('button');
    b.className = 'level-btn';
    b.dataset.index = i;
    const unlocked = isUnlocked(progress, levels, i);
    const stars = progress.stars[lvl.id] || 0;
    if (!unlocked) {
      b.disabled = true;
      b.innerHTML = LOCK_SVG;
      b.setAttribute('aria-label', `Level ${i + 1} locked`);
    } else {
      b.innerHTML = `<span>${i + 1}</span><span class="mini-stars">${[0, 1, 2]
        .map((k) => STAR_SVG.replace('<svg', `<svg class="${k < stars ? 'on' : ''}"`))
        .join('')}</span>`;
      b.setAttribute('aria-label', `Level ${i + 1}: ${lvl.name}${stars ? `, ${stars} stars` : ''}`);
      if (stars) b.classList.add('done');
      if (i === current && progress.best[lvl.id] == null) b.classList.add('current');
      if (lvl.intro) b.insertAdjacentHTML('beforeend', `<span class="tag">NEW</span>`);
      b.addEventListener('click', () => {
        audio.play('click');
        startLevel(i);
      });
    }
    grid.appendChild(b);
  });
  $('star-total').textContent = `★ ${totalStars()} / ${levels.length * 3}`;
}

/* --------------------------------------------------------------------- game */

const board = new Board($('board'), {
  onMove: (id, dir) => tryMove(id, dir),
  onSelect: (id) => {
    if (id != null) audio.play('select');
  },
  canMove: (id, dir) => slide(state.session.level, state.session.blocks, id, dir).ok,
  onInteract: () => audio.unlockAudio(),
});

const sounds = {
  slide: (dur) => audio.play('slide', { dur }),
  paint: () => audio.play('paint'),
  wrap: () => audio.play('wrap'),
};

function startLevel(i) {
  state.index = i;
  const level = levels[i];
  state.session = new Session(level);
  state.combo = 0;
  state.deadEnd = false;
  progress.last = level.id;
  saveProgress(progress);
  show('game');
  $('hud-num').textContent = i + 1;
  $('hud-name').textContent = level.name;
  board.load(level, state.session.blocks);
  updateHud();
  setTip(level.tip || defaultTip(), '');
  if (level.coach) requestAnimationFrame(updateCoach);
}

function defaultTip() {
  return `Dock every coloured block in <b>${levels[state.index].par}</b> moves for ★★★`;
}

function setTip(html, cls) {
  const tip = $('tip');
  tip.innerHTML = `<span>${html}</span>`;
  tip.className = `tip ${cls || ''}`;
}

function updateHud() {
  const s = state.session;
  $('hud-moves').textContent = s.moves;
  $('hud-par').textContent = s.level.par;
  $('btn-undo').disabled = s.history.length === 0;
  $('btn-restart').disabled = s.history.length === 0;
  $('btn-undo').classList.toggle('pulse', state.deadEnd);
  $('btn-restart').classList.toggle('pulse', state.deadEnd);
}

async function tryMove(id, dir) {
  if (state.busy || !state.session || state.session.won) return;
  const s = state.session;
  const res = s.move(id, dir);
  if (!res.ok) {
    board.shake(id, dir);
    audio.play('invalid');
    if (res.reason === 'endless-loop') setTip('That block would circle the portal forever — it needs something to stop it.', 'warn');
    return;
  }
  state.busy = true;
  board.busy = true;
  board.clearCoach();
  await board.animateMove(id, res, dir, sounds);
  if (res.exited) {
    audio.play('exit', { combo: state.combo++ });
  } else {
    audio.play('thud');
  }
  // the board view keeps its own block list; sync it with the session
  board.blocks = s.blocks;
  state.busy = false;
  board.busy = false;
  afterChange();
}

function afterChange() {
  const s = state.session;
  state.deadEnd = false;
  updateHud();
  if (s.won) {
    setTimeout(win, 260);
    return;
  }
  const level = s.level;
  if (level.coach) {
    updateCoach();
    return;
  }
  // Dead-end detection: let the player know when the puzzle can no longer be won.
  const snapshot = s.blocks;
  setTimeout(() => {
    if (state.session !== s || s.blocks !== snapshot) return;
    const r = solve(level, snapshot, 60000);
    if (!r.solvable && !r.capped) {
      state.deadEnd = true;
      setTip('No way out from here — <b>undo</b> or <b>restart</b>.', 'warn');
      updateHud();
    } else if (!$('tip').classList.contains('good')) {
      setTip(level.tip && s.moves === 0 ? level.tip : defaultTip(), '');
    }
  }, 30);
}

function updateCoach() {
  const s = state.session;
  const r = solve(s.level, s.blocks, 60000);
  if (!r.solvable) {
    state.deadEnd = true;
    updateHud();
    setTip('Oops — that block is stuck. Tap <b>Undo</b> to take the move back.', 'warn');
    return;
  }
  const m = r.moves[0];
  const b = blockAt(s.blocks, m.x, m.y);
  board.coach(b.id, m.dir);
  const steps = s.level.coachTips || [];
  setTip(steps[Math.min(s.moves, steps.length - 1)] || s.level.tip, '');
}

function undo() {
  if (state.busy || !state.session) return;
  if (!state.session.undo()) return;
  audio.play('undo');
  state.combo = Math.max(0, state.combo - 1);
  board.setBlocks(state.session.blocks);
  setTip(state.session.level.tip || defaultTip(), '');
  afterChange();
}

function restart() {
  if (state.busy || !state.session) return;
  if (state.session.history.length === 0) return;
  state.session.restart();
  state.combo = 0;
  audio.play('restart');
  board.setBlocks(state.session.blocks);
  setTip(state.session.level.tip || defaultTip(), '');
  afterChange();
}

function hint() {
  if (state.busy || !state.session || state.session.won) return;
  const s = state.session;
  const r = solve(s.level, s.blocks, 250000);
  if (!r.solvable) {
    state.deadEnd = !r.capped;
    updateHud();
    setTip(r.capped ? 'Hmm, too tangled to tell — try a restart.' : 'No way out from here — <b>undo</b> or <b>restart</b>.', 'warn');
    return;
  }
  const m = r.moves[0];
  const b = blockAt(s.blocks, m.x, m.y);
  board.coach(b.id, m.dir);
  audio.play('select');
  setTip(`Hint: slide the highlighted block <b>${m.dir}</b>. (${r.moves.length} move${r.moves.length > 1 ? 's' : ''} to go)`, 'good');
}

function win() {
  const s = state.session;
  const level = s.level;
  const { stars, newBest } = recordWin(progress, level.id, s.moves, level.par);
  saveProgress(progress);
  const last = state.index === levels.length - 1;
  const allDone = levels.every((l) => progress.best[l.id] != null);
  $('win-kicker').textContent = `Level ${state.index + 1} · ${level.name}`;
  $('win-title').textContent = last && allDone ? 'Harbour Master!' : ['Docked!', 'Nicely done!', 'Smooth sailing!', 'Perfect drift!'][stars];
  $('win-stats').innerHTML =
    `${s.moves} moves · par ${level.par}` +
    (newBest && s.moves > level.par ? '<br>New personal best!' : '') +
    (stars < 3 ? `<br><small>Reach par for ★★★</small>` : '') +
    (last && allDone ? `<br><b>All ${levels.length} docks cleared — ★ ${totalStars()} / ${levels.length * 3}</b>` : '');
  $('btn-next').textContent = last ? 'All levels' : 'Next level';
  const starEls = [...$('win-stars').children];
  starEls.forEach((el) => el.classList.remove('on'));
  openModal('modal-win');
  audio.play('win');
  confetti();
  starEls.forEach((el, k) => {
    if (k < stars) {
      setTimeout(() => {
        el.classList.add('on');
        audio.play('star', { n: k });
        const r = el.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, ['var(--accent)', '#fff'], 10, 60);
      }, 350 + k * 260);
    }
  });
}

/* ----------------------------------------------------------------- controls */

function updateSoundButtons() {
  const muted = audio.isMuted();
  document.querySelectorAll('[data-sound-toggle]').forEach((b) => {
    b.innerHTML = muted
      ? '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/></svg><span>Muted</span>'
      : '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg><span>Sound</span>';
    b.setAttribute('aria-pressed', String(!muted));
    b.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  });
}

function toggleSound() {
  progress.muted = !audio.isMuted();
  audio.setMuted(progress.muted);
  saveProgress(progress);
  updateSoundButtons();
  audio.play('click');
}

function bind() {
  document.addEventListener('pointerdown', () => audio.unlockAudio(), { once: true });
  $('btn-play').addEventListener('click', () => {
    audio.play('click');
    const solvedAll = levels.every((l) => progress.best[l.id] != null);
    startLevel(solvedAll ? 0 : firstUnsolved());
  });
  $('btn-levels').addEventListener('click', () => {
    audio.play('click');
    show('levels');
  });
  $('btn-howto').addEventListener('click', () => openModal('modal-help'));
  $('btn-help').addEventListener('click', () => openModal('modal-help'));
  $('btn-help-close').addEventListener('click', () => closeModal('modal-help'));
  document.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => {
      audio.play('click');
      show(b.dataset.nav);
    }),
  );
  document.querySelectorAll('[data-sound-toggle]').forEach((b) => b.addEventListener('click', toggleSound));
  $('btn-undo').addEventListener('click', undo);
  $('btn-restart').addEventListener('click', restart);
  $('btn-hint').addEventListener('click', hint);
  $('btn-next').addEventListener('click', () => {
    closeModal('modal-win');
    if (state.index + 1 < levels.length) startLevel(state.index + 1);
    else show('levels');
  });
  $('btn-replay').addEventListener('click', () => {
    closeModal('modal-win');
    startLevel(state.index);
  });
  $('btn-win-levels').addEventListener('click', () => {
    closeModal('modal-win');
    show('levels');
  });
  $('btn-reset').addEventListener('click', () => openModal('modal-confirm'));
  $('btn-confirm-no').addEventListener('click', () => closeModal('modal-confirm'));
  $('btn-confirm-yes').addEventListener('click', () => {
    resetProgress();
    const muted = progress.muted;
    progress = loadProgress();
    progress.muted = muted;
    saveProgress(progress);
    closeModal('modal-confirm');
    renderLevelGrid();
  });
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => {
      if (e.target === m && m.id !== 'modal-win') closeModal(m.id);
    }),
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = [...document.querySelectorAll('.modal')].find((m) => !m.hidden);
      if (open && open.id !== 'modal-win') closeModal(open.id);
      else if (!open && document.body.dataset.screen === 'game') show('levels');
      return;
    }
    if (anyModalOpen() || document.body.dataset.screen !== 'game' || !state.session) return;
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    const blocks = state.session.blocks;
    if (dirs[e.key]) {
      e.preventDefault();
      let id = board.selected;
      if (id == null && blocks.length) {
        id = blocks[0].id;
        board.select(id);
      }
      if (id != null) tryMove(id, dirs[e.key]);
    } else if (e.key === 'Tab' || e.key === ' ') {
      e.preventDefault();
      if (!blocks.length) return;
      const order = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
      const cur = order.findIndex((b) => b.id === board.selected);
      const step = e.shiftKey ? -1 : 1;
      const next = order[(cur + step + order.length) % order.length];
      board.select(next.id);
      audio.play('select');
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'u' || e.key === 'Backspace') {
      undo();
    } else if (e.key === 'r' || e.key === 'R') {
      restart();
    } else if (e.key === 'h' || e.key === 'H') {
      hint();
    }
  });
}

bind();
updateSoundButtons();
show('title');

// Small hook for automated browser tests (read-only views of game state).
window.__driftdock = {
  levels,
  get state() {
    return { index: state.index, moves: state.session?.moves, blocks: state.session?.blocks, won: state.session?.won, busy: state.busy };
  },
  startLevel,
};
