import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HealthResource } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { buildApp, getHostConfig } from '../app.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { recordFailure, resetIndexerBackoff } from '../indexers/registry.js';
import type { StatFsFn } from './health.js';

let t: TestApp | undefined;
afterEach(async () => {
  resetIndexerBackoff();
  await t?.cleanup();
  t = undefined;
});

const req = (url: string) => t!.app.inject({ url, headers: { 'x-api-key': t!.apiKey } });
const sources = (list: HealthResource[]) => list.map((h) => h.source);
const addIndexer = (name: string, over: Partial<typeof schema.indexers.$inferInsert> = {}) =>
  t!.app.db
    .insert(schema.indexers)
    .values({ name, implementation: 'newznab', settings: '{}', added: new Date().toISOString(), ...over })
    .returning()
    .get();

describe('health checks', () => {
  it('reports no indexers and no download client on a fresh install', async () => {
    t = await createTestApp();
    const list = await t.app.health.check();
    expect(sources(list)).toEqual(expect.arrayContaining(['IndexerRssCheck', 'IndexerSearchCheck', 'DownloadClientCheck']));
    expect(list.find((h) => h.source === 'DownloadClientCheck')).toMatchObject({ type: 'warning', message: 'No download client is available' });
  });

  it('clears indexer and client warnings once they exist', async () => {
    t = await createTestApp();
    addIndexer('idx');
    t.app.db.insert(schema.downloadClients).values({ name: 'dc', implementation: 'sabnzbd', protocol: 'usenet' }).run();
    const list = await t.app.health.check();
    expect(sources(list)).not.toContain('IndexerRssCheck');
    expect(sources(list)).not.toContain('DownloadClientCheck');
  });

  it('flags indexers in backoff', async () => {
    t = await createTestApp();
    const a = addIndexer('a');
    const b = addIndexer('b');
    recordFailure(a.id, 'boom');
    let list = await t.app.health.check();
    expect(list.find((h) => h.source === 'IndexerStatusCheck')).toMatchObject({ type: 'warning', message: 'Indexers unavailable due to failures: a' });
    recordFailure(b.id, 'boom');
    list = await t.app.health.check();
    expect(list.find((h) => h.source === 'IndexerStatusCheck')).toMatchObject({ type: 'error', message: 'All indexers are unavailable due to failures' });
  });

  it('flags missing root folders, including an unmounted drive', async () => {
    t = await createTestApp();
    const gone = path.join(t.dataDir, 'mnt', 'tv');
    t.app.db.insert(schema.rootFolders).values({ path: gone }).run();
    const list = await t.app.health.check();
    expect(list.find((h) => h.source === 'RootFolderCheck')).toMatchObject({ type: 'error', message: `Missing root folder: ${gone}` });
  });

  it('flags low free space using statfs', async () => {
    const statfs: StatFsFn = async () => ({ bsize: 1024, blocks: 10_000_000, bavail: 1000 });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-health-'));
    const app = await buildApp({ dataDir, scheduler: false, statfs });
    try {
      const folder = path.join(dataDir, 'tv');
      fs.mkdirSync(folder);
      app.db.insert(schema.rootFolders).values({ path: folder }).run();
      const list = await app.health.check();
      expect(list.find((h) => h.source === 'DiskSpaceCheck')?.message).toContain(`${folder} has 0.0 GB free`);
    } finally {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('flags a missing recycle bin', async () => {
    t = await createTestApp();
    const bin = path.join(t.dataDir, 'bin');
    t.app.sqlite
      .prepare("insert into config (key, value) values ('mediamanagement', ?) on conflict(key) do update set value = excluded.value")
      .run(JSON.stringify({ recycleBin: bin }));
    expect((await t.app.health.check()).find((h) => h.source === 'RecycleBinCheck')?.message).toBe(`Recycle bin folder does not exist: ${bin}`);
    fs.mkdirSync(bin);
    expect(sources(await t.app.health.check())).not.toContain('RecycleBinCheck');
  });

  it('reports failing notifications and drops them when cleared', async () => {
    t = await createTestApp();
    const n = t.app.db.insert(schema.notifications).values({ name: 'Hook', implementation: 'webhook' }).returning().get();
    t.app.health.reportNotificationFailure(n.id);
    expect((await t.app.health.check()).find((h) => h.source === 'NotificationStatusCheck')?.message).toBe('Notifications unavailable due to failures: Hook');
    t.app.health.clearNotificationFailure(n.id);
    expect(sources(await t.app.health.check())).not.toContain('NotificationStatusCheck');
  });

  it('warns about external authentication', async () => {
    t = await createTestApp();
    t.app.updateHostConfig((h) => ({ ...h, authenticationMethod: 'external' }));
    expect(sources(await t.app.health.check())).toContain('AuthenticationCheck');
  });

  it('publishes an event and calls listeners only when the list changes', async () => {
    t = await createTestApp();
    const events: string[] = [];
    t.app.events.subscribe((e) => {
      if (e.name === 'health') events.push(e.action);
    });
    const changes: { added: number; removed: number }[] = [];
    const off = t.app.health.onChange((c) => changes.push({ added: c.added.length, removed: c.removed.length }));
    await t.app.health.check();
    await t.app.health.check();
    expect(events).toEqual(['updated']);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.added).toBeGreaterThan(0);
    addIndexer('idx');
    await t.app.health.check();
    expect(changes).toHaveLength(2);
    expect(changes[1]!.removed).toBeGreaterThan(0);
    off();
    t.app.db.delete(schema.indexers).run();
    await t.app.health.check();
    expect(changes).toHaveLength(2);
  });

  it('registers the CheckHealth command so a task can run it', async () => {
    t = await createTestApp();
    expect(t.app.commands.has('CheckHealth')).toBe(true);
    t.app.scheduler.ensureTask('CheckHealth', 'CheckHealth', 5);
    expect(t.app.scheduler.runNow('CheckHealth')).toBe(true);
  });
});

describe('system extra routes', () => {
  it('GET /api/v3/health lists issues', async () => {
    t = await createTestApp();
    const res = await req('/api/v3/health');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((h: HealthResource) => h.source)).toContain('DownloadClientCheck');
    expect(res.json()[0]).toMatchObject({ type: 'warning', wikiUrl: expect.stringContaining('http') });
  });

  it('GET /api/v3/diskspace returns an entry for the data dir', async () => {
    t = await createTestApp();
    const res = await req('/api/v3/diskspace');
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ label: expect.any(String), freeSpace: expect.any(Number), totalSpace: expect.any(Number) });
    expect(rows[0].totalSpace).toBeGreaterThan(0);
  });

  it('serves paged logs and log files, and refuses traversal', async () => {
    t = await createTestApp();
    t.app.logs.write({ level: 'info', message: 'first apikey=SECRET' });
    t.app.logs.write({ level: 'error', message: 'second' });
    const page = (await req('/api/v3/log?pageSize=1')).json();
    expect(page).toMatchObject({ page: 1, pageSize: 1, totalRecords: 2 });
    expect(page.records[0].message).toBe('second');
    expect((await req('/api/v3/log?level=info')).json().records).toHaveLength(1);
    expect((await req('/api/v3/log?level=bogus')).statusCode).toBe(400);

    const files = (await req('/api/v3/log/file')).json();
    expect(files.map((f: { filename: string }) => f.filename)).toContain('sonarr.txt');
    const dl = await req('/api/v3/log/file/sonarr.txt');
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toContain('text/plain');
    expect(dl.body).toContain('second');
    expect(dl.body).not.toContain('SECRET');
    for (const bad of ['..%2Fsonarr.db', '%2e%2e%2fsonarr.db', 'sonarr.db', 'nope.txt']) {
      expect((await req(`/api/v3/log/file/${bad}`)).statusCode).toBe(404);
    }
  });

  it('GET /api/v3/update returns an empty list and the routes need auth', async () => {
    t = await createTestApp();
    expect((await req('/api/v3/update')).json()).toEqual([]);
    for (const url of ['/api/v3/health', '/api/v3/diskspace', '/api/v3/log', '/api/v3/log/file', '/api/v3/update']) {
      expect((await t.app.inject({ url })).statusCode).toBe(401);
    }
    expect(getHostConfig(t.app.db).apiKey).toBe(t.apiKey);
  });
});
