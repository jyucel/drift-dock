/**
 * Generative background music, synthesized live with the Web Audio API.
 *
 * A calm "night harbour" piece at 76 BPM: warm pad chords, a soft bass, a
 * plucked melody that improvises on a D-major pentatonic scale over the chord
 * tones, the odd glassy bell and a whisper of shaker, all through a shared
 * echo and reverb. Progressions rotate every eight bars and the melody
 * breathes between busy and sparse passages, so it never loops exactly.
 */
import { onAudioReady } from './audio.js';

const BPM = 76;
const STEP = 60 / BPM / 2; // one eighth note
const LEVEL = 0.5;

// Each progression: four chords of two bars. [bass, ...pad voices] as MIDI notes.
const PROGRESSIONS = [
  [[50, 54, 57, 61, 64], [47, 54, 57, 61, 62], [43, 55, 59, 62, 66], [45, 57, 62, 64, 66]],
  [[40, 55, 59, 62, 66], [43, 54, 59, 62, 67], [42, 54, 57, 61, 64], [45, 57, 59, 64, 69]],
  [[47, 54, 57, 62, 66], [43, 57, 59, 62, 66], [50, 54, 57, 61, 64], [45, 57, 61, 64, 66]],
  [[43, 55, 59, 62, 66], [45, 57, 61, 64, 69], [47, 54, 57, 62, 66], [42, 54, 57, 61, 66]],
];
const SCALE = [69, 71, 74, 76, 78, 81, 83, 86, 88]; // D major pentatonic (A4 .. E6)
const RHYTHMS = [
  [1, 0, 1, 0, 1, 1, 0, 1],
  [1, 0, 0, 1, 0, 0, 1, 0],
  [0, 1, 0, 1, 1, 0, 1, 0],
  [1, 0, 0, 0, 1, 0, 1, 1],
  [1, 1, 0, 1, 0, 0, 1, 0],
];

const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

let ctx = null;
let bus = null; // music output gain
let dry = null; // node everything plays into
let padFilter = null;
let enabled = true;
let playing = false;
let timer = null;
let nextTime = 0;
let step = 0;
let prog = 0;
let melodyIdx = 4;
let dense = true;

function build(c) {
  ctx = c;
  bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(ctx.destination);

  // reverb: convolver with a generated, gently decaying stereo impulse
  const len = Math.floor(ctx.sampleRate * 2.8);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const reverb = ctx.createConvolver();
  reverb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  reverb.connect(wet).connect(bus);

  // echo: three eighths, darkened feedback loop
  const delay = ctx.createDelay(2);
  delay.delayTime.value = STEP * 3;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  delay.connect(tone).connect(fb).connect(delay);
  const echo = ctx.createGain();
  echo.gain.value = 0.22;
  tone.connect(echo).connect(bus);
  echo.connect(reverb);

  dry = ctx.createGain();
  dry.connect(bus);
  dry.connect(reverb);
  dry.echo = delay;

  // pad filter with a slow breathing LFO on the cutoff
  padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 900;
  padFilter.Q.value = 0.6;
  const lfo = ctx.createOscillator();
  const lfoAmt = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoAmt.gain.value = 350;
  lfo.connect(lfoAmt).connect(padFilter.frequency);
  lfo.start();
  padFilter.connect(dry);
}

function env(g, t, attack, hold, release, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return t + attack + hold + release + 0.05;
}

function pad(notes, t, dur) {
  for (const m of notes) {
    for (const [type, detune, vol] of [['triangle', -7, 0.035], ['sine', 6, 0.03]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq(m);
      o.detune.value = detune;
      const end = env(g, t, 1.4, Math.max(0.1, dur - 1.4), 2.2, vol);
      o.connect(g).connect(padFilter);
      o.start(t);
      o.stop(end);
    }
  }
}

function bass(m, t, len) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq(m);
  const end = env(g, t, 0.04, len * 0.4, len * 0.8, 0.16);
  o.connect(g).connect(dry);
  o.start(t);
  o.stop(end);
}

