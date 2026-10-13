import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUALITIES, type QualityModel } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { setDownloadClientFactory } from '../downloadClients/registry.js';
import type { ReleaseInfo } from '../indexers/types.js';
import { addToBlocklist } from '../services/blocklist.js';
import { recordGrabbed } from '../services/history.js';
import { getQueue } from '../services/queue.js';
import { FakeDownloadClient } from '../test/fakeDownloadClient.js';
import { makeRelease } from '../test/fakeIndexer.js';
import { FakeMetadataProvider, makeEpisode, makeShow } from '../test/fakeMetadata.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { makeDecisions } from './engine.js';
import { sortDecisions } from './prioritize.js';
import type { DownloadDecision, EpisodeRow, SearchContext, SeriesRow } from './types.js';

let t: TestApp;
let root: string;
const NOW = new Date('2024-06-01T00:00:00Z');

const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { 'x-api-key': t.apiKey }, payload: payload as object });

const q = (id: number, version = 1): QualityModel => ({
  quality: QUALITIES.find((x) => x.id === id)!,
  revision: { version, real: 0, isRepack: false },
});
const WEBDL1080 = 3;
const BLURAY1080 = 7;
const SDTV = 1;

interface Fixture {
  show: SeriesRow;
  daily: SeriesRow;
  anime: SeriesRow;
  ep: (series: SeriesRow, season: number, episode: number) => EpisodeRow;
  profileId: (name: string) => number;
}
let f: Fixture;

async function addSeries(tvMazeId: number, profile: string, extra: Record<string, unknown> = {}): Promise<SeriesRow> {
  const res = await req('POST', '/api/v3/series', { tvMazeId, qualityProfileId: f.profileId(profile), rootFolderPath: root, ...extra });
  expect(res.statusCode).toBe(201);
  return t.app.db.select().from(schema.series).all().find((s) => s.tvmazeId === tvMazeId)!;
}

beforeEach(async () => {
  const metadata = new FakeMetadataProvider();
  metadata.addShow(makeShow(600, 'Anime Show', { year: 2018, tvdbId: 7006, seriesType: 'anime' }), [
    makeEpisode(6001, 1, 1, '2018-01-01'),
    makeEpisode(6002, 1, 2, '2018-01-08'),
  ]);
  t = await createTestApp({ metadataProvider: metadata });
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profiles = (await req('GET', '/api/v3/qualityprofile')).json() as { id: number; name: string }[];
  f = {
    profileId: (name) => profiles.find((p) => p.name === name)!.id,
    ep: (series, season, episode) =>
      t.app.db.select().from(schema.episodes).all().find((e) => e.seriesId === series.id && e.seasonNumber === season && e.episodeNumber === episode)!,
  } as Fixture;
  f.show = await addSeries(100, 'HD-1080p');
  f.daily = await addSeries(300, 'Any');
  f.anime = await addSeries(600, 'HD-1080p', { seriesType: 'anime' });
  t.app.sqlite.prepare('update episodes set absolute_episode_number = episode_number where series_id = ?').run(f.anime.id);
});

