import fs from 'node:fs';
import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

export const USERNAME = 'admin';
export const PASSWORD = 'e2e-password';

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export const AUX = 'http://127.0.0.1:8991';

export interface E2eInfo {
  rootFolder: string;
  downloadsDir: string;
  dataDir: string;
}

export async function e2eInfo(request: APIRequestContext): Promise<E2eInfo> {
  const res = await request.get(`${AUX}/e2e-info`);
  expect(res.ok(), 'GET /e2e-info (test-only route from server/src/e2e/start.ts)').toBeTruthy();
  return (await res.json()) as E2eInfo;
}

export const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

/**
 * Gets to a logged-in app: creates the account through the first-run form when setup is still
 * required (first project), otherwise signs in through the login form (later projects).
 */
export async function completeSetup(page: Page): Promise<'setup' | 'login'> {
  const init = (await (await page.request.get('/initialize.json')).json()) as { setupRequired: boolean };
  // A first visit to '/' races AuthGate's /setup redirect against the 401 redirect to /login, so go to /setup directly.
  await page.goto(init.setupRequired ? '/setup' : '/');
  const password = page.getByLabel(/^Password/).first();
  if (init.setupRequired) {
    await expect(page.getByRole('heading', { name: 'Welcome to Sonarr' }), 'first-run setup form').toBeVisible();
    await page.getByLabel('Username').fill(USERNAME);
    await password.fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Series', level: 1 })).toBeVisible();
    // Setup logs the caller in; sign out and back in to prove the credentials work.
    await page.getByRole('button', { name: 'Log out' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Sign in to Sonarr' }), 'login form').toBeVisible();
  await page.getByLabel('Username').fill(USERNAME);
  await password.fill(PASSWORD);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await expect(page.getByRole('heading', { name: 'Series', level: 1 })).toBeVisible();
  return init.setupRequired ? 'setup' : 'login';
}

/**
 * page.goto that signs in through the API when the app bounces to /login. Playwright starts a new
 * worker (and a new browser context) after a failed test; this keeps later independent checks usable.
 */
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  if (new URL(page.url()).pathname.endsWith('/login')) {
    const res = await page.request.post('/login', { data: { username: USERNAME, password: PASSWORD } });
    expect(res.ok(), 'API login after the session was lost').toBeTruthy();
    await page.goto(path);
  }
}

/** The API key, read from /initialize.json with the page's session cookie. */
export async function apiKey(page: Page): Promise<string> {
  const res = await page.request.get('/initialize.json');
  const body = (await res.json()) as { apiKey?: string; authenticated?: boolean };
  expect(body.authenticated, 'session should be authenticated').toBe(true);
  expect(body.apiKey, 'initialize.json should expose the API key to a logged-in user').toBeTruthy();
  return body.apiKey as string;
}

/** Calls /api/v3/<path> with the API key; GET without a body, POST with one. */
export async function api<T = unknown>(request: APIRequestContext, key: string, path: string, body?: unknown): Promise<T> {
  const url = `/api/v3/${path}`;
  const headers = { 'X-Api-Key': key };
  const res = body === undefined ? await request.get(url, { headers }) : await request.post(url, { headers, data: body });
  expect(res.ok(), `${body === undefined ? 'GET' : 'POST'} ${url} => ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Opens the drawer on narrow viewports; no-op on desktop where the sidebar is visible. */
export async function openNav(page: Page, testInfo: TestInfo): Promise<void> {
  if (!isMobile(testInfo)) return;
  await page.getByRole('button', { name: 'Open navigation' }).click();
}

/** Serious axe findings in the product UI that are tolerated; keep empty so every serious or critical rule fails the run. */
export const KNOWN_PRODUCT_VIOLATIONS: string[] = [];

/** Injects axe-core and asserts there are no serious or critical violations. */
export async function axeCheck(page: Page, label: string): Promise<void> {
  // A hovered control gets its hover colors, which would be checked instead of the resting ones.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500); // let color transitions settle
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')) }));
  });
  const blocking = (violations as { id: string; impact: string; help: string; nodes: string[] }[]).filter(
    (v) => (v.impact === 'serious' || v.impact === 'critical') && !KNOWN_PRODUCT_VIOLATIONS.includes(v.id),
  );
  expect(blocking, `axe serious/critical violations on ${label}`).toEqual([]);
}
