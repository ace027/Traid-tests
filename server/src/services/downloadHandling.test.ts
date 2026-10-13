import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUALITIES, type QualityModel } from '@sonarr/shared';
import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';
import { queue as queueSpec, type SpecInput } from '../decision/specifications.js';
import { setDownloadClientFactory } from '../downloadClients/registry.js';
import { FakeDownloadClient } from '../test/fakeDownloadClient.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { isBlocklisted } from './blocklist.js';
import { recordGrabbed } from './history.js';
import { getDownloadClientConfig, saveDownloadClientConfig } from './mediaConfig.js';
import { getQueue } from './queue.js';

let t: TestApp;
let root: string;
let dl: string;
let seriesId: number;
let seriesPath: string;
let sab: FakeDownloadClient;
let qbit: FakeDownloadClient;

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { 'x-api-key': t.apiKey }, payload: payload as object });

const hdtv: QualityModel = { quality: QUALITIES.find((q) => q.name === 'HDTV-720p')!, revision: { version: 1, real: 0, isRepack: false } };

const epId = (season: number, episode: number) =>
  t.app.db.select().from(schema.episodes).all().find((e) => e.seriesId === seriesId && e.seasonNumber === season && e.episodeNumber === episode)!.id;

const write = (rel: string, content = 'video-data') => {
  const full = path.join(dl, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

const events = (type: string) => t.app.db.select().from(schema.history).all().filter((h) => h.eventType === type);

async function refresh() {
  t.app.commands.enqueue('RefreshMonitoredDownloads', {});
  await t.app.commands.waitForIdle();
}

async function queueRecords() {
  return (await req('GET', '/api/v3/queue?includeUnknownSeriesItems=true')).json().records as {
    downloadId: string;
    trackedDownloadState: string;
    trackedDownloadStatus: string;
    statusMessages: { title: string; messages: string[] }[];
  }[];
}

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
  sab = new FakeDownloadClient('sab');
  qbit = new FakeDownloadClient('qb');
  setDownloadClientFactory((cfg) => (cfg.implementation.toLowerCase() === 'sabnzbd' ? sab : qbit));
  for (const [name, implementation] of [['sab', 'SABnzbd'], ['qbit', 'QBittorrent']]) {
    expect((await req('POST', '/api/v3/downloadclient', { name, implementation, settings: { host: name, port: 1 } })).statusCode).toBe(201);
  }
});

afterEach(async () => {
  setDownloadClientFactory(null);
  await t.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dl, { recursive: true, force: true });
});

const imported = path.join('Season 01', 'Fake Show - S01E01 - Episode 1 HDTV-720p.mkv');

