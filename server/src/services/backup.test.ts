import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { BackupResource } from '@sonarr/shared';
import { buildApp, getHostConfig } from '../app.js';
import { schema } from '../db/index.js';
import { FakeMetadataProvider } from '../test/fakeMetadata.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { backupPath, createBackup, deleteBackup, listBackups, stageRestore } from './backup.js';
import { readZip, zipBuffer } from './zip.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const addSeries = (app: TestApp['app'], n: number) =>
  app.db
    .insert(schema.series)
    .values({
      tvdbId: 1000 + n,
      tvmazeId: 2000 + n,
      title: `Show ${n}`,
      sortTitle: `show ${n}`,
      cleanTitle: `show${n}`,
      titleSlug: `show-${n}`,
      path: `/tv/show-${n}`,
      rootFolderPath: '/tv',
      qualityProfileId: app.db.select().from(schema.qualityProfiles).get()!.id,
      added: new Date().toISOString(),
    })
    .run();
const countSeries = (app: TestApp['app']) => (app.sqlite.prepare('select count(*) c from series').get() as { c: number }).c;
const hdr = (key: string) => ({ 'x-api-key': key });

describe('backup service', () => {
  it('creates a readable zip whose database has the same data', async () => {
    t = await createTestApp();
    addSeries(t.app, 1);
    addSeries(t.app, 2);
    const b = createBackup(t.app, 'manual');
    expect(b.name).toMatch(/^sonarr_backup_v.+_\d{4}\.\d{2}\.\d{2}_\d{2}\.\d{2}\.\d{2}\.zip$/);
    expect(b.path).toBe(`manual/${b.name}`);
    const entries = readZip(fs.readFileSync(backupPath(t.app, b.name)!));
    expect(entries.map((e) => e.name).sort()).toEqual(['sonarr.db', 'version.txt']);
    const out = path.join(t.dataDir, 'copy.db');
    fs.writeFileSync(out, entries.find((e) => e.name === 'sonarr.db')!.data);
    const copy = new Database(out, { readonly: true });
    expect((copy.prepare('select count(*) c from series').get() as { c: number }).c).toBe(2);
    copy.close();
    expect(fs.readdirSync(path.join(t.dataDir, 'tmp'))).toEqual([]);
  });

  it('lists newest first, tolerates a missing folder and deletes', async () => {
    t = await createTestApp();
    expect(listBackups(t.app)).toEqual([]);
    const a = createBackup(t.app, 'manual', new Date(2024, 0, 1, 10, 0, 0));
    const b = createBackup(t.app, 'scheduled', new Date(2024, 0, 2, 10, 0, 0));
    fs.utimesSync(backupPath(t.app, a.name)!, new Date(2024, 0, 1), new Date(2024, 0, 1));
    fs.utimesSync(backupPath(t.app, b.name)!, new Date(2024, 0, 2), new Date(2024, 0, 2));
    const list = listBackups(t.app);
    expect(list.map((x) => x.name)).toEqual([b.name, a.name]);
    expect(listBackups(t.app).map((x) => x.id)).toEqual(list.map((x) => x.id));
    expect(deleteBackup(t.app, '../../etc/passwd')).toBe(false);
    expect(deleteBackup(t.app, a.name)).toBe(true);
    expect(listBackups(t.app).map((x) => x.name)).toEqual([b.name]);
  });

  it('rejects non-sqlite, corrupt and non-zip input without staging', async () => {
    t = await createTestApp();
    const restore = path.join(t.dataDir, 'restore', 'sonarr.db');
    expect(() => stageRestore(t!.app, Buffer.from('garbage'))).toThrow(/Invalid backup/);
    expect(() => stageRestore(t!.app, zipBuffer([{ name: 'sonarr.db', data: Buffer.from('not sqlite at all') }]))).toThrow(/not a SQLite/);
    expect(() => stageRestore(t!.app, zipBuffer([{ name: 'other.txt', data: Buffer.from('x') }]))).toThrow(/sonarr.db is missing/);
    const bad = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(4096, 7)]);
    expect(() => stageRestore(t!.app, zipBuffer([{ name: 'sonarr.db', data: bad }]))).toThrow(/Invalid backup/);
    expect(fs.existsSync(restore)).toBe(false);
    expect(() => stageRestore(t!.app, 'missing.zip')).toThrow(/not found/);
  });

  it('rejects a foreign SQLite file and a newer-schema database', async () => {
    t = await createTestApp();
    const restore = path.join(t.dataDir, 'restore', 'sonarr.db');
    const make = (setup: (db: Database.Database) => void) => {
      const f = path.join(t!.dataDir, `x-${Math.random()}.db`);
      const db = new Database(f);
      setup(db);
      db.close();
      return zipBuffer([{ name: 'sonarr.db', data: fs.readFileSync(f) }]);
    };
    const foreign = make((db) => db.exec('CREATE TABLE foo (a)'));
    expect(() => stageRestore(t!.app, foreign)).toThrow(/not a Sonarr database/);
    const newer = zipBuffer([{ name: 'sonarr.db', data: (() => {
      const f = path.join(t!.dataDir, 'newer.db');
      t!.app.sqlite.prepare('VACUUM INTO ?').run(f);
      const db = new Database(f);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES ('9999_future', 'x')").run();
      db.close();
      return fs.readFileSync(f);
    })() }]);
    expect(() => stageRestore(t!.app, newer)).toThrow(/newer version/);
    expect(fs.existsSync(restore)).toBe(false);
  });

  it('applies a staged restore on the next build (WAL database)', async () => {
    t = await createTestApp();
    addSeries(t.app, 1);
    const b = createBackup(t.app, 'manual');
    addSeries(t.app, 2);
    addSeries(t.app, 3);
    expect(countSeries(t.app)).toBe(3);
    stageRestore(t.app, b.name);
    await t.app.close();
    const app2 = await buildApp({ dataDir: t.dataDir, metadataProvider: new FakeMetadataProvider(), scheduler: false });
    try {
      expect(countSeries(app2)).toBe(1);
      expect(fs.existsSync(path.join(t.dataDir, 'sonarr.db.pre-restore'))).toBe(true);
      expect(fs.existsSync(path.join(t.dataDir, 'restore', 'sonarr.db'))).toBe(false);
    } finally {
      await app2.close();
    }
    fs.rmSync(t.dataDir, { recursive: true, force: true });
  });

  it('registers the Backup command and creates a backup when run', async () => {
    t = await createTestApp();
    expect(t.app.commands.has('Backup')).toBe(true);
    t.app.commands.enqueue('Backup', { type: 'manual' });
    await t.app.commands.waitForIdle();
    expect(listBackups(t.app).map((b) => b.type)).toEqual(['manual']);
  });
});

