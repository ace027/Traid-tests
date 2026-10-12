import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, key?: string) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': key ?? t!.apiKey }, payload: payload as object });

describe('config/host', () => {
  it('returns defaults', async () => {
    t = await createTestApp();
    const h = (await req('GET', '/api/v3/config/host')).json();
    expect(h).toMatchObject({ port: 8989, urlBase: '', apiKey: t.apiKey });
  });

  it('updates fields but never the api key', async () => {
    t = await createTestApp();
    const h = (await req('GET', '/api/v3/config/host')).json();
    const res = await req('PUT', '/api/v3/config/host', { ...h, port: 9000, urlBase: '/sonarr', instanceName: 'Mine', apiKey: 'x'.repeat(32) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ port: 9000, urlBase: '/sonarr', instanceName: 'Mine', apiKey: t.apiKey });
    expect((await req('GET', '/api/v3/config/host')).json().port).toBe(9000);
  });

  it('validates port and urlBase', async () => {
    t = await createTestApp();
    const h = (await req('GET', '/api/v3/config/host')).json();
    for (const port of [0, 65536, 1.5, 'x']) {
      expect((await req('PUT', '/api/v3/config/host', { ...h, port })).statusCode, String(port)).toBe(400);
    }
    const res = await req('PUT', '/api/v3/config/host', { ...h, urlBase: 'sonarr' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].propertyName).toBe('urlBase');
    expect((await req('PUT', '/api/v3/config/host', { ...h, urlBase: '' })).statusCode).toBe(200);
  });

  it('resets the api key and takes effect immediately', async () => {
    t = await createTestApp();
    const res = await req('POST', '/api/v3/config/host/apikey/reset');
    expect(res.statusCode).toBe(200);
    const next = res.json().apiKey as string;
    expect(next).toMatch(/^[0-9a-f]{32}$/);
    expect(next).not.toBe(t.apiKey);
    expect((await req('GET', '/api/v3/config/host')).statusCode).toBe(401);
    expect((await req('GET', '/api/v3/config/host', undefined, next)).statusCode).toBe(200);
  });
});

describe('config/ui', () => {
  it('returns defaults, updates and persists', async () => {
    t = await createTestApp();
    const ui = (await req('GET', '/api/v3/config/ui')).json();
    expect(ui).toMatchObject({ firstDayOfWeek: 0, calendarWeekColumnHeader: 'ddd M/D', shortDateFormat: 'MMM D YYYY', longDateFormat: 'dddd, MMMM D YYYY', timeFormat: 'h(:mm)a', showRelativeDates: true, theme: 'system', enableColorImpairedMode: false });
    const res = await req('PUT', '/api/v3/config/ui', { ...ui, theme: 'dark', firstDayOfWeek: 1 });
    expect(res.json()).toMatchObject({ theme: 'dark', firstDayOfWeek: 1 });
    await t.app.close();
    const app2 = await buildApp({ dataDir: t.dataDir });
    const key = (JSON.parse((app2.sqlite.prepare("select value from config where key='host'").get() as { value: string }).value) as { apiKey: string }).apiKey;
    const again = await app2.inject({ url: '/api/v3/config/ui', headers: { 'x-api-key': key } });
    expect(again.json().theme).toBe('dark');
    await app2.close();
    t = { ...t, cleanup: async () => fs.rmSync(t!.dataDir, { recursive: true, force: true }) };
  });

  it('rejects invalid values', async () => {
    t = await createTestApp();
    expect((await req('PUT', '/api/v3/config/ui', { theme: 'neon' })).statusCode).toBe(400);
    expect((await req('PUT', '/api/v3/config/ui', { firstDayOfWeek: 3 })).statusCode).toBe(400);
  });
});
