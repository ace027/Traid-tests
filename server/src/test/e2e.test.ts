import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../db/index.js';
import { resetClientRotation, setDownloadClientFactory } from '../downloadClients/registry.js';
import { resetIndexerBackoff, setIndexerClientFactory } from '../indexers/registry.js';
import { missingEpisodeIds } from '../services/search.js';
import { FakeDownloadClient } from './fakeDownloadClient.js';
import { FakeIndexerClient, makeRelease } from './fakeIndexer.js';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let root: string;
let dl: string;

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { 'x-api-key': t.apiKey }, payload: payload as object });

async function run(name: string, body: Record<string, unknown> = {}) {
  const cmd = t.app.commands.enqueue(name, body);
  await t.app.commands.waitForIdle();
  return t.app.commands.get(cmd.id)!;
}

beforeEach(async () => {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  dl = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-dl-')));
});

afterEach(async () => {
  setIndexerClientFactory(undefined);
  setDownloadClientFactory(null);
  resetIndexerBackoff();
  resetClientRotation();
  await t.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dl, { recursive: true, force: true });
});

describe('end to end: search, grab, download, import', () => {
  it('imports and renames a completed download into the series folder', async () => {
    // library
    expect((await req('POST', '/api/v3/rootfolder', { path: root })).statusCode).toBe(201);
    const profiles = (await req('GET', '/api/v3/qualityprofile')).json() as { id: number; name: string }[];
    const hd = profiles.find((p) => p.name === 'HD-1080p')!.id;
    const series = (await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: hd, rootFolderPath: root })).json() as { id: number; path: string };
    await t.app.commands.waitForIdle();
    const episode = t.app.db.select().from(schema.episodes).all().find((e) => e.seriesId === series.id && e.seasonNumber === 1 && e.episodeNumber === 1)!;
    expect(missingEpisodeIds(t.app)).toContain(episode.id);

    // indexer and download client
    const releaseTitle = 'Fake.Show.S01E01.1080p.WEB-DL-GRP';
    const indexer = new FakeIndexerClient([makeRelease({ title: releaseTitle, guid: 'e2e' })]);
    setIndexerClientFactory(() => indexer);
    t.app.db
      .insert(schema.indexers)
      .values({ name: 'geek', implementation: 'newznab', settings: JSON.stringify({ baseUrl: 'http://geek', apiKey: 'k' }), added: new Date().toISOString() })
      .run();
    const sab = new FakeDownloadClient('sab');
    setDownloadClientFactory(() => sab);
    expect((await req('POST', '/api/v3/downloadclient', { name: 'sab', implementation: 'SABnzbd', settings: { host: 'sab', port: 1 } })).statusCode).toBe(201);

    // search grabs the release
    expect(await run('EpisodeSearch', { episodeIds: [episode.id] })).toMatchObject({ status: 'completed', message: 'Found 1 releases, grabbed 1' });
    expect(sab.added.map((a) => a.release.title)).toEqual([releaseTitle]);
    const downloadId = sab.added[0]!.downloadId;

    // the client finishes the download
    const folder = path.join(dl, releaseTitle);
    fs.mkdirSync(folder);
    const source = path.join(folder, `${releaseTitle}.mkv`);
    fs.writeFileSync(source, 'episode bytes');
    sab.items = [
      FakeDownloadClient.item({ downloadId, title: releaseTitle, status: 'completed', remainingSize: 0, outputPath: folder, canMoveFiles: true, canBeRemoved: true }),
    ];

    expect(await run('RefreshMonitoredDownloads')).toMatchObject({ status: 'completed' });

    const dest = path.join(series.path, 'Season 01', 'Fake Show - S01E01 - Episode 1 WEBDL-1080p.mkv');
    expect(fs.readFileSync(dest, 'utf8')).toBe('episode bytes');
    expect(fs.existsSync(source)).toBe(false);
    expect(sab.removed).toEqual([{ downloadId, deleteData: true }]);

    const history = t.app.db.select().from(schema.history).all().filter((h) => h.episodeId === episode.id);
    expect(history.map((h) => h.eventType)).toEqual(['grabbed', 'downloadFolderImported']);
    expect(history.every((h) => h.downloadId === downloadId)).toBe(true);

    const files = (await req('GET', `/api/v3/episodefile?seriesId=${series.id}`)).json() as { path: string }[];
    expect(files.map((f) => f.path)).toEqual([dest]);
    expect(missingEpisodeIds(t.app)).not.toContain(episode.id);
  });

  // Regression: the Playwright smoke run grabs a second release (a season pack for another series) on the same
  // server. A download client may hand out a download id again once the first item is removed (the e2e fake did;
  // torrent clients do when the same hash is grabbed again). The second download must map to its own grab, not
  // to the first one, whose episode already has a file ("Not an upgrade for existing episode file(s)").
  it('imports a second download, a season pack for another series, that reuses a removed download id', async () => {
    expect((await req('POST', '/api/v3/rootfolder', { path: root })).statusCode).toBe(201);
    const profiles = (await req('GET', '/api/v3/qualityprofile')).json() as { id: number; name: string }[];
    const hd = profiles.find((p) => p.name === 'HD-1080p')!.id;
    const fake = (await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: hd, rootFolderPath: root })).json() as { id: number; path: string };
    const ended = (await req('POST', '/api/v3/series', { tvMazeId: 200, qualityProfileId: hd, rootFolderPath: root })).json() as { id: number; path: string };
    await t.app.commands.waitForIdle();
    const eps = t.app.db.select().from(schema.episodes).all();
    const ep = (seriesId: number, s: number, e: number) => eps.find((x) => x.seriesId === seriesId && x.seasonNumber === s && x.episodeNumber === e)!;

    const indexer = new FakeIndexerClient([]);
    setIndexerClientFactory(() => indexer);
    t.app.db
      .insert(schema.indexers)
      .values({ name: 'geek', implementation: 'newznab', settings: JSON.stringify({ baseUrl: 'http://geek', apiKey: 'k' }), added: new Date().toISOString() })
      .run();
    const sab = new FakeDownloadClient('sab');
    // Hands out 'reused' for every grab, like a client numbering its items by queue length.
    sab.addRelease = async (release) => {
      sab.added.push({ release, downloadId: 'reused' });
      return 'reused';
    };
    setDownloadClientFactory(() => sab);
    expect((await req('POST', '/api/v3/downloadclient', { name: 'sab', implementation: 'SABnzbd', settings: { host: 'sab', port: 1 } })).statusCode).toBe(201);

    async function cycle(release: string, files: Record<string, string>, search: Record<string, unknown>, command: string) {
      indexer.releases = [makeRelease({ title: release, guid: release })];
      expect(await run(command, search)).toMatchObject({ status: 'completed', message: 'Found 1 releases, grabbed 1' });
      const folder = path.join(dl, release);
      fs.mkdirSync(folder);
      for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), body);
      sab.items = [FakeDownloadClient.item({ downloadId: 'reused', title: release, status: 'completed', remainingSize: 0, outputPath: folder, canMoveFiles: true, canBeRemoved: true })];
      expect(await run('RefreshMonitoredDownloads')).toMatchObject({ status: 'completed' });
    }

    await cycle('Fake.Show.S01E01.1080p.WEB-DL-GRP', { 'Fake.Show.S01E01.1080p.WEB-DL-GRP.mkv': 'first' }, { episodeIds: [ep(fake.id, 1, 1).id] }, 'EpisodeSearch');
    expect(fs.readFileSync(path.join(fake.path, 'Season 01', 'Fake Show - S01E01 - Episode 1 WEBDL-1080p.mkv'), 'utf8')).toBe('first');
    expect(sab.items).toEqual([]);

    await cycle(
      'Ended.Show.S01.1080p.WEB-DL-GRP',
      { 'Ended.Show.S01E01.1080p.WEB-DL-GRP.mkv': 'pack one', 'Ended.Show.S01E02.1080p.WEB-DL-GRP.mkv': 'pack two' },
      { seriesId: ended.id, seasonNumber: 1 },
      'SeasonSearch',
    );
    const queue = (await req('GET', '/api/v3/queue')).json() as { records: unknown[] };
    expect(queue.records).toEqual([]);
    expect(fs.readFileSync(path.join(ended.path, 'Season 01', 'Ended Show - S01E01 - Episode 1 WEBDL-1080p.mkv'), 'utf8')).toBe('pack one');
    expect(fs.readFileSync(path.join(ended.path, 'Season 01', 'Ended Show - S01E02 - Episode 2 WEBDL-1080p.mkv'), 'utf8')).toBe('pack two');
    const imported = t.app.db.select().from(schema.history).all().filter((h) => h.eventType === 'downloadFolderImported');
    expect(imported.map((h) => h.episodeId).sort()).toEqual([ep(fake.id, 1, 1).id, ep(ended.id, 1, 1).id, ep(ended.id, 1, 2).id].sort());
  });
});
