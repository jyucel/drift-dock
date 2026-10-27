# Drift Dock

**Glide. Repaint. Dock.** A sliding colour puzzle for the browser — desktop and mobile, no install, no ads, no accounts.

▶ **Play:** https://jyucel.github.io/drift-dock/

Blocks sit on a sheet of ice. Swipe one and it glides until something stops it. Steer every coloured block into the gate of its own colour — but gates of other colours are solid walls, paint pads change a block's colour as it passes, heavy stones never leave, and portals throw blocks across the board. Each of the 24 levels is proven solvable, and its par is the true minimum number of moves.

## How to play

| | |
|---|---|
| **Move** | Swipe a block, or tap it and tap an arrow. Keyboard: <kbd>Tab</kbd> to pick a block, arrow keys to slide. |
| **Goal** | Dock every coloured block in a gate of the same colour. |
| **Glide** | Blocks only stop against pillars, other blocks or the frame. |
| **Paint pads** | Recolour any block that glides over them. |
| **Stones** | Grey, never dock — use them as stoppers. |
| **Portals** | Numbered pairs: leave through one, re-enter through its twin. |
| **Stars** | ★★★ for matching par, ★★ for close, ★ for any solution. |

<kbd>Z</kbd> undo · <kbd>R</kbd> restart · <kbd>H</kbd> hint. The game tells you as soon as a position can no longer be won.

## Features

- 24 levels in five tiers, with a coached interactive tutorial (animated hand) for the first moves and each new mechanic
- Mouse, touch and keyboard controls; tap-to-select arrows for precision
- Unlimited undo, restart, and a solver-powered hint button
- Dead-end detection with a gentle nudge to undo
- Smooth Web-Animations movement, squash on impact, particle bursts, confetti victory screen
- Synthesized sound effects (Web Audio — no audio files) with a persistent mute toggle
- Level select with stars; progress saved in `localStorage`
- Responsive layout for phones and desktops, safe-area aware
- Accessible: every colour also has a unique symbol, high contrast, large touch targets, `prefers-reduced-motion` support

## Run locally

Requires Node.js 20+ (only for the dev server and tests — the game itself is plain static files).

```bash
npm install          # installs Playwright for the browser tests
npm start            # http://localhost:8080/
```

Any static server works too, e.g. `python3 -m http.server`.

## Tests

```bash
npm test             # rules, solver, progress and level verification (node:test)
npx playwright install chromium
npm run test:e2e     # browser tests on desktop and mobile viewports
```

`npm test` proves **every** level solvable with an exhaustive breadth-first search, checks that the stored par equals the optimal solution, replays that solution move by move under the game rules, and checks win conditions, undo, restart, unlocking and saved progress.

The browser tests serve the site under `/drift-dock/` (like GitHub Pages) and drive the real UI: swipes (mouse and touch), tap-select arrows, keyboard, invalid moves, undo/restart, hints, dead-end warnings, saved progress across reloads, mute, layout fitting on every level, and a full playthrough of all 24 levels in order. Set `E2E_ALL_BROWSERS=1` to also run Firefox, desktop WebKit and mobile WebKit (iPhone) — CI does this on every push.

Add `?fast=1` to the URL to speed up animations (used by the tests).

## Project layout

```
index.html            app shell (screens and dialogs)
css/style.css         all styling and visual effects
src/engine.js         pure game rules: parsing, sliding, painting, portals, docking, undo
src/solver.js         breadth-first solver + state-graph analysis
src/levels.js         the 24 levels (generated from tools/levels.source.mjs)
src/board.js          board rendering, animation, pointer input
src/main.js           screens, tutorial coach, hints, progress
src/audio.js          synthesized sound effects
src/storage.js        localStorage progress, stars, unlocking
tools/generate.mjs    random level generator, scored by the solver
tools/build-levels.mjs  builds src/levels.js and computes par
tools/serve.mjs       tiny static server (supports a base subpath)
tools/build-site.mjs  copies the static site into _site/ for Pages
tests/                node:test unit tests and Playwright e2e tests
```

## Level design pipeline

1. `node tools/generate.mjs <tier> [seed] [seconds]` builds random boards for a tier (basic, paint, stone, wrap, master), solves each one exactly and keeps those with long optimal solutions, many dead-end states, few correct opening moves, and the tier's mechanic actually used in the solution.
2. Picks are curated and named in `tools/levels.source.mjs` next to the handcrafted tutorials.
3. `npm run levels` regenerates `src/levels.js` with solver-computed pars; `npm test` re-verifies everything.

Map legend — border: `#` wall, `R G B Y P` dock, `~` portal; interior: `.` ice, `#` pillar, `r g b y p` paint pad, `R G B Y P` block, `S` stone.

## Deployment

`.github/workflows/deploy.yml` runs unit and browser tests on every push and pull request, then publishes the static site to GitHub Pages on pushes to `main`. All asset paths are relative, so the game works from the repository subpath.

## License

MIT — see [LICENSE](LICENSE). All graphics (CSS/SVG) and sounds (Web Audio synthesis) are original to this project.
