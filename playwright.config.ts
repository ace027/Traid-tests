import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

// PW_CHROMIUM wins; otherwise use any preinstalled chromium under the browsers dir.
function resolveChromium(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const exe = `${root}/${d}/chrome-linux/chrome`;
    if (existsSync(exe)) return exe;
  }
  return undefined;
}
const executablePath = resolveChromium();

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
