// End-to-end tests driving the real game UI in a browser.
import { test, expect } from '@playwright/test';

const idle = (page) => page.waitForFunction(() => window.__driftdock && !window.__driftdock.state.busy);
const block = (page, x, y) => page.locator(`.block[data-x="${x}"][data-y="${y}"]`);
const gameState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__driftdock.state)));

async function swipe(page, locator, dir) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + d[0] * 70, y + d[1] * 70, { steps: 6 });
  await page.mouse.up();
  await idle(page);
}

async function tapMove(page, x, y, dir) {
  await block(page, x, y).click();
  await page.locator(`.handle[data-dir="${dir}"]`).click();
  await idle(page);
}

// Same real mouse taps, minus Playwright's per-click actionability polling;
// used by the long playthroughs to keep them fast.
async function quickTapMove(page, x, y, dir) {
  const center = async (loc) => {
    const b = await loc.boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  await page.mouse.click(...(await center(block(page, x, y))));
  await page.mouse.click(...(await center(page.locator(`.handle[data-dir="${dir}"]`))));
  await idle(page);
}

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
});
test.afterEach(() => {
  expect(errors, 'no console errors').toEqual([]);
});

test('title screen loads all assets from the subpath', async ({ page }) => {
  const failed = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  await page.goto('./');
  await expect(page.locator('h1.title')).toHaveText(/Drift\s*Dock/);
  await expect(page.locator('#btn-play')).toBeVisible();
  expect(failed).toEqual([]);
});

test('how-to-play modal opens and closes', async ({ page }) => {
  await page.goto('./');
  await page.click('#btn-howto');
  await expect(page.locator('#modal-help')).toBeVisible();
  await expect(page.locator('.rules li')).toHaveCount(5);
  await page.click('#btn-help-close');
  await expect(page.locator('#modal-help')).toBeHidden();
});

test('tutorial: level 1 shows the coach and is solved with a swipe', async ({ page }) => {
  await page.goto('./');
  await page.click('#btn-play');
  await expect(page.locator('#hud-name')).toHaveText('First Glide');
  await expect(page.locator('.coach')).toHaveCount(1);
  await expect(page.locator('#tip')).toContainText('Swipe');
  await swipe(page, block(page, 0, 0), 'right');
  await expect(page.locator('#modal-win')).toBeVisible();
  await expect(page.locator('#win-stars .star.on')).toHaveCount(3);
  await expect(page.locator('#win-stats')).toContainText('1 moves');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('driftdock.progress.v1')));
  expect(saved.best['first-glide']).toBe(1);
  expect(saved.stars['first-glide']).toBe(3);
});

test('tap-to-select arrows, invalid moves, undo and restart', async ({ page }) => {
  await page.goto('./?fast=1');
  await page.evaluate(() => window.__driftdock.startLevel(2)); // "Wrong Door"
  const start = await gameState(page);

  // blocked move: red block at (0,3) cannot move left
  await block(page, 0, 3).click();
  await expect(page.locator('.handle')).toHaveCount(4);
  await expect(page.locator('.handle[data-dir="left"]')).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await idle(page);
  expect((await gameState(page)).moves).toBe(0);

  await page.locator('.handle[data-dir="right"]').click();
  await idle(page);
  const afterOne = await gameState(page);
  expect(afterOne.moves).toBe(1);
  await expect(block(page, 2, 3)).toHaveCount(1);

  await tapMove(page, 2, 3, 'up'); // red docks through the top gate
  const afterTwo = await gameState(page);
  expect(afterTwo.blocks).toHaveLength(1);
  await expect(page.locator('.block')).toHaveCount(1);

  await page.click('#btn-undo');
  await idle(page);
  expect(await gameState(page)).toEqual(afterOne);
  await expect(page.locator('.block')).toHaveCount(2);

  await page.click('#btn-restart');
  await idle(page);
  expect(await gameState(page)).toEqual(start);
  await expect(page.locator('#btn-undo')).toBeDisabled();
});

