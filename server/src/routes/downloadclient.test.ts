import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { FakeDownloadClient } from '../test/fakeDownloadClient.js';
import { pickClient, resetClientRotation, setDownloadClientFactory } from '../downloadClients/registry.js';

let t: TestApp | undefined;
afterEach(async () => {
  setDownloadClientFactory(null);
  resetClientRotation();
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

const body = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) => ({
  name: 'SAB',
  implementation: 'SABnzbd',
  settings: { host: 'sab.local', port: 8080, apiKey: 'key-123', password: 'pw-123', ...settings },
  ...over,
});

describe('download client API', () => {
  it('creates, lists, masks and fetches', async () => {
    t = await createTestApp();
    const created = await req('POST', '/api/v3/downloadclient', body());
    expect(created.statusCode).toBe(201);
    const c = created.json();
    expect(c).toMatchObject({ implementation: 'SABnzbd', protocol: 'usenet', enable: true, priority: 1, tags: [] });
    expect(c.settings).toMatchObject({ host: 'sab.local', port: 8080, apiKey: '********', password: '********', category: 'tv' });
    const list = (await req('GET', '/api/v3/downloadclient')).json();
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('key-123');
    expect(JSON.stringify(list)).not.toContain('pw-123');
    expect((await req('GET', `/api/v3/downloadclient/${c.id}`)).json().settings.apiKey).toBe('********');
    expect((await req('GET', '/api/v3/downloadclient/999')).statusCode).toBe(404);
    const row = t.app.sqlite.prepare('select implementation, protocol, settings from download_clients').get() as { implementation: string; protocol: string; settings: string };
    expect(row.implementation).toBe('sabnzbd');
    expect(JSON.parse(row.settings).apiKey).toBe('key-123');
  });

  it('validates input', async () => {
    t = await createTestApp();
    expect((await req('POST', '/api/v3/downloadclient', body({}, { host: '' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/downloadclient', body({}, { port: 0 }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/downloadclient', body({}, { port: 65536 }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/downloadclient', body({ implementation: 'Bogus' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/downloadclient', body({ tags: [42] }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/downloadclient', body())).statusCode).toBe(201);
    const dup = await req('POST', '/api/v3/downloadclient', body());
    expect(dup.statusCode).toBe(400);
    expect(dup.json().errors[0].propertyName).toBe('name');
  });

  it('updates keeping masked secrets, and deletes', async () => {
    t = await createTestApp();
    const tag = (await req('POST', '/api/v3/tag', { label: 'kids' })).json();
    const c = (await req('POST', '/api/v3/downloadclient', body())).json();
    const put = await req('PUT', `/api/v3/downloadclient/${c.id}`, body({ priority: 5, tags: [tag.id] }, { apiKey: '********', password: '********', host: 'new.local' }));
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ priority: 5, tags: [tag.id], settings: { host: 'new.local', apiKey: '********' } });
    const stored = JSON.parse((t.app.sqlite.prepare('select settings from download_clients').get() as { settings: string }).settings);
    expect(stored).toMatchObject({ apiKey: 'key-123', password: 'pw-123', host: 'new.local' });
    await req('PUT', `/api/v3/downloadclient/${c.id}`, body({}, { apiKey: 'changed', password: '' }));
    const stored2 = JSON.parse((t.app.sqlite.prepare('select settings from download_clients').get() as { settings: string }).settings);
    expect(stored2).toMatchObject({ apiKey: 'changed', password: '' });
    expect((await req('PUT', '/api/v3/downloadclient/999', body())).statusCode).toBe(404);
    expect((await req('DELETE', `/api/v3/downloadclient/${c.id}`)).statusCode).toBe(200);
    expect((await req('DELETE', `/api/v3/downloadclient/${c.id}`)).statusCode).toBe(404);
  });

  it('publishes events', async () => {
    t = await createTestApp();
    const seen: string[] = [];
    t.app.events.subscribe((e) => seen.push(`${e.name}:${e.action}`));
    const c = (await req('POST', '/api/v3/downloadclient', body())).json();
    await req('PUT', `/api/v3/downloadclient/${c.id}`, body());
    await req('DELETE', `/api/v3/downloadclient/${c.id}`);
    expect(seen).toEqual(['downloadclient:created', 'downloadclient:updated', 'downloadclient:deleted']);
  });

  it('serves schema templates with defaults', async () => {
    t = await createTestApp();
    const schema = (await req('GET', '/api/v3/downloadclient/schema')).json() as {
      implementation: string;
      protocol: string;
      settings: Record<string, unknown>;
    }[];
    const by = Object.fromEntries(schema.map((s) => [s.implementation, s]));
    expect(Object.keys(by).sort()).toEqual(['NZBGet', 'QBittorrent', 'SABnzbd', 'Transmission']);
    expect(by.SABnzbd).toMatchObject({ protocol: 'usenet', settings: { port: 8080, category: 'tv' } });
    expect(by.NZBGet).toMatchObject({ protocol: 'usenet', settings: { port: 6789, username: 'nzbget', category: 'tv' } });
    expect(by.QBittorrent).toMatchObject({ protocol: 'torrent', settings: { port: 8080, category: 'tv-sonarr' } });
    expect(by.Transmission).toMatchObject({ protocol: 'torrent', settings: { port: 9091, urlBase: '/transmission/', category: 'tv-sonarr' } });
  });

  it('tests a client through the factory, resolving masked secrets', async () => {
    t = await createTestApp();
    const fake = new FakeDownloadClient();
    const seen: { implementation: string; apiKey: string }[] = [];
    setDownloadClientFactory((cfg) => {
      seen.push({ implementation: cfg.implementation, apiKey: cfg.settings.apiKey });
      return fake;
    });
    expect((await req('POST', '/api/v3/downloadclient/test', body())).statusCode).toBe(200);
    expect(seen[0]).toEqual({ implementation: 'SABnzbd', apiKey: 'key-123' });
    const c = (await req('POST', '/api/v3/downloadclient', body())).json();
    await req('POST', '/api/v3/downloadclient/test', { ...body({ id: c.id }, { apiKey: '********' }) });
    expect(seen[1]!.apiKey).toBe('key-123');

    fake.failure = 'Authentication failed: check the API key';
    const bad = await req('POST', '/api/v3/downloadclient/test', body());
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0].errorMessage).toBe('Authentication failed: check the API key');
  });

  it('tests all clients', async () => {
    t = await createTestApp();
    const good = new FakeDownloadClient();
    const bad = new FakeDownloadClient();
    bad.failure = 'down';
    await req('POST', '/api/v3/downloadclient', body({ name: 'a' }, { host: 'good' }));
    await req('POST', '/api/v3/downloadclient', body({ name: 'b' }, { host: 'bad' }));
    setDownloadClientFactory((cfg) => (cfg.settings.host === 'bad' ? bad : good));
    const res = await req('POST', '/api/v3/downloadclient/testall');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual([
      { id: 1, isValid: true, validationFailures: [] },
      { id: 2, isValid: false, validationFailures: [{ propertyName: '', errorMessage: 'down' }] },
    ]);
    setDownloadClientFactory(() => good);
    expect((await req('POST', '/api/v3/downloadclient/testall')).statusCode).toBe(200);
  });
});

describe('pickClient', () => {
  async function add(name: string, implementation: string, extra: Record<string, unknown> = {}) {
    const res = await req('POST', '/api/v3/downloadclient', body({ name, implementation, ...extra }));
    expect(res.statusCode).toBe(201);
    return res.json().id as number;
  }

  it('filters by protocol and enabled state', async () => {
    t = await createTestApp();
    await add('sab', 'SABnzbd');
    await add('off', 'QBittorrent', { enable: false });
    expect(pickClient(t.app.db, 'usenet', [])?.name).toBe('sab');
    expect(pickClient(t.app.db, 'torrent', [])).toBeNull();
  });

  it('prefers the lowest priority value', async () => {
    t = await createTestApp();
    await add('low', 'SABnzbd', { priority: 10 });
    await add('high', 'NZBGet', { priority: 2 });
    expect(pickClient(t.app.db, 'usenet', [])?.name).toBe('high');
    expect(pickClient(t.app.db, 'usenet', [])?.name).toBe('high');
  });

  it('applies the tag rule', async () => {
    t = await createTestApp();
    const tag = (await req('POST', '/api/v3/tag', { label: 'a' })).json().id as number;
    const other = (await req('POST', '/api/v3/tag', { label: 'b' })).json().id as number;
    await add('plain', 'SABnzbd', { priority: 1 });
    await add('tagged', 'NZBGet', { priority: 5, tags: [tag] });
    expect(pickClient(t.app.db, 'usenet', [tag])?.name).toBe('tagged');
    expect(pickClient(t.app.db, 'usenet', [])?.name).toBe('plain');
    expect(pickClient(t.app.db, 'usenet', [other])?.name).toBe('plain');
    // a tagged client alone is never used for untagged series
    await req('DELETE', '/api/v3/downloadclient/1');
    expect(pickClient(t.app.db, 'usenet', [])).toBeNull();
    expect(pickClient(t.app.db, 'usenet', [other])).toBeNull();
  });

  it('round-robins equal priorities', async () => {
    t = await createTestApp();
    await add('a', 'SABnzbd');
    await add('b', 'NZBGet');
    await add('c', 'NZBGet', { priority: 9 });
    const picks = [1, 2, 3, 4].map(() => pickClient(t!.app.db, 'usenet', [])?.name);
    expect(picks).toEqual(['a', 'b', 'a', 'b']);
  });
});
