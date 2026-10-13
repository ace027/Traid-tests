import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseResource } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { resetClientRotation, setDownloadClientFactory } from '../downloadClients/registry.js';
import { resetIndexerBackoff, setIndexerClientFactory } from '../indexers/registry.js';
import { FakeDownloadClient } from '../test/fakeDownloadClient.js';
import { FakeIndexerClient, makeRelease } from '../test/fakeIndexer.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { RELEASE_CACHE_MISS, RELEASE_CACHE_TTL_MS, ReleaseCache } from './release.js';

let t: TestApp;
let root: string;
let seriesId: number;
let indexerId: number;
let fake: FakeIndexerClient;
let sab: FakeDownloadClient;

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { 'x-api-key': t.apiKey }, payload: payload as object });

const epId = (season: number, episode: number) =>
  t.app.db.select().from(schema.episodes).all().find((e) => e.seriesId === seriesId && e.seasonNumber === season && e.episodeNumber === episode)!.id;

const grabbed = () => t.app.db.select().from(schema.history).all().filter((h) => h.eventType === 'grabbed');

beforeEach(async () => {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profiles = (await req('GET', '/api/v3/qualityprofile')).json() as { id: number; name: string }[];
  const hd = profiles.find((p) => p.name === 'HD-1080p')!.id;
  seriesId = (await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: hd, rootFolderPath: root })).json().id;
  fake = new FakeIndexerClient();
  setIndexerClientFactory(() => fake);
  indexerId = t.app.db
    .insert(schema.indexers)
    .values({ name: 'geek', implementation: 'newznab', settings: JSON.stringify({ baseUrl: 'http://geek', apiKey: 'secret' }), added: new Date().toISOString() })
    .returning()
    .get().id;
  sab = new FakeDownloadClient('sab');
  setDownloadClientFactory(() => sab);
  await req('POST', '/api/v3/downloadclient', { name: 'sab', implementation: 'SABnzbd', settings: { host: 'sab', port: 1 } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  setIndexerClientFactory(undefined);
  setDownloadClientFactory(null);
  resetIndexerBackoff();
  resetClientRotation();
  await t.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('GET /api/v3/release', () => {
  it('runs an interactive episode search and lists approved and rejected releases', async () => {
    fake.releases = [
      makeRelease({ title: 'Fake.Show.S01E01.720p.HDTV-AAA', guid: 'hdtv', downloadUrl: 'http://geek/api?t=get&id=1&apikey=secret' }),
      makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-BBB', guid: 'webdl', publishDate: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
      makeRelease({ title: 'Fake.Show.S01E02.1080p.WEB-DL-CCC', guid: 'other' }),
      makeRelease({ title: 'Garbage', guid: 'junk' }),
    ];
    const res = await req('GET', `/api/v3/release?episodeId=${epId(1, 1)}`);
    expect(res.statusCode).toBe(200);
    const list = res.json() as ReleaseResource[];
    expect(list.map((r) => r.guid)).toEqual(['webdl', 'other', 'hdtv', 'junk']);
    const [approved, other, hdtv, junk] = list;
    expect(approved).toMatchObject({
      approved: true,
      rejected: false,
      temporarilyRejected: false,
      rejections: [],
      indexerId,
      indexer: 'geek',
      seriesId,
      seriesTitle: 'Fake Show',
      episodeIds: [epId(1, 1)],
      seasonNumber: 1,
      episodeNumbers: [1],
      releaseGroup: 'BBB',
      qualityWeight: 14,
      downloadAllowed: true,
      age: 2,
      protocol: 'usenet',
    });
    expect(approved!.quality.quality.name).toBe('WEBDL-1080p');
    expect(approved!.ageHours).toBeGreaterThanOrEqual(48);
    expect(hdtv).toMatchObject({ approved: false, rejected: true, rejections: ['Quality HDTV-720p is not wanted in profile'] });
    expect(hdtv!.downloadUrl).toBe('http://geek/api?t=get&id=1');
    expect(JSON.stringify(list)).not.toContain('secret');
    expect(other).toMatchObject({ rejections: ["Episode wasn't requested"], downloadAllowed: true });
    expect(junk).toMatchObject({ rejections: ['Unable to parse release'], downloadAllowed: false, episodeIds: [] });
    expect(fake.calls).toEqual([{ method: 'search', criteria: expect.objectContaining({ type: 'episode', episodeNumbers: [1] }) }]);
  });

  it('skips the monitored checks for the requested episode', async () => {
    t.app.sqlite.prepare('update episodes set monitored = 0 where id = ?').run(epId(1, 1));
    fake.releases = [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-BBB' })];
    const [r] = (await req('GET', `/api/v3/release?episodeId=${epId(1, 1)}`)).json() as ReleaseResource[];
    expect(r!.approved).toBe(true);
  });

  it('runs an interactive season search', async () => {
    fake.releases = [makeRelease({ title: 'Fake.Show.S01.1080p.WEB-DL-AAA', size: 3 * 1024 ** 3, guid: 'pack' })];
    const list = (await req('GET', `/api/v3/release?seriesId=${seriesId}&seasonNumber=1`)).json() as ReleaseResource[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ guid: 'pack', fullSeason: true, approved: true, episodeIds: [epId(1, 1), epId(1, 2)] });
    expect(fake.calls).toEqual([{ method: 'search', criteria: expect.objectContaining({ type: 'season', seasonNumber: 1 }) }]);
  });

  it('validates the query', async () => {
    expect((await req('GET', '/api/v3/release')).statusCode).toBe(400);
    expect((await req('GET', `/api/v3/release?seriesId=${seriesId}`)).statusCode).toBe(400);
    expect((await req('GET', '/api/v3/release?episodeId=99999')).statusCode).toBe(404);
    expect((await req('GET', '/api/v3/release?seriesId=99999&seasonNumber=1')).statusCode).toBe(404);
  });

  it('returns an empty list when every indexer fails', async () => {
    fake.error = new Error('down');
    const res = await req('GET', `/api/v3/release?episodeId=${epId(1, 1)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /api/v3/release', () => {
  beforeEach(() => {
    fake.releases = [
      makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-BBB', guid: 'webdl' }),
      makeRelease({ title: 'Fake.Show.S01E01.720p.HDTV-AAA', guid: 'hdtv', downloadUrl: 'http://geek/dl?apikey=secret' }),
    ];
  });

  it('grabs an approved release', async () => {
    await req('GET', `/api/v3/release?episodeId=${epId(1, 1)}`);
    const res = await req('POST', '/api/v3/release', { guid: 'webdl', indexerId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ guid: 'webdl', approved: true });
    expect(sab.added.map((a) => a.release.title)).toEqual(['Fake.Show.S01E01.1080p.WEB-DL-BBB']);
    expect(grabbed()).toHaveLength(1);
    expect(grabbed()[0]).toMatchObject({ episodeId: epId(1, 1), downloadId: 'sab-1' });
  });

  it('grabs a rejected release when asked explicitly', async () => {
    await req('GET', `/api/v3/release?episodeId=${epId(1, 1)}`);
    const res = await req('POST', '/api/v3/release', { guid: 'hdtv', indexerId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ guid: 'hdtv', approved: false, downloadUrl: 'http://geek/dl' });
    expect(sab.added[0]!.release.downloadUrl).toBe('http://geek/dl?apikey=secret');
    expect(JSON.parse(grabbed()[0]!.data).downloadUrl).toBe('http://geek/dl');
  });

  it('returns 404 for unknown or expired releases', async () => {
    expect((await req('POST', '/api/v3/release', { guid: 'webdl', indexerId })).json()).toEqual({ message: RELEASE_CACHE_MISS });
    await req('GET', `/api/v3/release?episodeId=${epId(1, 1)}`);
    const later = Date.now() + RELEASE_CACHE_TTL_MS + 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const res = await req('POST', '/api/v3/release', { guid: 'webdl', indexerId });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ message: RELEASE_CACHE_MISS });
    expect(sab.added).toEqual([]);
  });

  it('returns 409 with the message when the grab fails', async () => {
    await req('GET', `/api/v3/release?episodeId=${epId(1, 1)}`);
    t.app.sqlite.prepare('update download_clients set enable = 0').run();
    const res = await req('POST', '/api/v3/release', { guid: 'webdl', indexerId });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ message: 'No download client is available for usenet' });
  });

  it('validates the body', async () => {
    expect((await req('POST', '/api/v3/release', { guid: '' })).statusCode).toBe(400);
  });
});

describe('ReleaseCache', () => {
  const decision = (guid: string) =>
    ({ remoteEpisode: { release: makeRelease({ guid, indexerId: 1 }), parsed: null, episodes: [] }, rejections: [], approved: true, temporarilyRejected: false }) as const;

  it('evicts the least recently used entry beyond the limit', () => {
    const cache = new ReleaseCache(1000, 2);
    cache.set(decision('a') as never, 0);
    cache.set(decision('b') as never, 0);
    expect(cache.get('1:a', 1)).toBeDefined();
    cache.set(decision('c') as never, 2);
    expect(cache.get('1:b', 3)).toBeUndefined();
    expect(cache.get('1:a', 3)).toBeDefined();
    expect(cache.get('1:c', 3)).toBeDefined();
    expect(cache.get('1:a', 2000)).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});
