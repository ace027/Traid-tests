import fs from 'node:fs';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { AUX, api, apiKey, axeCheck, completeSetup, e2eInfo, isMobile, openNav, visit, type E2eInfo } from './helpers';

// One scenario per project, run in order against one shared page and session. The desktop project
// runs first and sets the server up; the mobile project signs in and adds a different show.

let context: BrowserContext;
let page: Page;
let request: APIRequestContext;
let info: E2eInfo;
let key = '';
// The key is cached per worker; Playwright restarts the worker after a failed test.
const getKey = async () => (key ||= await apiKey(page));
let phase: 'setup' | 'login';

test.beforeAll(async ({ browser }, testInfo) => {
  const use = testInfo.project.use;
  context = await browser.newContext({
    baseURL: use.baseURL ?? 'http://127.0.0.1:8990',
    viewport: use.viewport ?? null,
    isMobile: use.isMobile ?? false,
    hasTouch: use.hasTouch ?? false,
  });
  page = await context.newPage();
  request = context.request;
  info = await e2eInfo(request);
});

test.afterAll(async () => {
  await context.close();
});

// Desktop adds "Fake Show" (2 seasons); mobile adds "Ended Show" (1 season).
const showFor = (mobile: boolean) => (mobile ? { search: 'Ended Show', title: 'Ended Show', season: 'Season 1' } : { search: 'Fake Show', title: 'Fake Show', season: 'Season 1' });

