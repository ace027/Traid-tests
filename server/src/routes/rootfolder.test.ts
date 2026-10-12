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
