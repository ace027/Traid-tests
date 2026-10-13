import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { schema } from '../db/index.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'PUT', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

describe('media management config', () => {
  it('returns defaults', async () => {
    t = await createTestApp();
    expect((await req('GET', '/api/v3/config/mediamanagement')).json()).toMatchObject({
      recycleBin: '',
      recycleBinCleanupDays: 7,
      downloadPropersAndRepacks: 'preferAndUpgrade',
      copyUsingHardlinks: true,
      minimumFreeSpaceWhenImporting: 100,
      extraFileExtensions: 'srt,nfo',
      chmodFolder: '755',
    });
  });

  it('persists updates, across a rebuild too', async () => {
    t = await createTestApp();
    const res = await req('PUT', '/api/v3/config/mediamanagement', { recycleBin: '/tmp/bin', deleteEmptyFolders: true, fileDate: 'utcAirDate' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ recycleBin: '/tmp/bin', deleteEmptyFolders: true, copyUsingHardlinks: true });
    const dataDir = t.dataDir;
    await t.app.close();
    const app = await buildApp({ dataDir, scheduler: false });
    try {
      const r = await app.inject({ method: 'GET', url: '/api/v3/config/mediamanagement', headers: { 'x-api-key': t.apiKey } });
      expect(r.json()).toMatchObject({ recycleBin: '/tmp/bin', deleteEmptyFolders: true, fileDate: 'utcAirDate' });
    } finally {
      await app.close();
    }
    t = { ...t, app: await buildApp({ dataDir, scheduler: false }) };
  });

  it('validates fields', async () => {
    t = await createTestApp();
    for (const [body, prop] of [
      [{ chmodFolder: '999' }, 'chmodFolder'],
      [{ chmodFolder: 'rwx' }, 'chmodFolder'],
      [{ recycleBin: 'relative/path' }, 'recycleBin'],
      [{ recycleBinCleanupDays: 366 }, 'recycleBinCleanupDays'],
      [{ minimumFreeSpaceWhenImporting: -1 }, 'minimumFreeSpaceWhenImporting'],
    ] as const) {
      const res = await req('PUT', '/api/v3/config/mediamanagement', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().errors[0].propertyName).toBe(prop);
    }
  });

  it('falls back to defaults for a corrupt row', async () => {
    t = await createTestApp();
    t.app.db.insert(schema.config).values({ key: 'mediamanagement', value: '{not json' }).run();
    expect((await req('GET', '/api/v3/config/mediamanagement')).json().recycleBinCleanupDays).toBe(7);
    t.app.db.update(schema.config).set({ value: JSON.stringify({ chmodFolder: 'zzz' }) }).run();
    expect((await req('GET', '/api/v3/config/mediamanagement')).json().chmodFolder).toBe('755');
  });

  it('publishes a config event', async () => {
    t = await createTestApp();
    const seen: unknown[] = [];
    const orig = t.app.events.publish.bind(t.app.events);
    t.app.events.publish = ((...a: Parameters<typeof orig>) => {
      seen.push(a);
      return orig(...a);
    }) as typeof orig;
    await req('PUT', '/api/v3/config/mediamanagement', { deleteEmptyFolders: true });
    expect(seen).toContainEqual(['config', 'updated', { name: 'mediamanagement' }]);
  });
});

describe('naming config', () => {
  it('returns defaults and persists updates', async () => {
    t = await createTestApp();
    expect((await req('GET', '/api/v3/config/naming')).json()).toMatchObject({
      renameEpisodes: true,
      colonReplacementFormat: 'smart',
      multiEpisodeStyle: 'prefixedRange',
      seriesFolderFormat: '{Series TitleYear}',
    });
    const res = await req('PUT', '/api/v3/config/naming', { multiEpisodeStyle: 'extend', seasonFolderFormat: 'S{season:0}' });
    expect(res.statusCode).toBe(200);
    expect((await req('GET', '/api/v3/config/naming')).json()).toMatchObject({ multiEpisodeStyle: 'extend', seasonFolderFormat: 'S{season:0}' });
  });

  it('rejects empty, unknown and invalid formats', async () => {
    t = await createTestApp();
    const empty = await req('PUT', '/api/v3/config/naming', { standardEpisodeFormat: '' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().errors[0].propertyName).toBe('standardEpisodeFormat');
    const unknown = await req('PUT', '/api/v3/config/naming', { standardEpisodeFormat: '{Series Title} {Bogus}' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().errors.map((e: { propertyName: string }) => e.propertyName)).toContain('standardEpisodeFormat');
    expect((await req('PUT', '/api/v3/config/naming', { colonReplacementFormat: 'x' })).statusCode).toBe(400);
    expect((await req('GET', '/api/v3/config/naming')).json().standardEpisodeFormat).toContain('{Series Title}');
  });

  it('previews unsaved formats and falls back to the saved config', async () => {
    t = await createTestApp();
    const saved = (await req('GET', '/api/v3/config/naming/examples')).json();
    expect(saved.singleEpisodeExample).toBe('The Series Title! - S01E01 - Episode Title (1) HDTV-720p');
    const q = new URLSearchParams({ standardEpisodeFormat: '{Series.Title}.S{season:00}E{episode:00}' });
    const preview = (await req('GET', `/api/v3/config/naming/examples?${q}`)).json();
    expect(preview.singleEpisodeExample).toBe('The.Series.Title!.S01E01');
    expect(preview.seasonFolderExample).toBe('Season 01');
  });
});

describe('download client config', () => {
  it('returns defaults and persists updates', async () => {
    t = await createTestApp();
    expect((await req('GET', '/api/v3/config/downloadclient')).json()).toEqual({ enableCompletedDownloadHandling: true, autoRedownloadFailed: true });
    await req('PUT', '/api/v3/config/downloadclient', { autoRedownloadFailed: false });
    expect((await req('GET', '/api/v3/config/downloadclient')).json()).toEqual({ enableCompletedDownloadHandling: true, autoRedownloadFailed: false });
    expect((await req('PUT', '/api/v3/config/downloadclient', { autoRedownloadFailed: 'yes' })).statusCode).toBe(400);
  });
});
