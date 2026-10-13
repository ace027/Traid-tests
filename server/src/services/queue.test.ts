import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QUALITIES, type QualityModel } from '@sonarr/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { FakeDownloadClient } from '../test/fakeDownloadClient.js';
import { setDownloadClientFactory } from '../downloadClients/registry.js';
import { isBlocklisted } from './blocklist.js';
import { recordGrabbed } from './history.js';
import { registerQueue } from './queue.js';

let t: TestApp | undefined;
let root: string | undefined;
afterEach(async () => {
  setDownloadClientFactory(null);
  await t?.cleanup();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  t = undefined;
  root = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

const quality: QualityModel = { quality: QUALITIES[1]!, revision: { version: 1, real: 0, isRepack: false } };

async function setup() {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  const seriesId = (await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: profileId, rootFolderPath: root })).json().id as number;
  const eps = (t.app.sqlite.prepare('select id from episodes where series_id = ? order by id').all(seriesId) as { id: number }[]).map((r) => r.id);

  const sab = new FakeDownloadClient('sab');
  const qbit = new FakeDownloadClient('qb');
  setDownloadClientFactory((cfg) => (cfg.implementation === 'sabnzbd' || cfg.implementation === 'SABnzbd' ? sab : qbit));
  const mk = async (name: string, implementation: string) =>
    (await req('POST', '/api/v3/downloadclient', { name, implementation, settings: { host: name, port: 1234 } })).json().id as number;
  const sabId = await mk('sab', 'SABnzbd');
  const qbitId = await mk('qbit', 'QBittorrent');
  return { seriesId, eps, sab, qbit, sabId, qbitId, queue: registerQueue(t.app) };
}