function pluck(m, t, vol = 0.06) {
  for (const [mult, type, v, decay] of [[1, 'triangle', vol, 0.9], [2, 'sine', vol * 0.25, 0.4]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq(m) * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g);
    g.connect(dry);
    g.connect(dry.echo);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

function bell(m, t) {
  for (const [ratio, v] of [[1, 0.022], [2.76, 0.008], [5.4, 0.004]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq(m) * ratio;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    o.connect(g).connect(dry);
    g.connect(dry.echo);
    o.start(t);
    o.stop(t + 3.1);
  }
}

let noise = null;
function shaker(t, vol) {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(hp).connect(g).connect(dry);
  src.start(t);
  src.stop(t + 0.1);
}

/** Pick the next melody note: a small random walk that leans toward chord tones. */
function nextNote(chord, strong) {
  const pcs = new Set(chord.slice(1).map((m) => m % 12));
  const options = [];
  for (let d = -2; d <= 2; d++) {
    const i = melodyIdx + d;
    if (i < 0 || i >= SCALE.length) continue;
    const w = (pcs.has(SCALE[i] % 12) ? (strong ? 4 : 2) : 1) * (d === 0 ? 0.5 : 1);
    options.push([i, w]);
  }
  let r = Math.random() * options.reduce((s, o) => s + o[1], 0);
  for (const [i, w] of options) {
    if ((r -= w) <= 0) {
      melodyIdx = i;
      break;
    }
  }
  return SCALE[melodyIdx];
}

let rhythm = RHYTHMS[0];
function scheduleStep(n, t) {
  const bar = Math.floor(n / 8);
  const s = n % 8;
  if (bar % 8 === 0 && s === 0 && n > 0) {
    let p;
    do p = Math.floor(Math.random() * PROGRESSIONS.length);
    while (p === prog);
    prog = p;
    dense = !dense;
  }
  const chord = PROGRESSIONS[prog][Math.floor(bar / 2) % 4];
  if (s === 0) rhythm = RHYTHMS[Math.floor(Math.random() * RHYTHMS.length)];
  if (bar % 2 === 0 && s === 0) pad(chord.slice(1), t, STEP * 16);
  if (s === 0) bass(chord[0], t, STEP * 5);
  if (s === 5 && Math.random() < 0.6) bass(chord[0] + (Math.random() < 0.5 ? 12 : 7), t, STEP * 2.5);
  // melody waits for the first chord to bloom, then alternates busy / sparse passages
  if (n >= 16 && rhythm[s] && Math.random() < (dense ? 0.85 : 0.4)) {
    pluck(nextNote(chord, s % 4 === 0), t, s % 2 === 0 ? 0.06 : 0.045);
  }
  if (s === 0 && bar % 2 === 1 && Math.random() < 0.35) bell(SCALE[Math.floor(Math.random() * SCALE.length)] + 12, t + STEP);
  if (n >= 32 && (s === 2 || s === 6)) shaker(t, s === 6 ? 0.018 : 0.011);
}

function tick() {
  while (nextTime < ctx.currentTime + 0.3) {
    scheduleStep(step, nextTime);
    nextTime += STEP;
    step++;
  }
}

function start() {
  if (!ctx || playing || !enabled || document.hidden) return;
  playing = true;
  nextTime = ctx.currentTime + 0.1;
  timer = setInterval(tick, 60);
  tick();
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.8);
}

function stop() {
  if (!ctx || !playing) return;
  playing = false;
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  const t = timer;
  setTimeout(() => clearInterval(t), 1200);
  // a fresh start later continues the piece from a new section
  step = 0;
}

/** Call once at startup; music begins once audio is unlocked by a user gesture. */
export function initMusic(on) {
  enabled = on;
  onAudioReady((c) => {
    build(c);
    start();
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
}

export function setMusicEnabled(on) {
  enabled = on;
  if (on) start();
  else stop();
}

export function isMusicPlaying() {
  return playing;
}

export function isMusicEnabled() {
  return enabled;
}

/** Briefly lower the music so a jingle (e.g. the victory fanfare) stands out. */
export function duckMusic(seconds = 2.5) {
  if (!ctx || !playing) return;
  const now = ctx.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setTargetAtTime(LEVEL * 0.25, now, 0.08);
  bus.gain.setTargetAtTime(LEVEL, now + seconds, 0.8);
}

/**
 * Render the first `seconds` of music into an OfflineAudioContext (used by the
 * browser tests to check levels and clipping without real-time playback).
 */
export async function renderOffline(seconds = 20, sampleRate = 22050) {
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  build(off);
  bus.gain.value = LEVEL;
  step = 0;
  for (let t = 0.05; t < seconds; t += STEP) scheduleStep(step++, t);
  const buf = await off.startRendering();
  ctx = null; // the live context is rebuilt on the next real start
  return buf;
}
