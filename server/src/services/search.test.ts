import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUALITIES } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { resetClientRotation, setDownloadClientFactory } from '../downloadClients/registry.js';
import { isInBackoff, resetIndexerBackoff, setIndexerClientFactory } from '../indexers/registry.js';
import type { ReleaseInfo } from '../indexers/types.js';
import { FakeDownloadClient } from '../test/fakeDownloadClient.js';
import { FakeIndexerClient, makeRelease } from '../test/fakeIndexer.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { setGrabFetch, stripApiKey } from './grab.js';
import { recordGrabbed } from './history.js';
import { getQueue } from './queue.js';

let t: TestApp;
let root: string;
let seriesId: number;
let indexers: Map<string, FakeIndexerClient>;
let sab: FakeDownloadClient;
let qbit: FakeDownloadClient;

const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { 'x-api-key': t.apiKey }, payload: payload as object });

const epId = (season: number, episode: number) =>
  t.app.db.select().from(schema.episodes).all().find((e) => e.seriesId === seriesId && e.seasonNumber === season && e.episodeNumber === episode)!.id;

function addIndexer(name: string, releases: ReleaseInfo[], implementation = 'newznab', priority = 25): { id: number; fake: FakeIndexerClient } {
  const fake = new FakeIndexerClient(releases);
  indexers.set(name, fake);
  const row = t.app.db
    .insert(schema.indexers)
    .values({ name, implementation, priority, settings: JSON.stringify({ baseUrl: `http://${name}`, apiKey: 'secret' }), added: new Date().toISOString() })
    .returning()
    .get();
  return { id: row.id, fake };
}

async function addClient(name: string, implementation: string): Promise<void> {
  const res = await req('POST', '/api/v3/downloadclient', { name, implementation, settings: { host: name, port: 1 } });
  expect(res.statusCode).toBe(201);
}

async function run(name: string, body: Record<string, unknown> = {}) {
  const cmd = t.app.commands.enqueue(name, body);
  await t.app.commands.waitForIdle();
  return t.app.commands.get(cmd.id)!;
}

const grabbedRows = () => t.app.db.select().from(schema.history).all().filter((h) => h.eventType === 'grabbed');
const GB = 1024 ** 3;

beforeEach(async () => {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profiles = (await req('GET', '/api/v3/qualityprofile')).json() as { id: number; name: string }[];
  const hd = profiles.find((p) => p.name === 'HD-1080p')!.id;
  seriesId = (await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: hd, rootFolderPath: root })).json().id;
  indexers = new Map();
  setIndexerClientFactory((row) => indexers.get(row.name) ?? new FakeIndexerClient());
  sab = new FakeDownloadClient('sab');
  qbit = new FakeDownloadClient('qb');
  setDownloadClientFactory((cfg) => (cfg.implementation.toLowerCase() === 'sabnzbd' ? sab : qbit));
});