describe('queue', () => {
  it('maps items to series and episodes through the grabbed history', async () => {
    const { seriesId, eps, sab, qbit, queue } = await setup();
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[0]!, eps[1]!], sourceTitle: 'Show.S01.720p', quality, downloadId: 'nzo1', data: { indexer: 'NZBgeek' } });
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[2]!], sourceTitle: 'Show.S01E03', quality, downloadId: 'abcdef' });
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1', title: 'Show.S01.720p', totalSize: 1000, remainingSize: 250, remainingTimeSeconds: 3725, status: 'downloading' })];
    qbit.items = [FakeDownloadClient.item({ downloadId: 'ABCDEF', title: 'Show.S01E03', totalSize: 100, remainingSize: 0, status: 'completed', outputPath: '/dl/Show.S01E03' })];
    await queue.refresh();

    const page = (await req('GET', '/api/v3/queue')).json();
    expect(page).toMatchObject({ page: 1, pageSize: 20, totalRecords: 2, sortKey: 'timeleft' });
    const [a, b] = page.records;
    expect(a).toMatchObject({
      seriesId,
      episodeIds: [eps[0], eps[1]],
      title: 'Show.S01.720p',
      size: 1000,
      sizeleft: 250,
      timeleft: '01:02:05',
      status: 'downloading',
      trackedDownloadState: 'downloading',
      trackedDownloadStatus: 'ok',
      downloadId: 'nzo1',
      protocol: 'usenet',
      downloadClient: 'sab',
      indexer: 'NZBgeek',
      seasonNumber: (t!.app.sqlite.prepare('select season_number s from episodes where id = ?').get(eps[0]) as { s: number }).s,
    });
    expect(a.estimatedCompletionTime).toBeTruthy();
    expect(b).toMatchObject({ trackedDownloadState: 'importPending', trackedDownloadStatus: 'ok', protocol: 'torrent', seriesId, outputPath: '/dl/Show.S01E03' });
    expect(a.id).not.toBe(b.id);

    // ids are stable across refreshes
    await queue.refresh();
    const again = (await req('GET', '/api/v3/queue')).json();
    expect(again.records.map((r: { id: number }) => r.id)).toEqual([a.id, b.id]);

    const details = (await req('GET', `/api/v3/queue/details?seriesId=${seriesId}`)).json();
    expect(details).toHaveLength(2);
    expect((await req('GET', `/api/v3/queue/details?episodeIds=${eps[2]}`)).json()).toHaveLength(1);
    expect((await req('GET', '/api/v3/queue/details?seriesId=9999')).json()).toHaveLength(0);
  });

  it('sorts and pages', async () => {
    const { seriesId, eps, sab, queue } = await setup();
    sab.items = [];
    for (const [i, id] of ['n1', 'n2', 'n3'].entries()) {
      recordGrabbed(t!.app, { seriesId, episodeIds: [eps[i]!], sourceTitle: id, quality, downloadId: id });
      sab.items.push(FakeDownloadClient.item({ downloadId: id, title: `T${3 - i}`, totalSize: 100, remainingSize: 10 * (i + 1), remainingTimeSeconds: 100 - i }));
    }
    await queue.refresh();
    const ids = async (qs: string) => ((await req('GET', `/api/v3/queue?${qs}`)).json().records as { downloadId: string }[]).map((r) => r.downloadId);
    expect(await ids('sortKey=title')).toEqual(['n3', 'n2', 'n1']);
    expect(await ids('sortKey=timeleft')).toEqual(['n3', 'n2', 'n1']);
    expect(await ids('sortKey=progress&sortDirection=descending')).toEqual(['n1', 'n2', 'n3']);
    expect(await ids('pageSize=2&page=2')).toEqual(['n1']);
    expect((await req('GET', '/api/v3/queue?pageSize=1001')).statusCode).toBe(400);
    expect((await req('GET', '/api/v3/queue?sortKey=bogus')).statusCode).toBe(400);
  });

  it('hides unknown items unless requested and flags them', async () => {
    const { sab, queue } = await setup();
    sab.items = [FakeDownloadClient.item({ downloadId: 'mystery', title: 'Some.Show.S02E05.1080p.WEB-DL' })];
    await queue.refresh();
    expect((await req('GET', '/api/v3/queue')).json().totalRecords).toBe(0);
    const all = (await req('GET', '/api/v3/queue?includeUnknownSeriesItems=true')).json();
    expect(all.totalRecords).toBe(1);
    expect(all.records[0]).toMatchObject({ trackedDownloadStatus: 'warning', episodeIds: [] });
    expect(all.records[0].seriesId).toBeUndefined();
    expect(all.records[0].quality.quality.name).toContain('1080p');
    expect(all.records[0].statusMessages[0].messages[0]).toMatch(/Unknown series/);
    expect((await req('GET', '/api/v3/queue/status')).json()).toEqual({ totalCount: 1, count: 0, unknownCount: 1, errors: false, warnings: true });
  });

  it('marks failed items as errors', async () => {
    const { seriesId, eps, sab, queue } = await setup();
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[0]!], sourceTitle: 'x', quality, downloadId: 'bad1' });
    sab.items = [FakeDownloadClient.item({ downloadId: 'bad1', status: 'failed', message: 'Aborted' })];
    await queue.refresh();
    const r = (await req('GET', '/api/v3/queue')).json().records[0];
    expect(r).toMatchObject({ status: 'failed', trackedDownloadStatus: 'error', trackedDownloadState: 'failedPending', errorMessage: 'Aborted' });
    expect((await req('GET', '/api/v3/queue/status')).json()).toEqual({ totalCount: 1, count: 1, unknownCount: 0, errors: true, warnings: false });
  });

  it('keeps the last items when a client fails', async () => {
    const { seriesId, eps, sab, qbit, queue } = await setup();
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[0]!], sourceTitle: 'x', quality, downloadId: 'nzo1' });
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[1]!], sourceTitle: 'y', quality, downloadId: 'hash2' });
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1' })];
    qbit.items = [FakeDownloadClient.item({ downloadId: 'hash2' })];
    await queue.refresh();
    sab.failure = 'Unable to connect to the download client (ECONNREFUSED)';
    qbit.items = [];
    await queue.refresh();
    const ids = ((await req('GET', '/api/v3/queue')).json().records as { downloadId: string }[]).map((r) => r.downloadId);
    expect(ids).toEqual(['nzo1']);
    expect(queue.health()).toHaveLength(1);
    expect(queue.health()[0]!.message).toContain('sab');
    expect(queue.health()[0]!.message).toContain('ECONNREFUSED');
    sab.failure = null;
    await queue.refresh();
    expect(queue.health()).toEqual([]);
  });

  it('removes from the client and blocklists', async () => {
    const { seriesId, eps, sab, qbit, queue } = await setup();
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[0]!], sourceTitle: 'Show.S01E01.720p-GRP', quality, downloadId: 'nzo1', data: { indexer: 'NZBgeek' } });
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[1]!], sourceTitle: 'Show.S01E02', quality, downloadId: 'ABC123' });
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1' })];
    qbit.items = [FakeDownloadClient.item({ downloadId: 'abc123' })];
    await queue.refresh();
    const [r1, r2] = (await req('GET', '/api/v3/queue?sortKey=added')).json().records as { id: number }[];

    expect((await req('DELETE', '/api/v3/queue/9999')).statusCode).toBe(404);
    const seen: string[] = [];
    t!.app.events.subscribe((e) => seen.push(`${e.name}:${e.action}`));
    const del = await req('DELETE', `/api/v3/queue/${r1!.id}?blocklist=true`);
    expect(del.statusCode).toBe(200);
    expect(sab.removed).toEqual([{ downloadId: 'nzo1', deleteData: true }]);
    expect(seen).toContain('blocklist:created');
    const bl = (await req('GET', '/api/v3/blocklist')).json();
    expect(bl.totalRecords).toBe(1);
    expect(bl.records[0]).toMatchObject({ seriesId, sourceTitle: 'Show.S01E01.720p-GRP', indexer: 'NZBgeek', protocol: 'usenet', episodeIds: [eps[0]] });
    expect(isBlocklisted(t!.app.db, seriesId, { title: 'Show.S01E01.720p-GRP', indexer: 'NZBgeek' })).toBe(true);
    expect((await req('GET', '/api/v3/queue')).json().totalRecords).toBe(1);

    // not removing from the client hides the item without touching the client
    const keep = await req('DELETE', `/api/v3/queue/${r2!.id}?removeFromClient=false`);
    expect(keep.statusCode).toBe(200);
    expect(qbit.removed).toEqual([]);
    await queue.refresh();
    expect((await req('GET', '/api/v3/queue')).json().totalRecords).toBe(0);
  });

  it('removes in bulk, blocklisting torrents by info hash', async () => {
    const { seriesId, eps, qbit, queue } = await setup();
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[0]!], sourceTitle: 'A', quality, downloadId: 'aaa' });
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[1]!], sourceTitle: 'B', quality, downloadId: 'bbb' });
    qbit.items = [FakeDownloadClient.item({ downloadId: 'aaa' }), FakeDownloadClient.item({ downloadId: 'bbb' })];
    await queue.refresh();
    const ids = ((await req('GET', '/api/v3/queue')).json().records as { id: number }[]).map((r) => r.id);
    expect((await req('DELETE', '/api/v3/queue/bulk', { ids: [...ids, 777] })).statusCode).toBe(404);
    expect(qbit.removed).toEqual([]);
    expect((await req('DELETE', '/api/v3/queue/bulk', { ids, blocklist: true })).statusCode).toBe(200);
    expect(qbit.removed.map((r) => r.downloadId).sort()).toEqual(['aaa', 'bbb']);
    expect(isBlocklisted(t!.app.db, seriesId, { title: 'zzz', torrentInfoHash: 'AAA' })).toBe(true);
    expect((await req('GET', '/api/v3/queue')).json().totalRecords).toBe(0);
    expect((await req('DELETE', '/api/v3/queue/bulk', { ids: [] })).statusCode).toBe(400);
  });

  it('reports a client removal failure', async () => {
    const { seriesId, eps, sab, queue } = await setup();
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[0]!], sourceTitle: 'x', quality, downloadId: 'nzo1' });
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1' })];
    await queue.refresh();
    const id = (await req('GET', '/api/v3/queue')).json().records[0].id;
    sab.failure = 'down';
    const res = await req('DELETE', `/api/v3/queue/${id}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('down');
  });

  it('refreshes through the RefreshMonitoredDownloads command and publishes queue events', async () => {
    const { seriesId, eps, sab } = await setup();
    recordGrabbed(t!.app, { seriesId, episodeIds: [eps[0]!], sourceTitle: 'x', quality, downloadId: 'nzo1' });
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1' })];
    const seen: string[] = [];
    t!.app.events.subscribe((e) => {
      if (e.name === 'queue') seen.push(e.action);
    });
    expect(t!.app.commands.has('RefreshMonitoredDownloads')).toBe(true);
    const res = await req('POST', '/api/v3/command', { name: 'RefreshMonitoredDownloads' });
    expect(res.statusCode).toBeLessThan(300);
    const id = res.json().id as number;
    for (let i = 0; i < 50 && !['completed', 'failed'].includes((await req('GET', `/api/v3/command/${id}`)).json().status); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await req('GET', `/api/v3/command/${id}`)).json().status).toBe('completed');
    expect(seen).toEqual(['updated']);
    // unchanged items publish nothing further
    await registerQueue(t!.app).refresh();
    expect(seen).toEqual(['updated']);
    sab.items = [FakeDownloadClient.item({ downloadId: 'nzo1', remainingSize: 100 })];
    await registerQueue(t!.app).refresh();
    expect(seen).toEqual(['updated', 'updated']);
  });
});
