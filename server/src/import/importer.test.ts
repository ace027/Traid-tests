import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '../db/index.js';
import { FakeMetadataProvider, makeEpisode, makeShow } from '../test/fakeMetadata.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { getMediaManagementConfig, getNamingConfig, saveMediaManagementConfig, saveNamingConfig } from '../services/mediaConfig.js';
import { getImportDecisions } from './decisions.js';
import { importDecisions } from './importer.js';
import type { TransferMode } from './types.js';

let t: TestApp;
let root: string;
let dl: string;
const tmp: string[] = [];

const mktmp = (prefix: string) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
};

const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { 'x-api-key': t.apiKey }, payload: payload as object });

const write = (base: string, rel: string, content = 'video-data') => {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

async function addSeries(tvMazeId: number, extra: Record<string, unknown> = {}): Promise<{ id: number; path: string }> {
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  const res = await req('POST', '/api/v3/series', { tvMazeId, qualityProfileId: profileId, rootFolderPath: root, ...extra });
  expect(res.statusCode).toBe(201);
  await t.app.commands.waitForIdle();
  return res.json();
}

const episode = (seriesId: number, season: number, number: number) =>
  t.app.db.select().from(schema.episodes).all().find((e) => e.seriesId === seriesId && e.seasonNumber === season && e.episodeNumber === number)!;

const history = () => t.app.db.select().from(schema.history).all();

async function importPath(source: string, mode: TransferMode = 'move', opts: Parameters<typeof getImportDecisions>[2] = {}) {
  const decisions = await getImportDecisions(t.app, source, opts);
  return importDecisions(t.app, decisions, { mode });
}

let show: { id: number; path: string };

beforeEach(async () => {
  const metadata = new FakeMetadataProvider();
  metadata.addShow(makeShow(900, 'Show', { year: 2010, tvdbId: 9900 }), [
    makeEpisode(9001, 1, 1, '2010-01-01', 'Pilot'),
    makeEpisode(9002, 1, 2, '2010-01-08', 'Second'),
    makeEpisode(9003, 1, 3, '2010-01-15', 'Third'),
  ]);
  t = await createTestApp({ metadataProvider: metadata });
  root = mktmp('sonarr-root-');
  dl = mktmp('sonarr-dl-');
  await req('POST', '/api/v3/rootfolder', { path: root });
  show = await addSeries(900);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await t.cleanup();
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('import pipeline', () => {
  it('imports and renames a file into the series and season folder', async () => {
    const src = write(dl, 'Show.S01E01.720p.HDTV-GRP/Show.S01E01.720p.HDTV-GRP.mkv');
    const [r] = await importPath(path.dirname(src));
    const dest = path.join(root, 'Show (2010)', 'Season 01', 'Show - S01E01 - Pilot HDTV-720p.mkv');
    expect(r).toMatchObject({ result: 'imported', importedPath: dest });
    expect(fs.readFileSync(dest, 'utf8')).toBe('video-data');
    expect(fs.existsSync(src)).toBe(false);
    const ep = episode(show.id, 1, 1);
    const file = t.app.db.select().from(schema.episodeFiles).all().find((f) => f.id === ep.episodeFileId)!;
    expect(file).toMatchObject({ path: dest, relativePath: path.join('Season 01', 'Show - S01E01 - Pilot HDTV-720p.mkv'), releaseGroup: 'GRP', size: 10 });
    const [h] = history().filter((x) => x.eventType === 'downloadFolderImported');
    expect(h).toMatchObject({ seriesId: show.id, episodeId: ep.id });
    expect(JSON.parse(h!.data)).toMatchObject({ droppedPath: src, importedPath: dest });
  });

  it('imports a multi-episode file and every episode of a folder, skipping samples', async () => {
    write(dl, 'pack/Show.S01E01E02.720p.HDTV-GRP.mkv', 'multi');
    write(dl, 'pack/Show.S01E03.720p.HDTV-GRP.mkv', 'three');
    write(dl, 'pack/Show.S01E03.720p.HDTV-GRP.sample.mkv', 's');
    write(dl, 'pack/Sample/Show.S01E02.720p.HDTV-GRP.mkv', 's');
    write(dl, 'pack/Show.S01E03.nfo', 'text');
    const decisions = await getImportDecisions(t.app, path.join(dl, 'pack'));
    expect(decisions.map((d) => path.basename(d.source.path))).toEqual(['Show.S01E01E02.720p.HDTV-GRP.mkv', 'Show.S01E03.720p.HDTV-GRP.mkv']);
    const results = await importDecisions(t.app, decisions, { mode: 'move' });
    expect(results.map((r) => r.result)).toEqual(['imported', 'imported']);
    expect(path.basename(results[0]!.importedPath!)).toBe('Show - S01E01-E02 - Pilot + Second HDTV-720p.mkv');
    const e1 = episode(show.id, 1, 1);
    expect(e1.episodeFileId).not.toBeNull();
    expect(episode(show.id, 1, 2).episodeFileId).toBe(e1.episodeFileId);
    expect(episode(show.id, 1, 3).episodeFileId).not.toBe(e1.episodeFileId);
  });

  it('uses the daily format for daily series', async () => {
    const daily = await addSeries(300, { seriesType: 'daily' });
    const src = write(dl, 'Daily.Show.2015.03.03.720p.HDTV-GRP.mkv');
    const [r] = await importPath(src);
    expect(r!.result).toBe('imported');
    expect(r!.importedPath).toBe(path.join(daily.path, 'Season 01', 'Daily Show - 2015-03-03 - Episode 2 HDTV-720p.mkv'));
  });

  it('replaces a lower quality file into the recycle bin on upgrade', async () => {
    await importPath(write(dl, 'a/Show.S01E01.720p.HDTV-GRP.mkv', 'old'));
    const recycle = mktmp('sonarr-recycle-');
    saveMediaManagementConfig(t.app.db, { ...getMediaManagementConfig(t.app.db), recycleBin: recycle });
    const [r] = await importPath(write(dl, 'b/Show.S01E01.1080p.WEB-DL-GRP.mkv', 'new'));
    expect(r!.result).toBe('imported');
    const season = path.join(show.path, 'Season 01');
    expect(fs.readdirSync(season)).toEqual(['Show - S01E01 - Pilot WEBDL-1080p.mkv']);
    expect(fs.readFileSync(path.join(recycle, 'Show (2010)', 'Season 01', 'Show - S01E01 - Pilot HDTV-720p.mkv'), 'utf8')).toBe('old');
    const events = history().map((h) => h.eventType);
    expect(events).toEqual(['downloadFolderImported', 'episodeFileDeleted', 'downloadFolderImported']);
    expect(JSON.parse(history()[1]!.data)).toMatchObject({ reason: 'upgrade' });
    expect(t.app.db.select().from(schema.episodeFiles).all()).toHaveLength(1);
  });

  it('deletes the replaced file when no recycle bin is set', async () => {
    await importPath(write(dl, 'a/Show.S01E01.720p.HDTV-GRP.mkv', 'old'));
    await importPath(write(dl, 'b/Show.S01E01.1080p.WEB-DL-GRP.mkv', 'new'));
    expect(fs.readdirSync(path.join(show.path, 'Season 01'))).toEqual(['Show - S01E01 - Pilot WEBDL-1080p.mkv']);
  });

  it('rejects a file that is not an upgrade and leaves it in place', async () => {
    await importPath(write(dl, 'a/Show.S01E01.1080p.WEB-DL-GRP.mkv', 'better'));
    const src = write(dl, 'b/Show.S01E01.720p.HDTV-GRP.mkv', 'worse');
    const decisions = await getImportDecisions(t.app, src);
    expect(decisions[0]!.rejections.map((r) => r.reason)).toEqual(['Not an upgrade for existing episode file(s)']);
    const [r] = await importDecisions(t.app, decisions, { mode: 'move' });
    expect(r).toMatchObject({ result: 'rejected', message: 'Not an upgrade for existing episode file(s)' });
    expect(fs.existsSync(src)).toBe(true);
  });

  it('treats a proper of the same quality as an upgrade only with preferAndUpgrade', async () => {
    await importPath(write(dl, 'a/Show.S01E01.720p.HDTV-GRP.mkv', 'old'));
    const src = write(dl, 'b/Show.S01E01.PROPER.720p.HDTV-GRP.mkv', 'proper');
    saveMediaManagementConfig(t.app.db, { ...getMediaManagementConfig(t.app.db), downloadPropersAndRepacks: 'doNotUpgrade' });
    expect((await getImportDecisions(t.app, src))[0]!.approved).toBe(false);
    saveMediaManagementConfig(t.app.db, { ...getMediaManagementConfig(t.app.db), downloadPropersAndRepacks: 'preferAndUpgrade' });
    expect((await getImportDecisions(t.app, src))[0]!.approved).toBe(true);
  });

  it('rejects unparseable files and unknown series', async () => {
    write(dl, 'mixed/random-video.mkv');
    write(dl, 'mixed/Other.Series.S01E01.720p.HDTV-GRP.mkv');
    const decisions = await getImportDecisions(t.app, path.join(dl, 'mixed'));
    expect(decisions.map((d) => [path.basename(d.source.path), d.rejections.map((r) => r.reason)])).toEqual([
      ['Other.Series.S01E01.720p.HDTV-GRP.mkv', ['Unknown Series']],
      ['random-video.mkv', ['Unable to parse file']],
    ]);
  });

  it('rejects a sample or a non-video file given directly', async () => {
    const sample = write(dl, 'Show.S01E01.720p.HDTV-GRP.sample.mkv');
    expect((await getImportDecisions(t.app, sample))[0]!.rejections[0]!.reason).toBe('Sample');
    const nfo = write(dl, 'Show.S01E01.720p.HDTV-GRP.nfo');
    expect((await getImportDecisions(t.app, nfo))[0]!.rejections[0]!.reason).toBe('Not a video file');
  });

  it('rejects when there is not enough free space', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1, bsize: 4096 } as fs.StatsFs);
    const src = write(dl, 'Show.S01E01.720p.HDTV-GRP.mkv');
    expect((await getImportDecisions(t.app, src))[0]!.rejections.map((r) => r.reason)).toEqual(['Not enough free space']);
    saveMediaManagementConfig(t.app.db, { ...getMediaManagementConfig(t.app.db), skipFreeSpaceCheckWhenImporting: true });
    expect((await getImportDecisions(t.app, src))[0]!.approved).toBe(true);
  });

  it('copy mode keeps the source; an existing destination name gets a suffix', async () => {
    const season = path.join(show.path, 'Season 01');
    write(season, 'Show - S01E01 - Pilot HDTV-720p.mkv', 'someone else');
    const src = write(dl, 'Show.S01E01.720p.HDTV-GRP.mkv');
    const [r] = await importPath(src, 'copy');
    expect(r!.importedPath).toBe(path.join(season, 'Show - S01E01 - Pilot HDTV-720p (1).mkv'));
    expect(fs.readFileSync(src, 'utf8')).toBe('video-data');
    expect(fs.readFileSync(path.join(season, 'Show - S01E01 - Pilot HDTV-720p.mkv'), 'utf8')).toBe('someone else');
  });

  it('hardlinks when asked', async () => {
    const src = write(dl, 'Show.S01E01.720p.HDTV-GRP.mkv');
    const [r] = await importPath(src, 'hardlink');
    expect(fs.statSync(r!.importedPath!).ino).toBe(fs.statSync(src).ino);
  });

  it('falls back to copy and unlink when a move crosses devices', async () => {
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }));
    const src = write(dl, 'Show.S01E01.720p.HDTV-GRP.mkv');
    const [r] = await importPath(src, 'move');
    expect(r!.result).toBe('imported');
    expect(fs.readFileSync(r!.importedPath!, 'utf8')).toBe('video-data');
    expect(fs.existsSync(src)).toBe(false);
  });

  it('a failed transfer leaves the source intact and no partial destination', async () => {
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('read-only file system'), { code: 'EROFS' }));
    const src = write(dl, 'Show.S01E01.720p.HDTV-GRP.mkv');
    const [r] = await importPath(src, 'move');
    expect(r).toMatchObject({ result: 'failed' });
    expect(r!.message).toMatch(/read-only/);
    expect(fs.readFileSync(src, 'utf8')).toBe('video-data');
    expect(episode(show.id, 1, 1).episodeFileId).toBeNull();
    expect(history()).toEqual([]);

    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (_s, d) => {
      fs.writeFileSync(d as string, 'partial');
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    });
    const [c] = await importPath(src, 'copy');
    expect(c!.result).toBe('failed');
    expect(fs.readFileSync(src, 'utf8')).toBe('video-data');
    expect(fs.readdirSync(path.join(show.path, 'Season 01'))).toEqual([]);
  });

  it('keeps the original file name when renaming is off', async () => {
    saveNamingConfig(t.app.db, { ...getNamingConfig(t.app.db), renameEpisodes: false });
    const [r] = await importPath(write(dl, 'Show.S01E01.720p.HDTV-GRP.mkv'));
    expect(r!.importedPath).toBe(path.join(show.path, 'Season 01', 'Show.S01E01.720p.HDTV-GRP.mkv'));
  });

  it('imports extra files next to the episode when enabled', async () => {
    saveMediaManagementConfig(t.app.db, { ...getMediaManagementConfig(t.app.db), importExtraFiles: true });
    write(dl, 'x/Show.S01E01.720p.HDTV-GRP.en.srt', 'subs');
    const [r] = await importPath(write(dl, 'x/Show.S01E01.720p.HDTV-GRP.mkv'));
    expect(fs.readFileSync(path.join(show.path, 'Season 01', 'Show - S01E01 - Pilot HDTV-720p.en.srt'), 'utf8')).toBe('subs');
    expect(r!.result).toBe('imported');
  });

  it('rejects a file that was already imported', async () => {
    const src = write(dl, 'Show.S01E01.720p.HDTV-GRP.mkv');
    await importPath(src, 'copy');
    const reasons = (await getImportDecisions(t.app, src))[0]!.rejections.map((r) => r.reason);
    expect(reasons).toContain('Episode file already imported');
  });
});
