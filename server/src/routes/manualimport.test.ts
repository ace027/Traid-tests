import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUALITIES, type ManualImportItem, type RenamePreview } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { setDownloadClientFactory } from '../downloadClients/registry.js';
import { getNamingConfig, saveNamingConfig } from '../services/mediaConfig.js';
import { FakeDownloadClient } from '../test/fakeDownloadClient.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp;
let root: string;
let dl: string;
let seriesId: number;
let seriesPath: string;

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { 'x-api-key': t.apiKey }, payload: payload as object });

const write = (base: string, rel: string, content = 'video-data') => {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

const epId = (season: number, episode: number) =>
  t.app.db.select().from(schema.episodes).all().find((e) => e.seriesId === seriesId && e.seasonNumber === season && e.episodeNumber === episode)!.id;

async function run(name: string, body: Record<string, unknown> = {}) {
  const cmd = t.app.commands.enqueue(name, body);
  await t.app.commands.waitForIdle();
  return t.app.commands.get(cmd.id)!;
}

const hdtv = { quality: QUALITIES.find((q) => q.name === 'HDTV-720p')!, revision: { version: 1, real: 0, isRepack: false } };

beforeEach(async () => {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  dl = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-dl-')));
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  const created = (await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: profileId, rootFolderPath: root })).json();
  seriesId = created.id;
  seriesPath = created.path;
  await t.app.commands.waitForIdle();
});

afterEach(async () => {
  setDownloadClientFactory(null);
  await t.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dl, { recursive: true, force: true });
});

describe('GET /api/v3/manualimport', () => {
  it('lists files with their mapped episodes and rejections', async () => {
    write(dl, 'in/Fake.Show.S01E01.720p.HDTV-GRP.mkv');
    write(dl, 'in/sub/garbage.mkv');
    const res = await req('GET', `/api/v3/manualimport?folder=${encodeURIComponent(path.join(dl, 'in'))}`);
    expect(res.statusCode).toBe(200);
    const items = res.json() as ManualImportItem[];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 0,
      relativePath: 'Fake.Show.S01E01.720p.HDTV-GRP.mkv',
      folderName: 'in',
      name: 'Fake.Show.S01E01.720p.HDTV-GRP',
      size: 10,
      series: { id: seriesId, title: 'Fake Show' },
      seasonNumber: 1,
      episodes: [{ id: epId(1, 1), seasonNumber: 1, episodeNumber: 1 }],
      releaseGroup: 'GRP',
      rejections: [],
    });
    expect(items[0]!.quality.quality.name).toBe('HDTV-720p');
    expect(items[1]).toMatchObject({ relativePath: path.join('sub', 'garbage.mkv'), episodes: [], rejections: [{ reason: 'Unable to parse file', type: 'permanent' }] });
  });

  it('validates the folder and resolves a download id to its output path', async () => {
    expect((await req('GET', '/api/v3/manualimport')).statusCode).toBe(400);
    expect((await req('GET', '/api/v3/manualimport?folder=relative/path')).statusCode).toBe(400);
    expect((await req('GET', `/api/v3/manualimport?folder=${encodeURIComponent(path.join(dl, 'missing'))}`)).statusCode).toBe(400);

    const sab = new FakeDownloadClient('sab');
    setDownloadClientFactory(() => sab);
    await req('POST', '/api/v3/downloadclient', { name: 'sab', implementation: 'SABnzbd', settings: { host: 'sab', port: 1 } });
    const src = write(dl, 'done/Fake.Show.S01E02.720p.HDTV-GRP.mkv');
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1', status: 'completed', outputPath: path.dirname(src) })];
    const items = (await req('GET', '/api/v3/manualimport?downloadId=nzo1')).json() as ManualImportItem[];
    expect(items.map((i) => [i.path, i.downloadId, i.episodes[0]?.id])).toEqual([[src, 'nzo1', epId(1, 2)]]);
  });

  it('filters files that already are episode files', async () => {
    write(seriesPath, 'Season 01/Fake Show - S01E01 - Episode 1 HDTV-720p.mkv');
    await run('RescanSeries', { seriesId });
    const url = `/api/v3/manualimport?folder=${encodeURIComponent(seriesPath)}`;
    expect((await req('GET', url)).json()).toEqual([]);
    expect((await req('GET', `${url}&filterExistingFiles=false`)).json()).toHaveLength(1);
  });
});

