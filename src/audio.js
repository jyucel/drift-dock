/**
 * Tiny synthesized sound kit (Web Audio API). No audio files are needed, so the
 * game stays small and every sound is original.
 */
let ctx = null;
let master = null;
let muted = false;
let noiseBuf = null;
const readyListeners = [];

/** The shared AudioContext (null until the first user gesture creates it). */
export function getContext() {
  return ctx;
}

/** Run `fn(ctx)` as soon as audio is available (immediately if it already is). */
export function onAudioReady(fn) {
  if (ctx) fn(ctx);
  else readyListeners.push(fn);
}

function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  readyListeners.splice(0).forEach((fn) => fn(ctx));
  return ctx;
}

export function unlockAudio() {
  ensure();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
}

export function isMuted() {
  return muted;
}

function tone({ freq = 440, to = null, type = 'sine', dur = 0.2, vol = 0.3, delay = 0, attack = 0.005 }) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.3, vol = 0.2, f0 = 800, f1 = 2400, q = 1.2, delay = 0 }) {
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, t0);
  bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const SOUNDS = {
  select: () => tone({ freq: 880, to: 1100, type: 'triangle', dur: 0.07, vol: 0.12 }),
  slide: ({ dur = 0.3 } = {}) => noise({ dur: Math.max(0.15, dur), vol: 0.16, f0: 500, f1: 1800, q: 0.9 }),
  thud: () => {
    tone({ freq: 140, to: 60, type: 'sine', dur: 0.16, vol: 0.45 });
    noise({ dur: 0.06, vol: 0.12, f0: 300, f1: 200, q: 0.7 });
  },
  invalid: () => {
    tone({ freq: 160, type: 'square', dur: 0.07, vol: 0.06 });
    tone({ freq: 130, type: 'square', dur: 0.09, vol: 0.06, delay: 0.09 });
  },
  paint: () => tone({ freq: 420, to: 980, type: 'sine', dur: 0.14, vol: 0.22 }),
  wrap: () => noise({ dur: 0.22, vol: 0.18, f0: 2600, f1: 500, q: 2.5 }),
  exit: ({ combo = 0 } = {}) => {
    const base = 523.25 * Math.pow(2, (combo % 8) / 12 * 2);
    tone({ freq: base, type: 'triangle', dur: 0.25, vol: 0.22 });
    tone({ freq: base * 1.5, type: 'sine', dur: 0.35, vol: 0.16, delay: 0.07 });
    tone({ freq: base * 2, type: 'sine', dur: 0.4, vol: 0.08, delay: 0.12 });
  },
  undo: () => tone({ freq: 700, to: 380, type: 'triangle', dur: 0.12, vol: 0.14 }),
  restart: () => noise({ dur: 0.3, vol: 0.12, f0: 2000, f1: 400, q: 1 }),
  win: () => {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.45, vol: 0.2, delay: i * 0.09 }),
    );
  },
  star: ({ n = 0 } = {}) => tone({ freq: 880 * Math.pow(2, n * 4 / 12), type: 'sine', dur: 0.35, vol: 0.18 }),
  click: () => tone({ freq: 600, type: 'triangle', dur: 0.05, vol: 0.1 }),
};

export function play(name, opts) {
  if (muted) return;
  if (!ensure()) return;
  try {
    SOUNDS[name]?.(opts);
  } catch {
    /* audio is decorative; never break the game over it */
  }
}
