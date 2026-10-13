import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/** PLAYWRIGHT_CHROMIUM_PATH, else the newest chromium-* under PLAYWRIGHT_BROWSERS_PATH (/opt/pw-browsers). */
function chromiumPath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined; // let Playwright use its own download
  const dirs = fs
    .readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const executablePath = chromiumPath();
const launchOptions = { ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] };

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:8990', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // One fresh server serves both projects, one after the other (the mobile project starts from a
  // fresh state through its own setup, see e2e/helpers.ts resetState).
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, launchOptions } },
    {
      name: 'mobile',
      dependencies: ['desktop'],
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, launchOptions },
    },
  ],
  webServer: {
    command: 'npx tsx server/src/e2e/start.ts',
    url: 'http://127.0.0.1:8990/ping',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
