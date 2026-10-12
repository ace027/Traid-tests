import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, getHostConfig } from '../app.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

describe('qualitydefinition', () => {
  it('seeds defaults and updates one', async () => {
    t = await createTestApp();
    const list = (await req('GET', '/api/v3/qualitydefinition')).json();
    expect(list).toHaveLength(21);
    const def = list[3];
    const res = await req('PUT', `/api/v3/qualitydefinition/${def.id}`, { ...def, minSize: 5, preferredSize: 50, maxSize: 100 });
    expect(res.statusCode).toBe(200);
    expect((await req('GET', `/api/v3/qualitydefinition/${def.id}`)).json()).toMatchObject({ minSize: 5, maxSize: 100 });
  });

  it('validates ordering and range, and 404s', async () => {
    t = await createTestApp();
    const def = (await req('GET', '/api/v3/qualitydefinition/1')).json();
    expect((await req('PUT', '/api/v3/qualitydefinition/1', { ...def, minSize: 50, maxSize: 10, preferredSize: null })).statusCode).toBe(400);
    expect((await req('PUT', '/api/v3/qualitydefinition/1', { ...def, minSize: 1, maxSize: 10, preferredSize: 20 })).statusCode).toBe(400);
    expect((await req('PUT', '/api/v3/qualitydefinition/1', { ...def, minSize: 1, maxSize: 2000, preferredSize: null })).statusCode).toBe(400);
    expect((await req('PUT', '/api/v3/qualitydefinition/1', { ...def, minSize: -1 })).statusCode).toBe(400);
    expect((await req('PUT', '/api/v3/qualitydefinition/999', def)).statusCode).toBe(404);
    expect((await req('GET', '/api/v3/qualitydefinition/999')).statusCode).toBe(404);
  });

  it('bulk updates atomically-validated', async () => {
    t = await createTestApp();
    const [a, b] = (await req('GET', '/api/v3/qualitydefinition')).json();
    const ok = await req('PUT', '/api/v3/qualitydefinition/update', [{ ...a, minSize: 3 }, { ...b, minSize: 4 }]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().map((d: { minSize: number }) => d.minSize)).toEqual([3, 4]);
    const bad = await req('PUT', '/api/v3/qualitydefinition/update', [{ ...a, minSize: 9 }, { ...b, minSize: 50, maxSize: 10 }]);
    expect(bad.statusCode).toBe(400);
    expect((await req('GET', `/api/v3/qualitydefinition/${a.id}`)).json().minSize).toBe(3);
  });
});

describe('qualityprofile', () => {
  it('seeds default profiles in Sonarr shape', async () => {
    t = await createTestApp();
    const list = (await req('GET', '/api/v3/qualityprofile')).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(['Any', 'SD', 'HD-720p', 'HD-1080p', 'Ultra-HD', 'HD - 720p/1080p']);
    expect(list[0].items[1]).toMatchObject({ quality: { id: 1, name: 'SDTV', source: 'television', resolution: 480 }, items: [], allowed: true });
  });

  it('schema returns a blank template', async () => {
    t = await createTestApp();
    const s = (await req('GET', '/api/v3/qualityprofile/schema')).json();
    expect(s.cutoff).toBe(0);
    expect(s.items.every((i: { allowed: boolean }) => !i.allowed)).toBe(true);
    expect(s.items).toHaveLength(21);
  });

  it('creates, updates, deletes', async () => {
    t = await createTestApp();
    const s = (await req('GET', '/api/v3/qualityprofile/schema')).json();
    s.name = 'Mine';
    s.items[2].allowed = true;
    s.cutoff = s.items[2].quality.id;
    const created = await req('POST', '/api/v3/qualityprofile', s);
    expect(created.statusCode).toBe(201);
    const p = created.json();
    expect(p.name).toBe('Mine');
    const upd = await req('PUT', `/api/v3/qualityprofile/${p.id}`, { ...p, name: 'Mine2' });
    expect(upd.json().name).toBe('Mine2');
    expect((await req('DELETE', `/api/v3/qualityprofile/${p.id}`)).statusCode).toBe(200);
    expect((await req('GET', `/api/v3/qualityprofile/${p.id}`)).statusCode).toBe(404);
    expect((await req('PUT', '/api/v3/qualityprofile/999', p)).statusCode).toBe(404);
    expect((await req('DELETE', '/api/v3/qualityprofile/999')).statusCode).toBe(404);
  });

  it('rejects cutoff not allowed, none allowed, duplicate name', async () => {
    t = await createTestApp();
    const s = (await req('GET', '/api/v3/qualityprofile/schema')).json();
    s.name = 'Bad';
    expect((await req('POST', '/api/v3/qualityprofile', s)).statusCode).toBe(400);
    s.items[2].allowed = true;
    s.cutoff = s.items[3].quality.id;
    const res = await req('POST', '/api/v3/qualityprofile', s);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].propertyName).toBe('cutoff');
    s.cutoff = s.items[2].quality.id;
    s.name = 'Any';
    expect((await req('POST', '/api/v3/qualityprofile', s)).statusCode).toBe(400);
  });

  it('refuses deleting the last profile', async () => {
    t = await createTestApp();
    const list = (await req('GET', '/api/v3/qualityprofile')).json();
    for (const p of list.slice(1)) expect((await req('DELETE', `/api/v3/qualityprofile/${p.id}`)).statusCode).toBe(200);
    const res = await req('DELETE', `/api/v3/qualityprofile/${list[0].id}`);
    expect(res.statusCode).toBe(400);
    expect((await req('GET', '/api/v3/qualityprofile')).json()).toHaveLength(1);
  });

  it('persists and does not reseed after restart', async () => {
    t = await createTestApp();
    await req('DELETE', '/api/v3/qualityprofile/2');
    const def = (await req('GET', '/api/v3/qualitydefinition/1')).json();
    await req('PUT', '/api/v3/qualitydefinition/1', { ...def, minSize: 7 });
    await t.app.close();
    const app2 = await buildApp({ dataDir: t.dataDir });
    const h = { 'x-api-key': getHostConfig(app2.db).apiKey };
    expect((await app2.inject({ url: '/api/v3/qualityprofile', headers: h })).json()).toHaveLength(5);
    expect((await app2.inject({ url: '/api/v3/qualitydefinition/1', headers: h })).json().minSize).toBe(7);
    await app2.close();
    t = { ...t, cleanup: async () => fs.rmSync(t!.dataDir, { recursive: true, force: true }) };
  });
});