test.describe('smoke', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  test('1. setup or login lands on Series', async ({}, testInfo) => {
    phase = await completeSetup(page);
    expect(phase).toBe(isMobile(testInfo) ? 'login' : 'setup');
    await expect(page.getByRole('heading', { name: 'Series', level: 1 })).toBeVisible();
    key = await apiKey(page);
    if (phase === 'setup') {
      await expect(page.getByText('Your library is empty'), 'empty Series state on a fresh server').toBeVisible();
    }
    await openNav(page, testInfo);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Calendar' })).toBeVisible();
    if (isMobile(testInfo)) await page.keyboard.press('Escape');
  });

  test('2. configure root folder, indexer and download client', async ({}, testInfo) => {
    if (!isMobile(testInfo)) {
      await visit(page, '/settings/mediamanagement');
      await page.getByLabel('New root folder path').fill(info.rootFolder);
      await page.getByRole('button', { name: 'Add root folder' }).click();
      await expect(page.getByText('Root folder added').first()).toBeVisible();

      await visit(page, '/settings/indexers');
      await page.getByRole('button', { name: 'Add Indexer' }).first().click();
      await page.getByRole('button', { name: /Newznab/ }).first().click();
      await page.getByLabel(/^Name/).fill('E2E Indexer');
      await page.getByLabel(/^URL/).fill('http://indexer.e2e');
      await page.getByLabel('API Key').fill('e2e-key');
      await page.getByRole('dialog').getByRole('button', { name: 'Test', exact: true }).click();
      await expect(page.getByText('Test succeeded').first()).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Edit E2E Indexer' })).toBeVisible();

      await visit(page, '/settings/downloadclients');
      await page.getByRole('button', { name: 'Add Download Client' }).first().click();
      await page.getByRole('button', { name: /SABnzbd/ }).first().click();
      await page.getByLabel(/^Name/).fill('E2E SABnzbd');
      await page.getByLabel(/^Host/).fill('sab.e2e');
      await page.getByLabel('API Key').fill('e2e-key');
      await page.getByRole('dialog').getByRole('button', { name: 'Test', exact: true }).click();
      await expect(page.getByText('Test succeeded').first()).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Edit E2E SABnzbd' })).toBeVisible();
    } else {
      // Configured by the desktop run; the mobile run proves the lists render at a narrow width.
      await visit(page, '/settings/mediamanagement');
      await expect(page.getByText(info.rootFolder).first()).toBeVisible();
      await visit(page, '/settings/indexers');
      await expect(page.getByRole('button', { name: 'Edit E2E Indexer' })).toBeVisible();
      await visit(page, '/settings/downloadclients');
      await expect(page.getByRole('button', { name: 'Edit E2E SABnzbd' })).toBeVisible();
    }
  });

  test('3. add a series from the lookup', async ({}, testInfo) => {
    const show = showFor(isMobile(testInfo));
    await visit(page, '/add/new');
    await page.getByLabel('Search for a series').fill(show.search);
    const results = page.getByRole('region', { name: 'Search results' });
    await expect(results.getByText(show.title).first()).toBeVisible();
    await results.getByRole('button', { name: new RegExp(show.title) }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Root Folder')).toBeVisible();
    await dialog.getByRole('button', { name: `Add ${show.title}` }).click();
    await expect(page.getByRole('heading', { name: new RegExp(show.title), level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: show.season })).toBeVisible();
  });

  test('4. interactive search and grab', async ({}, testInfo) => {
    const show = showFor(isMobile(testInfo));
    // A webhook subscribed to On Grab only, created before the grab so the grab must reach /e2e-hook.
    type Template = { implementation: string; settings: Record<string, unknown> };
    const schema = await api<Template[]>(request, await getKey(), 'notification/schema');
    const webhook = schema.find((t) => t.implementation === 'Webhook');
    expect(webhook, 'Webhook notification template').toBeTruthy();
    await api(request, await getKey(), 'notification', {
      ...webhook,
      name: `E2E Grab Hook ${show.title}`,
      onGrab: true,
      settings: { ...webhook!.settings, url: `${AUX}/e2e-hook` },
    });

    await visit(page, '/');
    await page.getByRole('link', { name: new RegExp(show.title) }).first().click();
    await expect(page.getByRole('heading', { name: show.season })).toBeVisible();
    await page.getByRole('region', { name: /Season 1/ }).getByRole('button', { name: 'Interactive search', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/WEB-DL-E2E/).first(), 'fake indexer release should be listed').toBeVisible();
    await dialog.getByRole('button', { name: /^Grab .*WEB-DL-E2E/ }).first().click();
    await expect(dialog.getByRole('button', { name: /^Grabbed / })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect
      .poll(
        async () => {
          const hooks = (await (await request.get(`${AUX}/e2e-hook`)).json()) as ({ eventType?: string; series?: { title?: string } } | null)[];
          return hooks.some((h) => h?.eventType === 'Grab' && h.series?.title === show.title);
        },
        { timeout: 10_000, message: 'On Grab webhook should receive a Grab payload for the grabbed series' },
      )
      .toBe(true);
  });

  test('5. queue shows the download, refreshes import it', async () => {
    // The mobile run is the second grab and import on this server: each download gets its own id and its
    // own two-refresh countdown, and the queue must still empty.
    await visit(page, '/activity/queue');
    await expect(page.getByText(/WEB-DL-E2E/).first()).toBeVisible();
    await expect(page.getByRole('progressbar').first(), 'queue item progress bar').toBeVisible();
    // Marks this document: a reload or navigation would drop it, so the checks below prove live updates.
    await page.evaluate(() => ((window as unknown as { __live?: boolean }).__live = true));

    // Each refresh runs to completion before the next one starts, so imports never overlap.
    const refresh = async () => {
      const cmd = await api<{ id: number }>(request, await getKey(), 'command', { name: 'RefreshMonitoredDownloads' });
      await expect
        .poll(async () => (await api<{ status: string }>(request, await getKey(), `command/${cmd.id}`)).status, { timeout: 10_000, message: 'refresh command should finish' })
        .toMatch(/completed|failed/);
    };
    for (let i = 0; i < 2; i++) await refresh();
    // Imports and removal happen asynchronously after the second refresh.
    await expect
      .poll(
        async () => {
          await refresh();
          const q = await api<{ records: { title: string; trackedDownloadState?: string; statusMessages?: unknown }[] }>(request, await getKey(), 'queue');
          // The returned text shows up in the failure message when the queue does not empty.
          return q.records.length === 0 ? 'empty' : JSON.stringify(q.records.map((r) => [r.title, r.trackedDownloadState, r.statusMessages]));
        },
        { timeout: 20_000, message: 'queue should empty once the download is imported' },
      )
      .toBe('empty');

    // Still on the same page with no reload: the row and its progress bar leave through live updates.
    await expect(page.getByText(/WEB-DL-E2E/), 'queue row should disappear without a reload').toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('progressbar')).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { __live?: boolean }).__live), 'page must not have reloaded').toBe(true);

    await visit(page, '/activity/history');
    await expect(page.getByRole('table').getByText('Grabbed', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('table').getByText(/^(Imported|Episode Imported)$/).first()).toBeVisible();
  });

  test('6. system status and Housekeeping task', async () => {
    await visit(page, '/system/status');
    await expect(page.getByRole('heading', { name: 'System', level: 1 })).toBeVisible();
    // Health items render a StatusBadge; an error-level item shows the exact label "Error".
    await expect(page.getByText('Error', { exact: true })).toHaveCount(0);

    await visit(page, '/system/tasks');
    type Cmd = { id: number; name: string; status: string };
    const housekeeping = async () => (await api<Cmd[]>(request, await getKey(), 'command')).filter((c) => c.name === 'Housekeeping');
    const before = new Set((await housekeeping()).map((c) => c.id));
    const completedRows = page.getByRole('table', { name: 'Command queue' }).getByRole('row').filter({ hasText: 'Housekeeping' }).filter({ hasText: 'Completed' });
    const completedBefore = await completedRows.count();
    await page.evaluate(() => ((window as unknown as { __live?: boolean }).__live = true));

    await page.getByRole('button', { name: 'Run Housekeeping now' }).click();
    // Keyed on a command created after the click, so an earlier run (the desktop run, for mobile) cannot satisfy it.
    await expect
      .poll(async () => (await housekeeping()).some((c) => !before.has(c.id) && c.status === 'completed'), {
        timeout: 15_000,
        message: 'a new Housekeeping command should complete',
      })
      .toBe(true);
    // The Tasks queue table shows the new run as Completed without a reload.
    await expect(completedRows, 'Tasks queue should show the new run as Completed').toHaveCount(completedBefore + 1);
    expect(await page.evaluate(() => (window as unknown as { __live?: boolean }).__live), 'page must not have reloaded').toBe(true);
  });

  test('7. webhook connection test', async ({}, testInfo) => {
    // The desktop run already created 'E2E Webhook': its 'Edit E2E Webhook' button behind the dialog also
    // matches /Webhook/, so the type picker is looked up inside the dialog. Its test call already reached
    // /e2e-hook too, so the mobile run uses its own name and checks that the hook count grows.
    const name = isMobile(testInfo) ? 'E2E Webhook Mobile' : 'E2E Webhook';
    const hooksBefore = ((await (await request.get(`${AUX}/e2e-hook`)).json()) as unknown[]).length;
    await visit(page, '/settings/connect');
    await page.getByRole('button', { name: 'Add Connection' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /^Webhook/ }).click();
    await page.getByLabel(/^Name/).fill(name);
    await page.getByLabel(/^URL/).fill(`${AUX}/e2e-hook`);
    await page.getByRole('dialog').getByRole('button', { name: 'Test', exact: true }).click();
    await expect(page.getByText('Test succeeded').first()).toBeVisible();
    const hooks = (await (await request.get(`${AUX}/e2e-hook`)).json()) as unknown[];
    expect(hooks.length, 'webhook test should have reached /e2e-hook').toBeGreaterThan(hooksBefore);
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: `Edit ${name}` })).toBeVisible();
  });

  test('8. backup create and download', async () => {
    await visit(page, '/system/backup');
    await expect(page.getByRole('heading', { name: 'Backup', level: 1 })).toBeVisible();
    const downloads = page.getByRole('button', { name: /^Download / });
    const before = await downloads.count();
    await page.getByRole('button', { name: 'Backup now' }).click();
    await expect(page.getByText('Backup created').first()).toBeVisible();
    await expect(downloads, 'new backup should be listed').toHaveCount(before + 1);

    const label = (await downloads.first().getAttribute('aria-label')) ?? '';
    const backupName = label.replace(/^Download /, '');
    expect(backupName).toMatch(/\.zip$/);
    const [download] = await Promise.all([page.waitForEvent('download'), downloads.first().click()]);
    expect(download.suggestedFilename()).toBe(backupName);
    const path = await download.path();
    expect(fs.statSync(path).size, 'downloaded backup should not be empty').toBeGreaterThan(0);
  });
});

