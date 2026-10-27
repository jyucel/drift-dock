/**
 * Progress persistence in localStorage. All access is guarded so the game
 * still works when storage is unavailable (private mode, blocked cookies).
 */
const KEY = 'driftdock.progress.v1';

const empty = () => ({ best: {}, stars: {}, muted: false, last: null, seenHelp: false });

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

/** A level is unlocked when it is the first or its predecessor is solved. */
export function isUnlocked(p, levels, index) {
  if (index <= 0) return true;
  return p.best[levels[index - 1].id] != null;
}