describe('ManualImport command', () => {
  it('imports a forced mapping and skips a missing path', async () => {
    const src = write(dl, 'unnamed/video-file.mkv');
    const missing = path.join(dl, 'nope.mkv');
    const cmd = await run('ManualImport', {
      importMode: 'copy',
      files: [
        { path: src, seriesId, episodeIds: [epId(1, 2)], quality: hdtv },
        { path: missing, seriesId, episodeIds: [epId(1, 1)], quality: hdtv },
      ],
    });
    expect(cmd.status).toBe('completed');
    expect(cmd.message).toBe(`Imported 1 of 2 files\n${missing}: file not found`);
    const dest = path.join(seriesPath, 'Season 01', 'Fake Show - S01E02 - Episode 2 HDTV-720p.mkv');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(src)).toBe(true);
    const ep = t.app.db.select().from(schema.episodes).where(eq(schema.episodes.id, epId(1, 2))).get()!;
    expect(ep.episodeFileId).not.toBeNull();
  });

  it('lists rejected files in the message', async () => {
    write(seriesPath, 'Season 01/Fake Show - S01E01 - Episode 1 Bluray-1080p.mkv');
    await run('RescanSeries', { seriesId });
    const src = write(dl, 'Fake.Show.S01E01.720p.HDTV-GRP.mkv');
    const cmd = await run('ManualImport', { importMode: 'move', files: [{ path: src, seriesId, episodeIds: [epId(1, 1)], quality: hdtv }] });
    expect(cmd.message).toBe('Imported 0 of 1 files\nFake.Show.S01E01.720p.HDTV-GRP.mkv: Not an upgrade for existing episode file(s)');
    expect(fs.existsSync(src)).toBe(true);
  });
});

describe('rename', () => {
  async function seed() {
    write(seriesPath, 'Season 01/Fake.Show.S01E01.720p.HDTV-GRP.mkv', 'one');
    write(seriesPath, 'Season 01/Fake Show - S01E02 - Episode 2 HDTV-720p.mkv', 'two');
    await run('RescanSeries', { seriesId });
  }

  it('previews only files whose name differs from the naming result', async () => {
    await seed();
    const preview = (await req('GET', `/api/v3/rename?seriesId=${seriesId}`)).json() as RenamePreview[];
    expect(preview).toEqual([
      {
        seriesId,
        seasonNumber: 1,
        episodeNumbers: [1],
        episodeFileId: expect.any(Number),
        existingPath: path.join('Season 01', 'Fake.Show.S01E01.720p.HDTV-GRP.mkv'),
        newPath: path.join('Season 01', 'Fake Show - S01E01 - Episode 1 HDTV-720p.mkv'),
      },
    ]);
    expect((await req('GET', `/api/v3/rename?seriesId=${seriesId}&seasonNumber=2`)).json()).toEqual([]);
    expect((await req('GET', '/api/v3/rename?seriesId=9999')).statusCode).toBe(404);
    expect((await req('GET', '/api/v3/rename')).statusCode).toBe(400);
  });

  it('RenameFiles renames on disk and updates the database and history', async () => {
    await seed();
    const [p] = (await req('GET', `/api/v3/rename?seriesId=${seriesId}`)).json() as RenamePreview[];
    const cmd = await run('RenameFiles', { seriesId, files: [p!.episodeFileId] });
    expect(cmd).toMatchObject({ status: 'completed', message: 'Renamed 1 file' });
    const newAbs = path.join(seriesPath, p!.newPath);
    expect(fs.readFileSync(newAbs, 'utf8')).toBe('one');
    expect(fs.existsSync(path.join(seriesPath, p!.existingPath))).toBe(false);
    const row = t.app.db.select().from(schema.episodeFiles).where(eq(schema.episodeFiles.id, p!.episodeFileId)).get()!;
    expect(row).toMatchObject({ path: newAbs, relativePath: p!.newPath });
    const [h] = t.app.db.select().from(schema.history).all().filter((x) => x.eventType === 'episodeFileRenamed');
    expect(h).toMatchObject({ seriesId, episodeId: epId(1, 1), sourceTitle: p!.existingPath });
    expect(JSON.parse(h!.data)).toMatchObject({ relativePath: p!.newPath });
    expect((await req('GET', `/api/v3/rename?seriesId=${seriesId}`)).json()).toEqual([]);
  });

  it('RenameSeries renames every file after a naming change', async () => {
    await seed();
    saveNamingConfig(t.app.db, { ...getNamingConfig(t.app.db), standardEpisodeFormat: '{Series Title} S{season:00}E{episode:00}' });
    expect(await run('RenameSeries', { seriesIds: [seriesId] })).toMatchObject({ status: 'completed', message: 'Renamed 2 files' });
    expect(fs.readdirSync(path.join(seriesPath, 'Season 01')).sort()).toEqual(['Fake Show S01E01.mkv', 'Fake Show S01E02.mkv']);
  });

  it('refuses to rename a file outside the series folder', async () => {
    await seed();
    const outside = write(dl, 'elsewhere/Fake.Show.S01E01.720p.HDTV-GRP.mkv', 'outside');
    const [p] = (await req('GET', `/api/v3/rename?seriesId=${seriesId}`)).json() as RenamePreview[];
    t.app.db.update(schema.episodeFiles).set({ path: outside }).where(eq(schema.episodeFiles.id, p!.episodeFileId)).run();
    const cmd = await run('RenameFiles', { seriesId, files: [p!.episodeFileId] });
    expect(cmd.status).toBe('failed');
    expect(cmd.message).toContain('outside the series folder');
    expect(fs.readFileSync(outside, 'utf8')).toBe('outside');
  });
});
