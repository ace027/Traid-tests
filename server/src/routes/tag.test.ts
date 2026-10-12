import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

describe('tag', () => {
  it('creates normalised tags and lists them', async () => {
    t = await createTestApp();
    const res = await req('POST', '/api/v3/tag', { label: '  Anime ' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ label: 'anime' });
    expect((await req('GET', '/api/v3/tag')).json()).toHaveLength(1);
    expect((await req('GET', `/api/v3/tag/${res.json().id}`)).json().label).toBe('anime');
  });

  it('rejects duplicates differing only by case', async () => {
    t = await createTestApp();
    await req('POST', '/api/v3/tag', { label: 'kids' });
    const res = await req('POST', '/api/v3/tag', { label: 'KIDS' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].propertyName).toBe('label');
  });

  it('rejects empty and invalid labels', async () => {
    t = await createTestApp();
    expect((await req('POST', '/api/v3/tag', { label: '   ' })).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/tag', { label: 'a!b' })).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/tag', {})).statusCode).toBe(400);
  });

  it('updates, deletes and 404s', async () => {
    t = await createTestApp();
    const a = (await req('POST', '/api/v3/tag', { label: 'a' })).json();
    const b = (await req('POST', '/api/v3/tag', { label: 'b' })).json();
    expect((await req('PUT', `/api/v3/tag/${a.id}`, { id: a.id, label: 'A2' })).json().label).toBe('a2');
    expect((await req('PUT', `/api/v3/tag/${a.id}`, { id: a.id, label: 'B' })).statusCode).toBe(400);
    expect((await req('PUT', `/api/v3/tag/${a.id}`, { id: a.id, label: 'a2' })).statusCode).toBe(200);
    expect((await req('PUT', '/api/v3/tag/999', { label: 'z' })).statusCode).toBe(404);
    expect((await req('DELETE', `/api/v3/tag/${b.id}`)).statusCode).toBe(200);
    expect((await req('DELETE', `/api/v3/tag/${b.id}`)).statusCode).toBe(404);
    expect((await req('GET', '/api/v3/tag/abc')).statusCode).toBe(404);
  });

  it('tag/detail returns empty usage arrays', async () => {
    t = await createTestApp();
    await req('POST', '/api/v3/tag', { label: 'x' });
    const [d] = (await req('GET', '/api/v3/tag/detail')).json();
    expect(d).toMatchObject({ label: 'x', seriesIds: [], notificationIds: [], indexerIds: [], downloadClientIds: [], importListIds: [], delayProfileIds: [], releaseProfileIds: [] });
  });
});