describe('completed download handling', () => {
  it('imports a completed usenet download and removes it from the client', async () => {
    recordGrabbed(t.app, { seriesId, episodeIds: [epId(1, 1)], sourceTitle: 'Fake.Show.S01E01.720p.HDTV-GRP', quality: hdtv, downloadId: 'nzo1' });
    const src = write('Fake.Show.S01E01.720p.HDTV-GRP/Fake.Show.S01E01.720p.HDTV-GRP.mkv');
    sab.items = [
      FakeDownloadClient.item({ downloadId: 'nzo1', status: 'completed', remainingSize: 0, outputPath: path.dirname(src), canMoveFiles: true, canBeRemoved: true }),
    ];
    await refresh();
    expect(fs.readFileSync(path.join(seriesPath, imported), 'utf8')).toBe('video-data');
    expect(fs.existsSync(src)).toBe(false);
    expect(sab.removed).toEqual([{ downloadId: 'nzo1', deleteData: true }]);
    expect(await queueRecords()).toEqual([]);
    const [h] = events('downloadFolderImported');
    expect(h).toMatchObject({ downloadId: 'nzo1', sourceTitle: 'Fake.Show.S01E01.720p.HDTV-GRP' });
    expect(JSON.parse(h!.data)).toMatchObject({ downloadClient: 'sab', downloadId: 'nzo1' });
  });

  it('hardlinks a seeding torrent and keeps it in the client', async () => {
    recordGrabbed(t.app, { seriesId, episodeIds: [epId(1, 1)], sourceTitle: 'Fake.Show.S01E01.720p.HDTV-GRP', quality: hdtv, downloadId: 'abcdef' });
    const src = write('Fake.Show.S01E01.720p.HDTV-GRP.mkv');
    qbit.items = [FakeDownloadClient.item({ downloadId: 'ABCDEF', status: 'completed', remainingSize: 0, outputPath: src, canMoveFiles: false, canBeRemoved: false })];
    await refresh();
    const dest = path.join(seriesPath, imported);
    expect(fs.statSync(dest).ino).toBe(fs.statSync(src).ino);
    expect(qbit.removed).toEqual([]);
    expect((await queueRecords())[0]).toMatchObject({ downloadId: 'ABCDEF', trackedDownloadState: 'imported' });
    await refresh();
    expect(events('downloadFolderImported')).toHaveLength(1);
  });

  it('copies a torrent when hardlinks are disabled', async () => {
    t.app.db.insert(schema.config).values({ key: 'mediamanagement', value: JSON.stringify({ copyUsingHardlinks: false }) }).run();
    recordGrabbed(t.app, { seriesId, episodeIds: [epId(1, 1)], sourceTitle: 'Fake.Show.S01E01.720p.HDTV-GRP', quality: hdtv, downloadId: 'hash1' });
    const src = write('Fake.Show.S01E01.720p.HDTV-GRP.mkv');
    qbit.items = [FakeDownloadClient.item({ downloadId: 'hash1', status: 'completed', remainingSize: 0, outputPath: src, canBeRemoved: true })];
    await refresh();
    expect(fs.statSync(path.join(seriesPath, imported)).ino).not.toBe(fs.statSync(src).ino);
    expect(qbit.removed).toEqual([{ downloadId: 'hash1', deleteData: true }]);
  });

  it('keeps a partially rejected download pending with a warning per file', async () => {
    recordGrabbed(t.app, { seriesId, episodeIds: [epId(1, 1), epId(1, 2)], sourceTitle: 'Fake.Show.S01.720p.HDTV-GRP', quality: hdtv, downloadId: 'nzo2' });
    write('pack/Fake.Show.S01E01.720p.HDTV-GRP.mkv');
    write('pack/garbage.mkv');
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo2', status: 'completed', remainingSize: 0, outputPath: path.join(dl, 'pack'), canMoveFiles: true, canBeRemoved: true })];
    await refresh();
    expect(fs.existsSync(path.join(seriesPath, imported))).toBe(true);
    expect(sab.removed).toEqual([]);
    const [r] = await queueRecords();
    expect(r).toMatchObject({ trackedDownloadState: 'importPending', trackedDownloadStatus: 'warning' });
    expect(r!.statusMessages).toEqual([{ title: 'garbage.mkv', messages: ['Unable to parse file'] }]);
  });

  it('warns when no file is eligible for import', async () => {
    recordGrabbed(t.app, { seriesId, episodeIds: [epId(1, 1)], sourceTitle: 'x', quality: hdtv, downloadId: 'nzo3' });
    fs.mkdirSync(path.join(dl, 'empty'));
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo3', status: 'completed', remainingSize: 0, outputPath: path.join(dl, 'empty') })];
    await refresh();
    const [r] = await queueRecords();
    expect(r!.statusMessages[0]!.messages).toEqual([`No files found are eligible for import in ${path.join(dl, 'empty')}`]);
  });

  it('does nothing when completed download handling is disabled', async () => {
    saveDownloadClientConfig(t.app.db, { ...getDownloadClientConfig(t.app.db), enableCompletedDownloadHandling: false });
    recordGrabbed(t.app, { seriesId, episodeIds: [epId(1, 1)], sourceTitle: 'Fake.Show.S01E01.720p.HDTV-GRP', quality: hdtv, downloadId: 'nzo1' });
    const src = write('Fake.Show.S01E01.720p.HDTV-GRP.mkv');
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1', status: 'completed', remainingSize: 0, outputPath: src, canMoveFiles: true, canBeRemoved: true })];
    await refresh();
    expect(fs.existsSync(src)).toBe(true);
    expect(events('downloadFolderImported')).toEqual([]);
    expect((await queueRecords())[0]).toMatchObject({ trackedDownloadState: 'importPending', trackedDownloadStatus: 'ok' });
  });

  it('never runs two imports of the same download at once', async () => {
    const queue = getQueue(t.app);
    let release!: () => void;
    const first = queue.withImportGuard('Nzo1', () => new Promise<string>((r) => (release = () => r('first'))));
    expect(await queue.withImportGuard('nzo1', async () => 'second')).toBeUndefined();
    release();
    expect(await first).toBe('first');
    expect(await queue.withImportGuard('nzo1', async () => 'third')).toBe('third');
  });
});