afterEach(async () => {
  setIndexerClientFactory(undefined);
  setDownloadClientFactory(null);
  setGrabFetch(undefined);
  resetIndexerBackoff();
  resetClientRotation();
  await t.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('EpisodeSearch', () => {
  it('grabs the best approved release and records history', async () => {
    await addClient('sab', 'SABnzbd');
    const { fake } = addIndexer('geek', [
      makeRelease({ title: 'Fake.Show.S01E01.720p.HDTV-AAA', guid: 'hdtv' }),
      makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-BBB', guid: 'webdl' }),
      makeRelease({ title: 'Fake.Show.S01E01.1080p.BluRay.x264-CCC', guid: 'bluray', downloadUrl: 'http://geek/get/1?apikey=secret&id=1' }),
    ]);
    const cmd = await run('EpisodeSearch', { episodeIds: [epId(1, 1)] });
    expect(cmd).toMatchObject({ status: 'completed', message: 'Found 3 releases, grabbed 1' });
    expect(fake.calls).toEqual([{ method: 'search', criteria: expect.objectContaining({ type: 'episode', seasonNumber: 1, episodeNumbers: [1] }) }]);
    expect(sab.added.map((a) => a.release.title)).toEqual(['Fake.Show.S01E01.1080p.BluRay.x264-CCC']);
    expect(sab.added[0]!.release.downloadUrl).toContain('apikey=secret');
    const [h] = grabbedRows();
    expect(h).toMatchObject({ seriesId, episodeId: epId(1, 1), sourceTitle: 'Fake.Show.S01E01.1080p.BluRay.x264-CCC', downloadId: 'sab-1' });
    const data = JSON.parse(h!.data);
    expect(data).toMatchObject({ indexer: 'geek', downloadClient: 'sab', releaseGroup: 'CCC', guid: 'bluray', protocol: 'usenet' });
    expect(data.downloadUrl).toBe('http://geek/get/1?id=1');
    expect(JSON.parse(h!.quality).quality.name).toBe('Bluray-1080p');
  });

  it('grabs nothing when every release is rejected', async () => {
    await addClient('sab', 'SABnzbd');
    addIndexer('geek', [makeRelease({ title: 'Fake.Show.S01E01.720p.HDTV-AAA' }), makeRelease({ title: 'Fake.Show.S01E02.1080p.WEB-DL-AAA' })]);
    const cmd = await run('EpisodeSearch', { episodeIds: [epId(1, 1)] });
    expect(cmd).toMatchObject({ status: 'completed', message: 'Found 2 releases, grabbed 0' });
    expect(sab.added).toEqual([]);
    expect(grabbedRows()).toEqual([]);
  });

  it('fails with a clear message when no download client is available', async () => {
    addIndexer('geek', [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA' })]);
    const cmd = await run('EpisodeSearch', { episodeIds: [epId(1, 1)] });
    expect(cmd).toMatchObject({ status: 'failed', message: 'No download client is available for usenet' });
    expect(grabbedRows()).toEqual([]);
  });

  it('backs off a failing indexer and still uses the others', async () => {
    await addClient('sab', 'SABnzbd');
    const bad = addIndexer('bad', []);
    bad.fake.error = new Error('boom');
    addIndexer('good', [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA' })]);
    const cmd = await run('EpisodeSearch', { episodeIds: [epId(1, 1)] });
    expect(cmd).toMatchObject({ status: 'completed', message: 'Found 1 releases, grabbed 1' });
    expect(isInBackoff(bad.id)).toBe(true);
    // A backed-off indexer is skipped on the next search.
    await run('EpisodeSearch', { episodeIds: [epId(1, 2)] });
    expect(bad.fake.calls).toHaveLength(1);
  });

  it('completes with nothing found when every indexer fails', async () => {
    await addClient('sab', 'SABnzbd');
    addIndexer('a', []).fake.error = new Error('down');
    addIndexer('b', []).fake.error = new Error('down');
    expect(await run('EpisodeSearch', { episodeIds: [epId(1, 1)] })).toMatchObject({ status: 'completed', message: 'Found 0 releases, grabbed 0' });
  });

  it('fetches the .torrent file when there is no magnet and passes the bytes', async () => {
    await addClient('qbit', 'QBittorrent');
    addIndexer('tz', [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA', protocol: 'torrent', seeders: 10, downloadUrl: 'http://tz/dl/1.torrent?apikey=secret' })], 'torznab');
    const fetched: string[] = [];
    setGrabFetch(async (url) => {
      fetched.push(String(url));
      return new Response(new Uint8Array([100, 101]));
    });
    expect(await run('EpisodeSearch', { episodeIds: [epId(1, 1)] })).toMatchObject({ status: 'completed', message: 'Found 1 releases, grabbed 1' });
    expect(fetched).toEqual(['http://tz/dl/1.torrent?apikey=secret']);
    expect([...qbit.added[0]!.torrentFile!]).toEqual([100, 101]);
    expect(JSON.parse(grabbedRows()[0]!.data).downloadUrl).toBe('http://tz/dl/1.torrent');
  });

  it('rejects oversized .torrent files', async () => {
    await addClient('qbit', 'QBittorrent');
    addIndexer('tz', [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA', protocol: 'torrent', seeders: 10 })], 'torznab');
    setGrabFetch(async () => new Response(new Uint8Array(11 * 1024 * 1024)));
    expect(await run('EpisodeSearch', { episodeIds: [epId(1, 1)] })).toMatchObject({ status: 'failed', message: 'The torrent file is too large' });
  });

  it('passes magnets without fetching', async () => {
    await addClient('qbit', 'QBittorrent');
    addIndexer('tz', [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA', protocol: 'torrent', seeders: 10, magnetUrl: 'magnet:?xt=urn:btih:abc' })], 'torznab');
    setGrabFetch(async () => {
      throw new Error('should not fetch');
    });
    await run('EpisodeSearch', { episodeIds: [epId(1, 1)] });
    expect(qbit.added[0]).toMatchObject({ release: { magnetUrl: 'magnet:?xt=urn:btih:abc' } });
    expect(qbit.added[0]!.torrentFile).toBeUndefined();
  });
});

describe('SeasonSearch and SeriesSearch', () => {
  it('prefers an approved season pack', async () => {
    await addClient('sab', 'SABnzbd');
    const { fake } = addIndexer('geek', [
      makeRelease({ title: 'Fake.Show.S01E01.1080p.BluRay.x264-AAA', size: GB }),
      makeRelease({ title: 'Fake.Show.S01.1080p.WEB-DL-BBB', size: 3 * GB }),
    ]);
    const cmd = await run('SeasonSearch', { seriesId, seasonNumber: 1 });
    expect(cmd).toMatchObject({ status: 'completed', message: 'Found 2 releases, grabbed 1' });
    expect(fake.calls).toEqual([{ method: 'search', criteria: expect.objectContaining({ type: 'season', seasonNumber: 1 }) }]);
    expect(sab.added.map((a) => a.release.title)).toEqual(['Fake.Show.S01.1080p.WEB-DL-BBB']);
    expect(grabbedRows().map((h) => h.episodeId)).toEqual([epId(1, 1), epId(1, 2)]);
  });

  it('falls back to the missing episodes when no pack is approved', async () => {
    await addClient('sab', 'SABnzbd');
    const { fake } = addIndexer('geek', [
      makeRelease({ title: 'Fake.Show.S02.1080p.WEB-DL-BBB', size: 4 * GB }),
      makeRelease({ title: 'Fake.Show.S02E01.1080p.WEB-DL-AAA' }),
      makeRelease({ title: 'Fake.Show.S02E02.1080p.WEB-DL-AAA' }),
    ]);
    const cmd = await run('SeasonSearch', { seriesId, seasonNumber: 2 });
    // Season 2 has an unaired episode, so the pack is rejected; E01 and E02 are searched individually.
    expect(cmd).toMatchObject({ status: 'completed', message: 'Found 6 releases, grabbed 2' });
    expect(fake.calls.map((c) => (c.method === 'search' ? c.criteria.type : c.method))).toEqual(['season', 'episode', 'episode']);
    expect(sab.added.map((a) => a.release.title).sort()).toEqual(['Fake.Show.S02E01.1080p.WEB-DL-AAA', 'Fake.Show.S02E02.1080p.WEB-DL-AAA']);
  });

  it('SeriesSearch searches every monitored season', async () => {
    await addClient('sab', 'SABnzbd');
    t.app.sqlite.prepare('update seasons set monitored = 0 where series_id = ? and season_number = 2').run(seriesId);
    const { fake } = addIndexer('geek', []);
    const cmd = await run('SeriesSearch', { seriesId });
    expect(cmd).toMatchObject({ status: 'completed', message: 'Found 0 releases, grabbed 0' });
    const seasons = fake.calls.flatMap((c) => (c.method === 'search' && c.criteria.type === 'season' ? [c.criteria.seasonNumber] : []));
    expect(seasons).toEqual([1]);
  });
});

describe('MissingEpisodeSearch and CutoffUnmetEpisodeSearch', () => {
  const searchedEpisodes = (fake: FakeIndexerClient) =>
    fake.calls.flatMap((c) => (c.method === 'search' && c.criteria.type === 'episode' ? [`${c.criteria.seasonNumber}x${c.criteria.episodeNumbers[0]}`] : []));

  it('searches monitored aired episodes without files', async () => {
    await addClient('sab', 'SABnzbd');
    t.app.sqlite.prepare('update episodes set monitored = 0 where id = ?').run(epId(1, 2));
    const { fake } = addIndexer('geek', [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA' })]);
    const cmd = await run('MissingEpisodeSearch');
    expect(cmd).toMatchObject({ status: 'completed', message: 'Found 1 releases, grabbed 1' });
    expect(searchedEpisodes(fake)).toEqual(['1x1', '2x1', '2x2']);
  });

  it('searches episodes whose file is below the cutoff', async () => {
    await addClient('sab', 'SABnzbd');
    const sdtv = { quality: QUALITIES.find((q) => q.id === 1)!, revision: { version: 1, real: 0, isRepack: false } };
    const webdl = { ...sdtv, quality: QUALITIES.find((q) => q.id === 3)! };
    for (const [ep, quality] of [[epId(1, 1), sdtv], [epId(1, 2), webdl]] as const) {
      const file = t.app.db
        .insert(schema.episodeFiles)
        .values({ seriesId, seasonNumber: 1, relativePath: `${ep}.mkv`, path: path.join(root, `${ep}.mkv`), dateAdded: new Date().toISOString(), quality: JSON.stringify(quality) })
        .returning()
        .get();
      t.app.sqlite.prepare('update episodes set episode_file_id = ? where id = ?').run(file.id, ep);
    }
    const { fake } = addIndexer('geek', [makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA' })]);
    expect(await run('CutoffUnmetEpisodeSearch')).toMatchObject({ status: 'completed', message: 'Found 1 releases, grabbed 1' });
    expect(searchedEpisodes(fake)).toEqual(['1x1']);
  });
});

describe('RssSync', () => {
  it('grabs an approved release and skips duplicates, second choices and queued episodes', async () => {
    await addClient('sab', 'SABnzbd');
    // S01E02 is already downloading.
    recordGrabbed(t.app, {
      seriesId,
      episodeIds: [epId(1, 2)],
      sourceTitle: 'Fake.Show.S01E02.1080p.WEB-DL-OLD',
      quality: { quality: QUALITIES.find((q) => q.id === 3)!, revision: { version: 1, real: 0, isRepack: false } },
      downloadId: 'sab-queued',
      date: '2000-01-01T00:00:00Z',
    });
    sab.items = [FakeDownloadClient.item({ downloadId: 'sab-queued' })];
    await getQueue(t.app).refresh();

    const best = makeRelease({ title: 'Fake.Show.S01E01.1080p.WEB-DL-AAA', guid: 'same' });
    const a = addIndexer('a', [best, makeRelease({ title: 'Fake.Show.S01E01.1080p.HDTV.x264-BBB' }), makeRelease({ title: 'Fake.Show.S01E02.1080p.WEB-DL-CCC' })], 'newznab', 10);
    const b = addIndexer('b', [best], 'newznab', 20);
    const cmd = await run('RssSync');
    expect(cmd).toMatchObject({ status: 'completed', message: 'RSS Sync Completed. Reports found: 4, Reports grabbed: 1' });
    expect(a.fake.calls).toEqual([{ method: 'fetchRss' }]);
    expect(b.fake.calls).toEqual([{ method: 'fetchRss' }]);
    expect(sab.added.map((x) => x.release.title)).toEqual(['Fake.Show.S01E01.1080p.WEB-DL-AAA']);
    const rows = grabbedRows().filter((h) => h.downloadId !== 'sab-queued');
    expect(rows.map((h) => [h.episodeId, JSON.parse(h.data).indexer])).toEqual([[epId(1, 1), 'a']]);

    // The next sync does not grab the same episode again.
    expect(await run('RssSync')).toMatchObject({ message: 'RSS Sync Completed. Reports found: 4, Reports grabbed: 0' });
    expect(sab.added).toHaveLength(1);
  });

  it('only uses RSS-enabled indexers', async () => {
    await addClient('sab', 'SABnzbd');
    const { id, fake } = addIndexer('a', []);
    t.app.sqlite.prepare('update indexers set enable_rss = 0 where id = ?').run(id);
    expect(await run('RssSync')).toMatchObject({ status: 'completed', message: 'RSS Sync Completed. Reports found: 0, Reports grabbed: 0' });
    expect(fake.calls).toEqual([]);
  });
});

describe('stripApiKey', () => {
  it.each([
    ['http://x/api?t=get&apikey=abc&id=1', 'http://x/api?t=get&id=1'],
    ['http://x/dl?API=abc', 'http://x/dl'],
    ['http://x/dl/1.torrent', 'http://x/dl/1.torrent'],
    ['magnet:?xt=urn:btih:abc', 'magnet:?xt=urn:btih:abc'],
  ])('%s', (input, out) => expect(stripApiKey(input)).toBe(out));
});