afterEach(async () => {
  setDownloadClientFactory(null);
  await t.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

const ctx = (over: Partial<SearchContext> = {}): SearchContext => ({ interactive: false, now: NOW, ...over });

async function decide(title: string, over: Partial<ReleaseInfo> = {}, c: Partial<SearchContext> = {}): Promise<DownloadDecision> {
  const [d] = await makeDecisions(t.app, [makeRelease({ title, ...over })], ctx(c));
  return d!;
}

const reasons = (d: DownloadDecision) => d.rejections.map((r) => r.reason);

function addFile(series: SeriesRow, episodes: EpisodeRow[], quality: QualityModel): void {
  const file = t.app.db
    .insert(schema.episodeFiles)
    .values({
      seriesId: series.id,
      seasonNumber: episodes[0]!.seasonNumber,
      relativePath: `f-${episodes[0]!.id}.mkv`,
      path: path.join(series.path, `f-${episodes[0]!.id}.mkv`),
      size: 1,
      dateAdded: NOW.toISOString(),
      quality: JSON.stringify(quality),
    })
    .returning()
    .get();
  for (const e of episodes) t.app.sqlite.prepare('update episodes set episode_file_id = ? where id = ?').run(file.id, e.id);
}

const setProfile = (name: string, cols: { cutoff?: number; upgradeAllowed?: boolean }) => {
  if (cols.cutoff !== undefined) t.app.sqlite.prepare('update quality_profiles set cutoff = ? where name = ?').run(cols.cutoff, name);
  if (cols.upgradeAllowed !== undefined) t.app.sqlite.prepare('update quality_profiles set upgrade_allowed = ? where name = ?').run(cols.upgradeAllowed ? 1 : 0, name);
};

describe('makeDecisions: mapping', () => {
  it('approves a wanted standard release and maps its episode', async () => {
    const d = await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP');
    expect(reasons(d)).toEqual([]);
    expect(d).toMatchObject({ approved: true, temporarilyRejected: false });
    expect(d.remoteEpisode.series?.id).toBe(f.show.id);
    expect(d.remoteEpisode.episodes.map((e) => e.id)).toEqual([f.ep(f.show, 1, 1).id]);
  });

  it.each([
    ['Not a release', 'Unable to parse release'],
    ['Other.Show.S01E01.1080p.WEB-DL-GRP', 'Unknown Series'],
    ['Fake.Show.S05E01.1080p.WEB-DL-GRP', 'Unable to identify correct episode(s) using release name and scene mappings'],
  ])('%s -> %s', async (title, reason) => {
    const d = await decide(title);
    expect(d.approved).toBe(false);
    expect(reasons(d)).toEqual([reason]);
    expect(d.rejections[0]!.type).toBe('permanent');
  });

  it('maps by tvdbId before title', async () => {
    const d = await decide('Totally.Different.S01E02.1080p.WEB-DL-GRP', { tvdbId: 7001 });
    expect(d.remoteEpisode.series?.id).toBe(f.show.id);
    expect(d.remoteEpisode.episodes.map((e) => e.id)).toEqual([f.ep(f.show, 1, 2).id]);
  });

  it('maps daily releases by air date', async () => {
    const d = await decide('Daily.Show.2015.03.03.720p.HDTV-GRP');
    expect(d.approved).toBe(true);
    expect(d.remoteEpisode.episodes.map((e) => e.id)).toEqual([f.ep(f.daily, 1, 2).id]);
  });

  it('maps anime by absolute number and falls back to season/episode', async () => {
    const abs = await decide('[SubGroup] Anime Show - 02 [1080p]');
    expect(abs.remoteEpisode.episodes.map((e) => e.id)).toEqual([f.ep(f.anime, 1, 2).id]);
    expect(abs.approved).toBe(true);
    const std = await decide('Anime.Show.S01E01.1080p.WEB-DL-GRP');
    expect(std.remoteEpisode.episodes.map((e) => e.id)).toEqual([f.ep(f.anime, 1, 1).id]);
  });

  it('maps a full season pack to every episode of the season but not specials', async () => {
    const d = await decide('Fake.Show.S01.1080p.WEB-DL-GRP', { size: 3_000_000_000 });
    expect(d.remoteEpisode.episodes.map((e) => e.episodeNumber)).toEqual([1, 2]);
    expect(d.approved).toBe(true);
  });

  it('a title matching two series is ambiguous unless the year or the search criteria pick one', async () => {
    const other = await addSeries(400, 'HD-1080p');
    expect(reasons(await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP'))).toEqual(['Unknown Series']);
    expect((await decide('Fake Show (2005) S01E01 1080p WEB-DL-GRP')).remoteEpisode.series?.id).toBe(other.id);
    expect((await decide('Fake.Show.2020.S01E01.1080p.WEB-DL-GRP')).remoteEpisode.series?.id).toBe(f.show.id);
    const crit = { series: f.show, episodes: [f.ep(f.show, 1, 1)] };
    const d = await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP', {}, { searchCriteria: crit });
    expect(d.remoteEpisode.series?.id).toBe(f.show.id);
    expect(d.approved).toBe(true);
  });
});

describe('makeDecisions: specifications', () => {
  it("rejects episodes that weren't requested", async () => {
    const crit = { series: f.show, episodes: [f.ep(f.show, 1, 2)] };
    expect(reasons(await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP', {}, { searchCriteria: crit }))).toEqual(["Episode wasn't requested"]);
    expect((await decide('Fake.Show.S01E02.1080p.WEB-DL-GRP', {}, { searchCriteria: crit })).approved).toBe(true);
    const season = { series: f.show, episodes: [], seasonNumber: 1 };
    expect(reasons(await decide('Fake.Show.S02E01.1080p.WEB-DL-GRP', {}, { searchCriteria: season }))).toEqual(["Episode wasn't requested"]);
  });

  it('rejects qualities the profile does not allow', async () => {
    expect(reasons(await decide('Fake.Show.S01E01.720p.HDTV-GRP'))).toEqual(['Quality HDTV-720p is not wanted in profile']);
  });

  it('rejects unmonitored series and episodes except for interactive requested searches', async () => {
    t.app.sqlite.prepare('update series set monitored = 0 where id = ?').run(f.show.id);
    t.app.sqlite.prepare('update episodes set monitored = 0 where id = ?').run(f.ep(f.show, 1, 1).id);
    const title = 'Fake.Show.S01E01.1080p.WEB-DL-GRP';
    expect(reasons(await decide(title))).toEqual(['Series is not monitored', 'Episode is not monitored']);
    const crit = { series: { ...f.show, monitored: false }, episodes: [f.ep(f.show, 1, 1)] };
    expect((await decide(title, {}, { interactive: true, searchCriteria: crit })).approved).toBe(true);
    expect(reasons(await decide(title, {}, { interactive: false, searchCriteria: crit }))).toContain('Episode is not monitored');
    expect(reasons(await decide('Fake.Show.S01E01E02.1080p.WEB-DL-GRP', { size: 3e9 }))).toContain('One or more episodes is not monitored');
  });

  it('rejects a season pack with an unaired or unmonitored episode', async () => {
    const d = await decide('Fake.Show.S02.1080p.WEB-DL-GRP', { size: 4e9 }, { now: new Date() });
    expect(reasons(d)).toEqual(['Full season pack: not all episodes are monitored/aired']);
    t.app.sqlite.prepare('update episodes set monitored = 0 where id = ?').run(f.ep(f.show, 1, 2).id);
    expect(reasons(await decide('Fake.Show.S01.1080p.WEB-DL-GRP', { size: 3e9 }))).toEqual(['Full season pack: not all episodes are monitored/aired']);
  });

  it.each([
    [100 * 1024 * 1024, '100.0 MB is smaller than minimum allowed 180.0 MB'],
    [10 * 1024 ** 3, '10.0 GB is larger than maximum allowed 5.7 GB'],
    [0, null],
    [1024 ** 3, null],
  ])('size %d', async (size, reason) => {
    const d = await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP', { size });
    expect(reasons(d)).toEqual(reason ? [reason] : []);
  });

  it('uses the summed runtime for season packs and 30 minutes for anime without a runtime', async () => {
    // 2 episodes * 45 min * 4 MB/min = 360 MB minimum.
    expect(reasons(await decide('Fake.Show.S01.1080p.WEB-DL-GRP', { size: 300 * 1024 * 1024 }))).toEqual([
      '300.0 MB is smaller than minimum allowed 360.0 MB',
    ]);
    t.app.sqlite.prepare('update series set runtime = 0 where id = ?').run(f.anime.id);
    // HDTV-1080p: 4 MB/min * 30 min = 120 MB minimum.
    expect(reasons(await decide('[SubGroup] Anime Show - 02 [1080p]', { size: 100 * 1024 * 1024 }))).toEqual([
      '100.0 MB is smaller than minimum allowed 120.0 MB',
    ]);
  });

  describe('existing file', () => {
    const title = (quality: string) => `Fake.Show.S01E01.${quality}-GRP`;

    it.each([
      // [cutoff, upgradeAllowed, file quality, release, expected reason]
      [9, true, q(WEBDL1080), title('1080p.WEB-DL'), 'Existing file meets cutoff: WEBDL-1080p'],
      [9, true, q(WEBDL1080), title('PROPER.1080p.WEB-DL'), null],
      [BLURAY1080, true, q(WEBDL1080), title('1080p.WEBRip.x264'), 'Existing file on disk is of equal or higher preference: WEBDL-1080p'],
      [BLURAY1080, true, q(WEBDL1080), title('1080p.WEB-DL'), 'Existing file on disk is of equal or higher preference: WEBDL-1080p'],
      [BLURAY1080, true, q(WEBDL1080), title('1080p.BluRay.x264'), null],
      [BLURAY1080, false, q(WEBDL1080), title('1080p.BluRay.x264'), 'Existing file and the Quality profile does not allow upgrades'],
      [BLURAY1080, true, q(SDTV), title('1080p.WEB-DL'), null],
    ] as const)('cutoff %d upgrades %s file %o: %s', async (cutoff, upgradeAllowed, fileQuality, release, reason) => {
      setProfile('HD-1080p', { cutoff, upgradeAllowed });
      addFile(f.show, [f.ep(f.show, 1, 1)], fileQuality);
      expect(reasons(await decide(release))).toEqual(reason ? [reason] : []);
    });
  });

  describe('queue', () => {
    async function queueItem(quality: QualityModel) {
      const client = new FakeDownloadClient('sab');
      setDownloadClientFactory(() => client);
      await req('POST', '/api/v3/downloadclient', { name: 'sab', implementation: 'SABnzbd', settings: { host: 'sab', port: 1 } });
      recordGrabbed(t.app, { seriesId: f.show.id, episodeIds: [f.ep(f.show, 1, 1).id], sourceTitle: 'x', quality, downloadId: 'sab-q', date: '2000-01-01T00:00:00Z' });
      client.items = [FakeDownloadClient.item({ downloadId: 'sab-q' })];
      await getQueue(t.app).refresh();
    }

    it('rejects temporarily when the queued release meets the cutoff', async () => {
      await queueItem(q(WEBDL1080));
      const d = await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP');
      expect(d.rejections).toEqual([{ reason: 'Release in queue already meets cutoff: WEBDL-1080p', type: 'temporary' }]);
      expect(d).toMatchObject({ approved: false, temporarilyRejected: true });
      expect((await decide('Fake.Show.S01E02.1080p.WEB-DL-GRP')).approved).toBe(true);
    });

    it('rejects when the queued release is of equal or higher preference', async () => {
      setProfile('HD-1080p', { cutoff: BLURAY1080 });
      await queueItem(q(WEBDL1080));
      expect(reasons(await decide('Fake.Show.S01E01.1080p.WEBRip.x264-GRP'))).toEqual([
        'Release in queue is of equal or higher preference: WEBDL-1080p',
      ]);
      expect((await decide('Fake.Show.S01E01.1080p.BluRay.x264-GRP')).approved).toBe(true);
    });
  });

  it('rejects blocklisted releases', async () => {
    const title = 'Fake.Show.S01E01.1080p.WEB-DL-GRP';
    addToBlocklist(t.app, { seriesId: f.show.id, episodeIds: [], sourceTitle: title, quality: q(WEBDL1080), protocol: 'usenet', indexer: 'Fake' });
    expect(reasons(await decide(title))).toEqual(['Release is blocklisted']);
    expect((await decide(title, { indexer: 'Other' })).approved).toBe(true);
  });

  it('rejects torrents below the indexer minimum seeders', async () => {
    const row = t.app.db
      .insert(schema.indexers)
      .values({ name: 'tz', implementation: 'torznab', settings: JSON.stringify({ baseUrl: 'http://tz', minimumSeeders: 5 }), added: NOW.toISOString() })
      .returning()
      .get();
    const base = { protocol: 'torrent' as const, indexerId: row.id };
    expect(reasons(await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP', { ...base, seeders: 2 }))).toEqual(['Not enough seeders: 2. Minimum seeders: 5']);
    expect((await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP', { ...base, seeders: 5 })).approved).toBe(true);
    expect((await decide('Fake.Show.S01E01.1080p.WEB-DL-GRP', { ...base })).approved).toBe(true);
  });

  it('rejects releases grabbed recently during RSS sync only', async () => {
    recordGrabbed(t.app, { seriesId: f.show.id, episodeIds: [f.ep(f.show, 1, 2).id], sourceTitle: 'x', quality: q(WEBDL1080), date: new Date(NOW.getTime() - 3600_000).toISOString() });
    const title = 'Fake.Show.S01E02.1080p.WEB-DL-GRP';
    const d = await decide(title);
    expect(d.rejections).toEqual([{ reason: 'Has been grabbed recently', type: 'temporary' }]);
    expect(d.temporarilyRejected).toBe(true);
    expect((await decide(title, {}, { searchCriteria: { series: f.show, episodes: [f.ep(f.show, 1, 2)] } })).approved).toBe(true);
    expect((await decide('Fake.Show.S01E02.1080p.BluRay.x264-GRP')).approved).toBe(true);
    expect((await decide(title, {}, { now: new Date(NOW.getTime() + 24 * 3600_000) })).approved).toBe(true);
  });

  it('collects every rejection', async () => {
    t.app.sqlite.prepare('update series set monitored = 0 where id = ?').run(f.show.id);
    const d = await decide('Fake.Show.S01E01.720p.HDTV-GRP', { size: 1024 });
    expect(reasons(d)).toEqual(['Quality HDTV-720p is not wanted in profile', 'Series is not monitored', '1.0 KB is smaller than minimum allowed 135.0 MB']);
  });
});

describe('sortDecisions', () => {
  const mk = (id: string, approved: boolean, release: Partial<ReleaseInfo>, quality = q(WEBDL1080)): DownloadDecision => ({
    remoteEpisode: {
      release: makeRelease({ guid: id, ...release }),
      parsed: { quality } as DownloadDecision['remoteEpisode']['parsed'],
      episodes: [],
    },
    rejections: approved ? [] : [{ reason: 'x', type: 'permanent' }],
    approved,
    temporarilyRejected: false,
  });

  it.each([
    ['approved first', [mk('b', false, {}, q(BLURAY1080)), mk('a', true, {}, q(SDTV))]],
    ['quality weight desc', [mk('b', true, {}, q(WEBDL1080)), mk('a', true, {}, q(BLURAY1080))]],
    ['revision desc', [mk('b', true, {}, q(WEBDL1080, 1)), mk('a', true, {}, q(WEBDL1080, 2))]],
    ['indexer priority asc', [mk('b', true, { indexerPriority: 30 }), mk('a', true, { indexerPriority: 10 })]],
    ['usenet before torrent', [mk('b', true, { protocol: 'torrent', seeders: 100 }), mk('a', true, { protocol: 'usenet' })]],
    ['seeders desc', [mk('b', true, { protocol: 'torrent', seeders: 1 }), mk('a', true, { protocol: 'torrent', seeders: 50 })]],
    ['newest first', [mk('b', true, { publishDate: '2024-01-01T00:00:00Z' }), mk('a', true, { publishDate: '2024-02-01T00:00:00Z' })]],
  ])('%s', (_name, decisions) => {
    expect(sortDecisions(decisions).map((d) => d.remoteEpisode.release.guid)).toEqual(['a', 'b']);
  });

  it('weighs quality above indexer priority and protocol', () => {
    const sorted = sortDecisions([
      mk('c', true, { protocol: 'torrent', indexerPriority: 50 }, q(SDTV)),
      mk('b', true, { indexerPriority: 1 }, q(WEBDL1080)),
      mk('a', true, { protocol: 'torrent', indexerPriority: 50 }, q(BLURAY1080)),
    ]);
    expect(sorted.map((d) => d.remoteEpisode.release.guid)).toEqual(['a', 'b', 'c']);
  });
});
