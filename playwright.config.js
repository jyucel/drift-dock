// Browser tests run against the static site served under a GitHub-Pages-like
// subpath (/drift-dock/) so relative asset paths are exercised too.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const extraBrowsers = process.env.E2E_ALL_BROWSERS
  ? [
      // the two full playthroughs already run on Chromium; skip them here to keep CI fast
      { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: /can be completed/ },
      { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: /can be completed/ },
      { name: 'mobile-safari', use: { ...devices['iPhone 13'] }, grepInvert: /can be completed/ },
    ]
  : [];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/drift-dock/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // full playthroughs of chapters 2-6 run on desktop Chromium only
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grepInvert: /chapter [2-6] can be completed/ },
    ...extraBrowsers,
  ],
  webServer: {
    command: `node tools/serve.mjs ${PORT} . /drift-dock/`,
    url: `http://localhost:${PORT}/drift-dock/`,
    reuseExistingServer: !process.env.CI,
  },
});