test('dead ends are detected and flagged', async ({ page }) => {
  await page.goto('./?fast=1');
  await page.evaluate(() => window.__driftdock.startLevel(2));
  await tapMove(page, 3, 3, 'right'); // blue leaves first...
  await tapMove(page, 0, 3, 'right'); // ...so red slides past its column
  await tapMove(page, 4, 3, 'up');
  await expect(page.locator('#tip')).toHaveClass(/warn/);
  await expect(page.locator('#btn-undo')).toHaveClass(/pulse/);
  // the position was already lost when blue left first; undo all the way back
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('z');
    await idle(page);
  }
  await expect(page.locator('#btn-undo')).not.toHaveClass(/pulse/);
  await expect(page.locator('#tip')).not.toHaveClass(/warn/);
});

test('hint highlights a block that leads to a solution', async ({ page }) => {
  await page.goto('./?fast=1');
  await page.evaluate(() => window.__driftdock.startLevel(5));
  await page.click('#btn-hint');
  await expect(page.locator('.block.hinted')).toHaveCount(1);
  await expect(page.locator('#tip')).toContainText('Hint');
});

test('keyboard play: Tab selects, arrows slide', async ({ page }) => {
  await page.goto('./?fast=1');
  await page.click('#btn-play');
  await page.locator('#board').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Tab');
  await expect(page.locator('.block.selected')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#modal-win')).toBeVisible();
});

test('progress unlocks levels and survives a reload; mute persists', async ({ page }) => {
  await page.goto('./?fast=1');
  await page.click('#btn-levels');
  await expect(page.locator('.level-btn')).toHaveCount(await page.evaluate(() => window.__driftdock.levels.length));
  // the first three levels are open; you may leave at most two unsolved behind
  await expect(page.locator('.level-btn').nth(2)).toBeEnabled();
  await expect(page.locator('.level-btn').nth(3)).toBeDisabled();
  await expect(page.locator('.chapter')).toHaveCount(6);
  await page.locator('.level-btn').nth(0).click();
  await swipe(page, block(page, 0, 0), 'right');
  await page.click('#btn-win-levels');
  await expect(page.locator('.level-btn').nth(3)).toBeEnabled();
  await expect(page.locator('.level-btn').nth(4)).toBeDisabled();
  await expect(page.locator('.level-btn').nth(0)).toHaveClass(/done/);

  await page.click('[data-nav="title"]');
  await page.locator('#screen-title [data-sound-toggle]').click();
  await page.reload();
  await expect(page.locator('#title-stars')).toContainText('★ 3');
  await expect(page.locator('#btn-play')).toContainText('Continue');
  await expect(page.locator('#screen-title [data-sound-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#btn-levels');
  await expect(page.locator('.level-btn').nth(3)).toBeEnabled();
  await expect(page.locator('.level-btn').nth(4)).toBeDisabled();

  await page.click('#btn-reset');
  await page.click('#btn-confirm-yes');
  await expect(page.locator('.level-btn').nth(3)).toBeDisabled();
  await expect(page.locator('.level-btn.done')).toHaveCount(0);
});

test('board fits the viewport without scrolling', async ({ page }) => {
  test.setTimeout(300_000); // checks every one of the 124 levels
  await page.goto('./?fast=1');
  const n = await page.evaluate(() => window.__driftdock.levels.length);
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => window.__driftdock.startLevel(k), i);
    // let the screen slide-in finish and ResizeObserver-driven layout settle
    await page.evaluate(async () => {
      await Promise.all(document.querySelector('#screen-game').getAnimations().map((a) => a.finished));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const vp = page.viewportSize();
    const box = await page.locator('#board').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
    const controls = await page.locator('.controls').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(controls.y + 1);
    expect(controls.y + controls.height).toBeLessThanOrEqual(vp.height + 0.5);
  }
  const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});

async function playThrough(page, from, to, { clickNextOnLast = true } = {}) {
  for (let i = from; i < to; i++) {
    await expect(page.locator('#hud-num')).toHaveText(String(i + 1));
    const moves = await page.evaluate(async () => {
      const { fastSolve } = await import('./src/fastsolver.js');
      const dd = window.__driftdock;
      return fastSolve(dd.levels[dd.state.index], dd.state.blocks).moves;
    });
    for (const m of moves) await quickTapMove(page, m.x, m.y, m.dir);
    await expect(page.locator('#modal-win')).toBeVisible();
    await expect(page.locator('#win-stars .star.on')).toHaveCount(3);
    if (i < to - 1 || clickNextOnLast) await page.click('#btn-next');
  }
}

// One test per chapter so they run in parallel; together they play every
// level through the real UI. Earlier chapters are marked solved first so the
// chapter-cleared and finale screens can be checked.
for (let chapter = 1; chapter <= 6; chapter++) {
  test(`chapter ${chapter} can be completed through the UI, in order`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.goto('./?fast=1');
    const info = await page.evaluate((c) => {
      const { levels } = window.__driftdock;
      const first = levels.findIndex((l) => l.chapter === c);
      const last = levels.findLastIndex((l) => l.chapter === c);
      const best = Object.fromEntries(levels.slice(0, first).map((l) => [l.id, 99]));
      localStorage.setItem('driftdock.progress.v1', JSON.stringify({ best, stars: {} }));
      return { first, last, n: levels.length };
    }, chapter);
    await page.reload();
    await page.click('#btn-play'); // continues at the first unsolved level
    await playThrough(page, info.first, info.last + 1, { clickNextOnLast: false });
    if (info.last === info.n - 1) {
      await expect(page.locator('#win-title')).toHaveText('Harbour Master!');
      await expect(page.locator('#win-stats')).toContainText(`All ${info.n} docks cleared`);
      await page.click('#btn-next');
      await expect(page.locator('#screen-levels')).toBeVisible();
      await expect(page.locator('.level-btn.done')).toHaveCount(info.n);
    } else {
      await expect(page.locator('#win-title')).toHaveText(/cleared!$/);
      await page.click('#btn-next');
      await expect(page.locator('#hud-num')).toHaveText(String(info.last + 2));
    }
  });
}

test('music renders at a comfortable level without clipping', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for the offline render');
  await page.goto('./');
  const stats = await page.evaluate(async () => {
    const { renderOffline } = await import('./src/music.js');
    const buf = await renderOffline(24);
    let peak = 0;
    let sum = 0;
    let n = 0;
    let nan = false;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      for (const v of buf.getChannelData(ch)) {
        if (Number.isNaN(v)) nan = true;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        n++;
      }
    }
    return { peak, rms: Math.sqrt(sum / n), nan };
  });
  expect(stats.nan).toBe(false);
  expect(stats.peak).toBeLessThan(0.9); // no clipping
  expect(stats.rms).toBeGreaterThan(0.01); // actually audible
  expect(stats.rms).toBeLessThan(0.2); // background, not foreground
});

test('music can be toggled and the choice persists', async ({ page }) => {
  await page.goto('./');
  const toggle = page.locator('#screen-title [data-music-toggle]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btn-howto'); // any gesture unlocks audio
  await page.click('#btn-help-close');
  await expect.poll(() => page.evaluate(() => window.__driftdock.audio.musicPlaying)).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.__driftdock.audio.musicPlaying)).toBe(false);
  await page.reload();
  await expect(page.locator('#screen-title [data-music-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#btn-play');
  await expect(page.locator('.controls [data-music-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('m');
  await expect(page.locator('.controls [data-music-toggle]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__driftdock.audio.musicPlaying)).toBe(true);
});

test('touch swipe works on touch devices', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium' || !info.project.use.hasTouch, 'CDP touch events need Chromium with touch');
  await page.goto('./?fast=1');
  await page.locator('#btn-play').tap();
  const box = await block(page, 0, 0).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let k = 1; k <= 5; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + k * 14, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#modal-win')).toBeVisible();
});