describe('failed download handling', () => {
  it('records history, blocklists, removes and searches again once', async () => {
    t.app.db.update(schema.downloadClients).set({ removeFailedDownloads: false }).where(eq(schema.downloadClients.name, 'sab')).run();
    const ep = epId(1, 1);
    recordGrabbed(t.app, { seriesId, episodeIds: [ep], sourceTitle: 'Fake.Show.S01E01.720p.HDTV-GRP', quality: hdtv, downloadId: 'nzo9', data: { indexer: 'geek' } });
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo9', status: 'failed', message: 'CRC error' })];
    await refresh();
    const [h] = events('downloadFailed');
    expect(h).toMatchObject({ downloadId: 'nzo9', episodeId: ep });
    expect(JSON.parse(h!.data)).toMatchObject({ message: 'CRC error', downloadClient: 'sab', indexer: 'geek' });
    expect(isBlocklisted(t.app.db, seriesId, { title: 'Fake.Show.S01E01.720p.HDTV-GRP', indexer: 'geek' })).toBe(true);
    const searches = () => t.app.commands.list().filter((c) => c.name === 'EpisodeSearch');
    expect(searches()).toHaveLength(1);
    expect(JSON.parse(searches()[0]!.body)).toMatchObject({ episodeIds: [ep] });
    expect((await queueRecords())[0]).toMatchObject({ trackedDownloadState: 'failed' });

    await refresh();
    expect(events('downloadFailed')).toHaveLength(1);
    expect(t.app.db.select().from(schema.blocklist).all()).toHaveLength(1);
    expect(searches()).toHaveLength(1);
    expect(sab.removed).toEqual([]);
  });

  it('removes the failed item when the client says so and skips the search when disabled', async () => {
    saveDownloadClientConfig(t.app.db, { ...getDownloadClientConfig(t.app.db), autoRedownloadFailed: false });
    recordGrabbed(t.app, { seriesId, episodeIds: [epId(1, 1)], sourceTitle: 'x', quality: hdtv, downloadId: 'nzo8' });
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo8', status: 'failed' })];
    await refresh();
    expect(sab.removed).toEqual([{ downloadId: 'nzo8', deleteData: true }]);
    expect(t.app.commands.list().filter((c) => c.name === 'EpisodeSearch')).toEqual([]);
    expect(await queueRecords()).toEqual([]);
  });

  it('the queue specification ignores failed and imported items', () => {
    const input = (state?: string) =>
      ({
        quality: hdtv,
        profile: { upgradeAllowed: true, cutoff: QUALITIES.at(-1)!.id, allowed: new Set([hdtv.quality.id]) },
        queued: [{ ...hdtv, ...(state ? { trackedDownloadState: state } : {}) }],
      }) as unknown as SpecInput;
    expect(queueSpec(input('downloading'))?.reason).toMatch(/Release in queue/);
    expect(queueSpec(input())?.reason).toMatch(/Release in queue/);
    for (const state of ['failed', 'failedPending', 'imported']) expect(queueSpec(input(state))).toBeNull();
  });
});
