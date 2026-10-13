import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, getHostConfig } from '../app.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
const tmp: string[] = [];
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const mk = (...parts: string[]) => {
  const base = tmp[0] ?? (tmp[0] = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')));
  const p = path.join(base, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

async function post(p: string) {
  return t!.app.inject({ method: 'POST', url: '/api/v3/rootfolder', headers: { 'x-api-key': t!.apiKey }, payload: { path: p } });
}

describe('rootfolder', () => {
  it('requires the api key', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ url: '/api/v3/rootfolder' })).statusCode).toBe(401);
  });

  it('creates, lists, gets and deletes', async () => {
    t = await createTestApp();
    const dir = mk('tv');
    const res = await post(dir);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ path: dir, accessible: true, unmappedFolders: [] });
    expect(typeof body.freeSpace).toBe('number');
    const h = { 'x-api-key': t.apiKey };
    expect((await t.app.inject({ url: '/api/v3/rootfolder', headers: h })).json()).toHaveLength(1);
    expect((await t.app.inject({ url: `/api/v3/rootfolder/${body.id}`, headers: h })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/v3/rootfolder/${body.id}`, headers: h })).statusCode).toBe(200);
    expect((await t.app.inject({ url: `/api/v3/rootfolder/${body.id}`, headers: h })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/v3/rootfolder/${body.id}`, headers: h })).statusCode).toBe(404);
  });

  it('rejects relative, missing, file, duplicate and nested paths', async () => {
    t = await createTestApp();
    const parent = mk('media');
    const child = mk('media', 'tv');
    const file = path.join(mk('files'), 'a.txt');
    fs.writeFileSync(file, 'x');
    for (const bad of ['relative/path', path.join(parent, 'missing'), file, '']) {
      const res = await post(bad);
      expect(res.statusCode, bad).toBe(400);
    }
    expect((await post('relative/path')).json().errors[0].propertyName).toBe('path');
    expect((await post(parent)).statusCode).toBe(201);
    expect((await post(parent + path.sep)).statusCode).toBe(400); // duplicate after normalisation
    const nested = await post(child);
    expect(nested.statusCode).toBe(400);
    expect(nested.json().errors[0].propertyName).toBe('path');
    await t.app.inject({ method: 'DELETE', url: '/api/v3/rootfolder/1', headers: { 'x-api-key': t.apiKey } });
    expect((await post(child)).statusCode).toBe(201);
    expect((await post(parent)).statusCode).toBe(400); // contains existing
  });

  it('persists across restart', async () => {
    t = await createTestApp();
    const dir = mk('persist');
    await post(dir);
    await t.app.close();
    const app2 = await buildApp({ dataDir: t.dataDir });
    const res = await app2.inject({ url: '/api/v3/rootfolder', headers: { 'x-api-key': getHostConfig(app2.db).apiKey } });
    expect(res.json()[0].path).toBe(dir);
    await app2.close();
    t = { ...t, cleanup: async () => fs.rmSync(t!.dataDir, { recursive: true, force: true }) };
  });
});

describe('unmapped folders (library import)', () => {
  const api = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

  it('lists subdirectories that are not series paths, skipping system folders, sorted', async () => {
    t = await createTestApp();
    const lib = mk('lib');
    for (const d of ['Zeta Show (2001)', 'Alpha Show', '.hidden', '@eaDir', '#recycle', '$RECYCLE.BIN', 'System Volume Information', 'lost+found']) mk('lib', d);
    fs.writeFileSync(path.join(lib, 'notes.txt'), 'file, not a folder');
    const mapped = mk('lib', 'Fake Show (2020)');
    expect((await post(lib)).statusCode).toBe(201);
    const profileId = (await api('GET', '/api/v3/qualityprofile')).json()[0].id as number;
    const add = await api('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: profileId, rootFolderPath: lib });
    expect(add.json().path).toBe(mapped);

    const [rf] = (await api('GET', '/api/v3/rootfolder')).json();
    expect(rf.unmappedFolders).toEqual([
      { name: 'Alpha Show', path: path.join(lib, 'Alpha Show'), relativePath: 'Alpha Show' },
      { name: 'Zeta Show (2001)', path: path.join(lib, 'Zeta Show (2001)'), relativePath: 'Zeta Show (2001)' },
    ]);
    const one = (await api('GET', `/api/v3/rootfolder/${rf.id}`)).json();
    expect(one.unmappedFolders).toHaveLength(2);
  });

  it('removes a folder from the list once a series uses it, and the rescan links its files', async () => {
    t = await createTestApp();
    const lib = mk('lib2');
    const existing = mk('lib2', 'Fake Show');
    fs.mkdirSync(path.join(existing, 'Season 1'));
    fs.writeFileSync(path.join(existing, 'Season 1', 'Fake.Show.S01E01.720p.HDTV.mkv'), 'data');
    expect((await post(lib)).statusCode).toBe(201);
    const profileId = (await api('GET', '/api/v3/qualityprofile')).json()[0].id as number;

    const before = (await api('GET', '/api/v3/rootfolder')).json()[0];
    expect(before.unmappedFolders.map((f: { name: string }) => f.name)).toEqual(['Fake Show']);

    const add = await api('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: profileId, path: existing });
    expect(add.statusCode).toBe(201);
    expect(add.json().path).toBe(existing);
    await t.app.commands.waitForIdle();

    const after = (await api('GET', '/api/v3/rootfolder')).json()[0];
    expect(after.unmappedFolders).toEqual([]);
    const files = (await api('GET', `/api/v3/episodefile?seriesId=${add.json().id}`)).json();
    expect(files).toHaveLength(1);
    expect(files[0].quality.quality.name).toBe('HDTV-720p');
  });

  it('caps the list for root folders with thousands of subfolders', async () => {
    t = await createTestApp();
    const lib = mk('lib3');
    for (let i = 0; i < 5100; i++) fs.mkdirSync(path.join(lib, `show-${String(i).padStart(5, '0')}`));
    expect((await post(lib)).statusCode).toBe(201);
    const [rf] = (await api('GET', '/api/v3/rootfolder')).json();
    expect(rf.unmappedFolders).toHaveLength(5000);
    expect(rf.unmappedFolders[0].name).toBe('show-00000');
  });
});
