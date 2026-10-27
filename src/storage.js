/**
 * Progress persistence in localStorage. All access is guarded so the game
 * still works when storage is unavailable (private mode, blocked cookies).
 */
const KEY = 'driftdock.progress.v1';

const empty = () => ({ best: {}, stars: {}, muted: false, music: true, last: null, seenHelp: false });

export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw);
    return { ...empty(), ...data, best: { ...data.best }, stars: { ...data.stars } };
  } catch {
    return empty();
  }
}

export function saveProgress(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function resetProgress() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Star rating for a finished level: 3 at par, 2 within a small margin. */
export function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + Math.max(2, Math.ceil(par * 0.3))) return 2;
  return 1;
}

/** Record a win; returns { stars, newBest }. */
export function recordWin(p, levelId, moves, par) {
  const stars = starsFor(moves, par);
  const prevBest = p.best[levelId];
  const newBest = prevBest == null || moves < prevBest;
  if (newBest) p.best[levelId] = moves;
  p.stars[levelId] = Math.max(p.stars[levelId] || 0, stars);
  return { stars, newBest };
}

/** How many unsolved levels a player may leave behind before the next one locks. */
export const SKIP_ALLOWANCE = 2;

/**
 * A level is unlocked when at most SKIP_ALLOWANCE earlier levels are still
 * unsolved, so one tough puzzle never blocks the whole game.
 */
export function isUnlocked(p, levels, index) {
  let unsolved = 0;
  for (let i = 0; i < index; i++) if (p.best[levels[i].id] == null) unsolved++;
  return unsolved <= SKIP_ALLOWANCE;
}
