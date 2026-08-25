import { defineConfig, devices } from '@playwright/test';

// Chromium only, and a fixed viewport with animations disabled — screenshot
// diffs are worthless if the baseline can drift on browser or DPI. See
// plan/0001-chomp.md risk R4.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker in CI keeps screenshot timing stable; locally, let Playwright
  // pick. Spread rather than `undefined` because exactOptionalPropertyTypes is on.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['html'], ['github']] : [['list']],

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 1,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Tests run against the real production bundle, not the dev server, so what
  // is verified is what ships.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
