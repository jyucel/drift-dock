# Drift Dock — Game Design

## 1. Three candidate concepts

### A. Ring Relay
Interlocking rings of marble slots. Tapping a ring rotates its marbles one slot; rings share slots where they cross, so rotating one ring moves marbles onto another. Goal: every marble on a slot of its colour.

### B. Drift Dock *(selected)*
Coloured blocks on an ice board. Swipe a block and it glides until something stops it — a pillar, another block, or the frame. Coloured **docks** (gates in the frame) remove blocks of their own colour; any other dock is solid. New elements are layered in over the levels: **paint pads** recolour a block as it glides over them, **stones** never leave but serve as movable stoppers, and **portals** wrap a block to the opposite edge of the board.

### C. Stack Shunt
A rail yard with sidings. Cars sit on tracks that form loops and dead ends; you shunt cars between sidings to assemble trains whose colour order matches a target pattern at the exit.

## 2. Evaluation (1 = weak, 5 = strong)

| Criterion            | A. Ring Relay | **B. Drift Dock** | C. Stack Shunt |
|----------------------|:---:|:---:|:---:|
| Originality          | 2 — close to classic ring permutation puzzles | **4** — glide + recolour + docking combo is distinctive | 4 |
| Fun & replayability  | 3 | **5** — short levels, star par chases, many "aha" moments | 3 |
| Ease of learning     | 4 | **5** — one gesture, one rule ("glide until stopped") | 2 — many rules about couplings |
| Depth                | 3 — tends toward memorised algorithms | **4** — ordering, using blocks as stoppers, colour planning | 4 |
| Mobile suitability   | 4 | **5** — swipe is the native mobile gesture | 3 — fiddly dragging |
| Technical feasibility| 4 | **5** — small discrete state, exact BFS solver | 3 — large state spaces |
| **Total**            | 20 | **28** | 19 |

**Decision: Drift Dock.** It takes the spatial "move blocks out of the board" feel of block-escape puzzles and the colour-sorting/loop feel of sorting games, but combines them in its own way: blocks have momentum (they can only stop against something), the exits are colour-filtered, and paint pads let the player *change* which exit a block belongs to. That makes the core question of every level — *"what will stop this block where I need it, and in which order must things leave?"* — easy to grasp and hard to master. Every state is small and discrete, so each level can be proven solvable and given an exact optimal par by a breadth-first solver.

## 3. Rules

1. Swipe a block (or tap it and pick an arrow) to slide it in that direction.
2. It glides cell by cell until the next cell is a pillar, another block, or solid frame.
3. Gliding over a **paint pad** changes the block's colour to the pad's colour.
4. Gliding into a **dock** of the block's colour removes the block. Docks of other colours are solid.
5. A **portal** pair carries the block from one edge to the opposite edge, still gliding. A block that would circle forever doesn't move.
6. **Stones** are grey; there are no grey docks, and paint does not stick to stone.
7. A move that doesn't move the block is not counted. **Win** when no coloured blocks remain.

Stars: ★★★ at par (the solver's optimal move count), ★★ within a small margin, ★ for any solution.

## 4. Progression

| Levels | Focus |
|---|---|
| 1–3 | Tutorial: gliding, turning corners, using blocks as stoppers and wrong-colour docks as walls (animated coach hand on 1–2) |
| 4 | Paint introduced (coached) |
| 5–8 | Core sliding puzzles, 2 colours |
| 9–12 | Paint puzzles, up to 3 colours |
| 13–16 | Stones introduced, then used as tools |
| 17–20 | Portals introduced and combined |
| 21–24 | Master levels mixing every mechanic, 6×6 and larger |
| 25–44 | **Harbour Lanes** — busier boards, up to three colours (par 8–11) |
| 45–64 | **Stone Quay** — every level needs a stone moved (par 9–14) |
| 65–84 | **Portal Bay** — every level needs a portal (par 11–15) |
| 85–104 | **Prism Docks** — four colours and paint in every solution (par 12–18) |
| 105–124 | **Deep Freeze** — everything at once (par 15–25) |

Players may leave up to two levels unsolved behind them, so one stubborn puzzle never blocks progress.

Levels 5–24 (except the handcrafted stone and portal introductions, 13 and 17) were produced by an offline generator (`tools/generate.mjs`) that builds random boards per tier, solves them exactly and keeps the ones that need long optimal solutions, contain many dead-end states and few correct first moves, and actually *use* the tier's featured mechanic. They were then curated and named by hand. Chapters 2–6 use the same generator with denser pillar layouts (tight boards make better puzzles than open ones) and a table-driven fast solver; `tools/select-levels.mjs` keeps the 20 best unique boards per chapter and orders them by difficulty. The automated test suite re-proves every level and its par on every run, and cross-checks the fast solver against the reference rules engine.

## 5. UX principles

- One gesture. Swipe anywhere on a block; tap-to-select with arrow handles for precision and mouse users; full keyboard support.
- Honest feedback: blocked moves shake and buzz without costing a move; the game tells you as soon as a position has become unwinnable and pulses Undo/Restart.
- Accessibility: every colour also has a unique symbol (● ▲ ◆ ★ ⬢), high-contrast blocks on a dark board, 48px+ touch targets, reduced-motion support, keyboard play.
- Short sessions: levels take 30 seconds to a few minutes, progress is saved automatically.

## 6. Identity

Night-harbour palette (indigo water, frosted ice), glossy "candy" blocks with little eyes that look where they're sliding, glowing gates with pulsing chevrons, swirling portals, and a synthesized sound kit (glide whoosh, thud, rising docking chimes, paint blip).

**Music.** A calm generative piece at 76 BPM in D major: soft detuned pads through a breathing low-pass filter, a sine bass, a plucked melody that random-walks a pentatonic scale while leaning toward the current chord's tones, occasional glassy bells and a whisper of shaker, all through a shared echo and a generated reverb. Four chord progressions rotate every eight bars and the melody alternates busy and sparse passages, so it stays fresh over long sessions. It ducks under the victory fanfare and pauses when the tab is hidden; music and effects have separate toggles. All graphics are CSS/SVG and all sounds are generated with the Web Audio API — no third-party assets.
