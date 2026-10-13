import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, getHostConfig } from './app.js';
import { createTestApp, type TestApp } from './test/helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

describe('server core', () => {
  it('GET /ping needs no key', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'OK' });
  });

  it('GET /initialize.json never gives the key to unauthenticated clients', async () => {
    t = await createTestApp();
    for (const remoteAddress of ['127.0.0.1', '203.0.113.5', '172.17.0.1', '192.168.1.20']) {
      const res = await t.app.inject({ url: '/initialize.json', remoteAddress });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ apiKey: '', authenticated: false, authMethod: 'forms', setupRequired: true });
      expect(res.body).not.toContain(t.apiKey);
    }
    for (const headers of [
      { 'x-forwarded-for': '198.51.100.7' },
      { forwarded: 'for=198.51.100.7' },
      { 'x-real-ip': '198.51.100.7' },
    ]) {
      const proxied = await t.app.inject({ url: '/initialize.json', remoteAddress: '127.0.0.1', headers });
      expect(proxied.statusCode).toBe(200);
      expect(proxied.json().apiKey).toBe('');
    }
    const withKey = await t.app.inject({ url: '/initialize.json', headers: { 'x-api-key': t.apiKey } });
    expect(withKey.json()).toMatchObject({ apiKey: t.apiKey, authenticated: true });
  });

  it('generates a 32 char hex api key', async () => {
    t = await createTestApp();
    expect(t.apiKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects missing and wrong keys with 401', async () => {
    t = await createTestApp();
    const url = '/api/v3/system/status';
    for (const key of [undefined, 'x'.repeat(32), 'short', 'y'.repeat(100)]) {
      const res = await t.app.inject({ url, headers: key ? { 'x-api-key': key } : {} });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ message: 'Unauthorized' });
    }
    const res = await t.app.inject({ url: `${url}?apikey=nope` });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the key by header only on regular API routes', async () => {
    t = await createTestApp();
    const url = '/api/v3/system/status';
    const a = await t.app.inject({ url, headers: { 'x-api-key': t.apiKey } });
    expect(a.statusCode).toBe(200);
    expect(a.json().appName).toBe('Sonarr');
    expect(a.json().version).toMatch(/^\d+\.\d+\.\d+/);
    expect(a.json().appData).toBe(t.dataDir);
    expect(a.json().authentication).toBe('forms');
    const b = await t.app.inject({ url: `${url}?apikey=${t.apiKey}` });
    expect(b.statusCode).toBe(401);
  });

  it('records each migration once', async () => {
    t = await createTestApp();
    const rows = t.app.sqlite.prepare('select version from schema_migrations').all();
    expect(rows).toEqual([{ version: '0001_initial' }, { version: '0002_auth' }]);
  });

  it('keeps the api key across restarts and creates a missing data dir', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-restart-'));
    const dir = path.join(base, 'nested', 'data');
    try {
      const a = await buildApp({ dataDir: dir });
      const key = getHostConfig(a.db).apiKey;
      await a.close();
      const b = await buildApp({ dataDir: dir });
      expect(getHostConfig(b.db).apiKey).toBe(key);
      const rows = b.sqlite.prepare('select count(*) as n from schema_migrations').get();
      expect(rows).toEqual({ n: 2 });
      await b.close();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
