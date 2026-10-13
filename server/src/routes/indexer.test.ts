import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIndexerClients, recordFailure, recordSuccess, resetIndexerBackoff, setIndexerClientFactory } from '../indexers/registry.js';
import { IndexerError } from '../indexers/types.js';
import { FakeIndexerClient } from '../test/fakeIndexer.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
let fake: FakeIndexerClient;
beforeEach(() => {
  fake = new FakeIndexerClient();
  setIndexerClientFactory(() => fake);
  resetIndexerBackoff();
});
afterEach(async () => {
  setIndexerClientFactory(undefined);
  resetIndexerBackoff();
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

const body = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) => ({
  name: 'NZB',
  implementation: 'Newznab',
  settings: { baseUrl: 'http://idx.test', apiKey: 'realkey', ...settings },
  ...over,
});

describe('indexer api', () => {
  it('creates, masks, lists, updates and deletes', async () => {
    t = await createTestApp();
    const res = await req('POST', '/api/v3/indexer', body());
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created).toMatchObject({ implementation: 'Newznab', protocol: 'usenet', priority: 25, enableRss: true });
    expect(created.settings).toMatchObject({ apiKey: '********', categories: [5030, 5040], apiPath: '/api' });
    expect((await req('GET', '/api/v3/indexer')).json()).toHaveLength(1);
    expect((await req('GET', `/api/v3/indexer/${created.id}`)).json().settings.apiKey).toBe('********');

    // masked PUT keeps the stored key
    const put = await req('PUT', `/api/v3/indexer/${created.id}`, body({ priority: 5 }, { apiKey: '********' }));
    expect(put.statusCode).toBe(200);
    expect(put.json().priority).toBe(5);
    const stored = JSON.parse(
      (t.app.sqlite.prepare('select settings from indexers where id = ?').get(created.id) as { settings: string }).settings,
    );
    expect(stored.apiKey).toBe('realkey');
    // a new key replaces it
    await req('PUT', `/api/v3/indexer/${created.id}`, body({}, { apiKey: 'other' }));
    const stored2 = JSON.parse(
      (t.app.sqlite.prepare('select settings from indexers where id = ?').get(created.id) as { settings: string }).settings,
    );
    expect(stored2.apiKey).toBe('other');

    expect((await req('PUT', '/api/v3/indexer/999', body())).statusCode).toBe(404);
    expect((await req('DELETE', `/api/v3/indexer/${created.id}`)).statusCode).toBe(200);
    expect((await req('GET', `/api/v3/indexer/${created.id}`)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/v3/indexer/${created.id}`)).statusCode).toBe(404);
  });

  it('validates input', async () => {
    t = await createTestApp();
    await req('POST', '/api/v3/indexer', body());
    const dup = await req('POST', '/api/v3/indexer', body());
    expect(dup.statusCode).toBe(400);
    expect(dup.json().errors[0].propertyName).toBe('name');
    expect((await req('POST', '/api/v3/indexer', body({ name: 'B' }, { baseUrl: 'ftp://x' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/indexer', body({ name: 'C', priority: 51 }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/indexer', body({ name: 'D', priority: 0 }))).statusCode).toBe(400);
    const tags = await req('POST', '/api/v3/indexer', body({ name: 'E', tags: [42] }));
    expect(tags.statusCode).toBe(400);
    expect(tags.json().errors[0].propertyName).toBe('tags');
    const tag = (await req('POST', '/api/v3/tag', { label: 'x' })).json();
    expect((await req('POST', '/api/v3/indexer', body({ name: 'F', tags: [tag.id] }))).statusCode).toBe(201);
  });

  it('serves the schema', async () => {
    t = await createTestApp();
    const schema = (await req('GET', '/api/v3/indexer/schema')).json();
    expect(schema.map((s: { implementation: string }) => s.implementation)).toEqual(['Newznab', 'Torznab']);
    expect(schema[0].settings).toMatchObject({ categories: [5030, 5040], animeCategories: [5070] });
    expect(schema[1].settings).toMatchObject({ categories: [5000], animeCategories: [5070], minimumSeeders: 1 });
  });

  it('tests an indexer, success and failure', async () => {
    t = await createTestApp();
    const ok = await req('POST', '/api/v3/indexer/test', body());
    expect(ok.statusCode).toBe(200);
    expect(fake.calls).toEqual([{ method: 'test' }]);
    fake.error = new IndexerError('Invalid API key');
    const bad = await req('POST', '/api/v3/indexer/test', body());
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ message: 'Invalid API key' });
    fake.error = new Error('failed http://idx.test/api?apikey=realkey&t=caps');
    const leaky = await req('POST', '/api/v3/indexer/test', body());
    expect(leaky.json().message).not.toContain('realkey');
  });

  it('testall reports per indexer and feeds backoff', async () => {
    t = await createTestApp();
    const a = (await req('POST', '/api/v3/indexer', body({ name: 'A' }))).json();
    expect((await req('POST', '/api/v3/indexer/testall')).json()).toEqual([{ id: a.id, isValid: true, validationFailures: [] }]);
    fake.error = new Error('down');
    const res = (await req('POST', '/api/v3/indexer/testall')).json();
    expect(res[0]).toMatchObject({ id: a.id, isValid: false, validationFailures: [{ errorMessage: 'down' }] });
    const status = (await req('GET', '/api/v3/indexerstatus')).json();
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ indexerId: a.id });
    expect(status[0].disabledTill).toBeTruthy();
  });

  it('backs off failing indexers and recovers on success', async () => {
    t = await createTestApp();
    const a = (await req('POST', '/api/v3/indexer', body({ name: 'A', priority: 30 }))).json();
    const b = (await req('POST', '/api/v3/indexer', body({ name: 'B', priority: 10, enableRss: false }))).json();
    const ids = (purpose: 'rss' | 'automatic' | 'interactive', now?: number) =>
      getIndexerClients(t!.app, { purpose, now }).map((c) => c.row.id);
    expect(ids('rss')).toEqual([a.id]);
    expect(ids('automatic')).toEqual([b.id, a.id]);

    const now = Date.now();
    recordFailure(a.id, 'x', now);
    expect(ids('rss', now + 60_000)).toEqual([]);
    expect(ids('rss', now + 6 * 60_000)).toEqual([a.id]); // first backoff is 5 minutes
    recordFailure(a.id, 'x', now);
    expect(ids('rss', now + 6 * 60_000)).toEqual([]); // second is 15 minutes
    recordSuccess(a.id);
    expect(ids('rss', now + 60_000)).toEqual([a.id]);
  });
});
