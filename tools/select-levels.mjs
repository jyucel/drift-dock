#!/usr/bin/env node
/**
 * Pick levels for chapters 2-6 from generator output (tools/out/<tier>-*.json)
 * and write tools/levels.extra.json, which tools/levels.source.mjs appends to
 * the handcrafted first chapter.
 *
 * For each chapter it takes the highest-scoring unique boards, then orders
 * them by difficulty so every chapter ramps up. Usage: node tools/select-levels.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseLevel } from '../src/engine.js';
import { fastAnalyze } from '../src/fastsolver.js';

const PER_CHAPTER = 20;
const NAMES = {
  c2: ['Morning Tide', 'Rope Walk', 'Gull Point', 'Low Water', 'Lantern Post', 'Slipway', 'Net Loft', 'Ferry Line', 'Pier Pressure', 'Buoy Bell',
    'Fog Bank', 'Mooring', 'Quay Shuffle', 'Tug of War', 'Cargo Swap', 'Crab Pots', 'Sea Wall', 'High Tide', 'Dockhand', 'Harbour Lights'],
  c3: ['Cobblestones', 'Ballast', 'Millstone', 'Cairn', 'Gravel Run', 'Keystone', 'Bedrock', 'Flint', 'Granite Steps', 'Pebble Path',
    'Rock Pool', 'Slate Roof', 'Monolith', 'Stepping Stones', 'Cornerstone', 'Basalt', 'Whetstone', 'Dry Stone Wall', 'Rubble', 'Stone Circle'],
  c4: ['Wormhole', 'Looking Glass', 'Far Shore', 'Echo Chamber', 'Round Trip', 'Rabbit Hole', 'Side Door', 'Mirror Lake', 'Overpass', 'Shortcut',
    'Undertow', 'Revolving Door', 'Warp Lane', 'Riptide', 'Boomerang', 'Back Channel', 'Ring Road', 'Crosswind', 'Leapfrog', 'Vanishing Point'],
  c5: ['Spectrum', 'Prism', 'Kaleidoscope', 'Watercolour', 'Stained Glass', 'Pigment', 'Colour Wheel', 'Rainbow Pier', 'Tint', 'Hue Shift',
    'Swatch', 'Dye Lot', 'Gradient', 'Chroma', 'Palette Knife', 'Brushstroke', 'Pastel', 'Primary', 'Mosaic', 'Neon Harbour'],
  c6: ['Permafrost', 'Glacier', 'Black Ice', 'Snowblind', 'Frostbite', 'Icebreaker', 'Polar Night', 'Whiteout', 'Hailstorm', 'Avalanche',
    'Cold Snap', 'Rime', 'Floe', 'Tundra', 'Blizzard', 'Aurora', 'Crevasse', 'Frozen Sound', 'Iceberg', 'Absolute Zero'],
};
const TIERS = ['c2', 'c3', 'c4', 'c5', 'c6'];

const { SOURCE } = await import('./levels.source.mjs');
const taken = new Set(SOURCE.filter((l) => (l.chapter ?? 1) === 1).map((l) => l.map.join('/')));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const out = [];
TIERS.forEach((tier, c) => {
  const files = readdirSync(new URL('./out/', import.meta.url)).filter((f) => f.startsWith(`${tier}-`) && f.endsWith('.json'));
  const pool = files.flatMap((f) => JSON.parse(readFileSync(new URL(`./out/${f}`, import.meta.url))));
  pool.sort((a, b) => b.score - a.score);
  const picks = [];
  for (const cand of pool) {
    const key = cand.map.join('/');
    if (taken.has(key)) continue;
    taken.add(key);
    picks.push(cand);
    if (picks.length === PER_CHAPTER) break;
  }
  if (picks.length < PER_CHAPTER) throw new Error(`${tier}: only ${picks.length} unique candidates`);
  // re-measure with the fast solver (deterministic) and order by difficulty
  for (const p of picks) p.a = fastAnalyze(parseLevel({ id: 'x', map: p.map }), 1_000_000);
  picks.sort((p, q) => p.a.optimal + p.a.deadShare * 4 - (q.a.optimal + q.a.deadShare * 4));
  picks.forEach((p, i) => {
    const name = NAMES[tier][i];
    out.push({ id: slug(name), name, chapter: c + 2, map: p.map });
  });
  const pars = picks.map((p) => p.a.optimal);
  console.log(`${tier}: pool ${pool.length}, pars ${pars.join(' ')}`);
});
writeFileSync(new URL('./levels.extra.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`wrote ${out.length} levels to tools/levels.extra.json`);