// Accessibility checks are independent of each other, so one failing page does not skip the rest.
test.describe('accessibility', () => {
  test.describe.configure({ mode: 'default' });
  test.setTimeout(60_000);

  const pages: { name: string; path: (mobile: boolean) => string; ready: (mobile: boolean) => Promise<void> }[] = [
    { name: 'Series index', path: () => '/', ready: async (m) => void (await expect(page.getByRole('link', { name: new RegExp(showFor(m).title) }).first()).toBeVisible()) },
    {
      name: 'Series detail',
      path: () => '/',
      ready: async (m) => {
        await page.getByRole('link', { name: new RegExp(showFor(m).title) }).first().click();
        await expect(page.getByRole('heading', { name: showFor(m).season })).toBeVisible();
      },
    },
    { name: 'Queue', path: () => '/activity/queue', ready: async () => void (await expect(page.getByRole('heading', { name: 'Queue', level: 1 })).toBeVisible()) },
    { name: 'Calendar', path: () => '/calendar', ready: async () => void (await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible()) },
    { name: 'System Status', path: () => '/system/status', ready: async () => void (await expect(page.getByRole('heading', { name: 'System', level: 1 })).toBeVisible()) },
    { name: 'Settings Connect', path: () => '/settings/connect', ready: async () => void (await expect(page.getByRole('heading', { name: 'Connect', level: 1 })).toBeVisible()) },
  ];

  for (const p of pages) {
    test(`axe: ${p.name}`, async ({}, testInfo) => {
      const mobile = isMobile(testInfo);
      await visit(page, p.path(mobile));
      await p.ready(mobile);
      await axeCheck(page, p.name);
    });
  }
});