describe('backup routes', () => {
  it('creates, lists, downloads and deletes', async () => {
    t = await createTestApp();
    const h = hdr(t.apiKey);
    const created = await t.app.inject({ method: 'POST', url: '/api/v3/system/backup', headers: h });
    expect(created.statusCode).toBe(201);
    const b = created.json<BackupResource>();
    expect(b.type).toBe('manual');
    const list = await t.app.inject({ url: '/api/v3/system/backup', headers: h });
    expect(list.json<BackupResource[]>().map((x) => x.name)).toEqual([b.name]);
    const dl = await t.app.inject({ url: `/api/v3/system/backup/${b.name}/download`, headers: h });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/zip');
    expect(dl.headers['content-disposition']).toContain(b.name);
    expect(readZip(dl.rawPayload).map((e) => e.name)).toContain('sonarr.db');
    const del = await t.app.inject({ method: 'DELETE', url: `/api/v3/system/backup/${b.name}`, headers: h });
    expect(del.statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/v3/system/backup', headers: h })).json()).toEqual([]);
  });

  it('404s unknown and traversal-looking names', async () => {
    t = await createTestApp();
    const h = hdr(t.apiKey);
    for (const name of ['nope.zip', '..%2F..%2Fsonarr.db', '%2e%2e%2fsonarr.db', '..']) {
      expect((await t.app.inject({ url: `/api/v3/system/backup/${name}/download`, headers: h })).statusCode).toBe(404);
      expect((await t.app.inject({ method: 'DELETE', url: `/api/v3/system/backup/${name}`, headers: h })).statusCode).toBe(404);
    }
    expect((await t.app.inject({ method: 'POST', url: '/api/v3/system/backup/restore/nope.zip', headers: h })).statusCode).toBe(404);
  });

  it('restores from a named backup and from uploads', async () => {
    t = await createTestApp();
    const h = hdr(t.apiKey);
    const b = createBackup(t.app, 'manual');
    const named = await t.app.inject({ method: 'POST', url: `/api/v3/system/backup/restore/${b.name}`, headers: h });
    expect(named.json()).toEqual({ restartRequired: true });
    const zip = fs.readFileSync(backupPath(t.app, b.name)!);
    fs.rmSync(path.join(t.dataDir, 'restore'), { recursive: true });

    const raw = await t.app.inject({
      method: 'POST',
      url: '/api/v3/system/backup/restore/upload',
      headers: { ...h, 'content-type': 'application/zip' },
      payload: zip,
    });
    expect(raw.json()).toEqual({ restartRequired: true });
    expect(fs.existsSync(path.join(t.dataDir, 'restore', 'sonarr.db'))).toBe(true);
    fs.rmSync(path.join(t.dataDir, 'restore'), { recursive: true });

    const boundary = 'XBOUNDARYX';
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      zip,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const mp = await t.app.inject({
      method: 'POST',
      url: '/api/v3/system/backup/restore/upload',
      headers: { ...h, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    expect(mp.json()).toEqual({ restartRequired: true });
    expect(fs.existsSync(path.join(t.dataDir, 'restore', 'sonarr.db'))).toBe(true);
    fs.rmSync(path.join(t.dataDir, 'restore'), { recursive: true });

    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v3/system/backup/restore/upload',
      headers: { ...h, 'content-type': 'application/zip' },
      payload: Buffer.from('this is not a zip'),
    });
    expect(bad.statusCode).toBe(400);
    expect(fs.existsSync(path.join(t.dataDir, 'restore', 'sonarr.db'))).toBe(false);
  });

  it('calls the injected lifecycle on restart and shutdown', async () => {
    t = await createTestApp();
    const lifecycle = { restart: vi.fn(), shutdown: vi.fn() };
    t.app.lifecycle = lifecycle;
    const h = hdr(t.apiKey);
    const r = await t.app.inject({ method: 'POST', url: '/api/v3/system/restart', headers: h });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('message');
    await vi.waitFor(() => expect(lifecycle.restart).toHaveBeenCalledTimes(1));
    expect(lifecycle.shutdown).not.toHaveBeenCalled();
    await t.app.inject({ method: 'POST', url: '/api/v3/system/shutdown', headers: h });
    await vi.waitFor(() => expect(lifecycle.shutdown).toHaveBeenCalledTimes(1));
  });

  it('requires authentication', async () => {
    t = await createTestApp();
    expect(getHostConfig(t.app.db).apiKey).toBeTruthy();
    const res = await t.app.inject({ method: 'POST', url: '/api/v3/system/restart' });
    expect([401, 403]).toContain(res.statusCode);
  });
});
