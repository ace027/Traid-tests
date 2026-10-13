import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QUALITIES, type QualityModel } from '@sonarr/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { addToBlocklist, isBlocklisted } from '../services/blocklist.js';
import { findGrabbedByDownloadId, recordEvent, recordGrabbed } from '../services/history.js';

let t: TestApp | undefined;
let root: string | undefined;
afterEach(async () => {
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
  const added = async (tvMazeId: number) =>
    (await req('POST', '/api/v3/series', { tvMazeId, qualityProfileId: profileId, rootFolderPath: root })).json().id as number;
  const a = await added(100);
  const b = await added(400);
  const eps = (id: number) =>
    (t!.app.sqlite.prepare('select id from episodes where series_id = ? order by id').all(id) as { id: number }[]).map((r) => r.id);
  return { a, b, epsA: eps(a), epsB: eps(b) };
}

describe('history', () => {
  it('pages, filters and sorts', async () => {
    const { a, b, epsA, epsB } = await setup();
    recordGrabbed(t!.app, { seriesId: a, episodeIds: [epsA[0]!, epsA[1]!], sourceTitle: 'A.S01', quality, downloadId: 'dl1', date: '2026-01-01T00:00:00.000Z' });
    recordEvent(t!.app, 'downloadFailed', { seriesId: a, episodeIds: [epsA[0]!], sourceTitle: 'A.S01', quality, downloadId: 'dl1', date: '2026-01-02T00:00:00.000Z' });
    recordGrabbed(t!.app, { seriesId: b, episodeIds: [epsB[0]!], sourceTitle: 'B.S01E01', quality, date: '2026-01-03T00:00:00.000Z', data: { indexer: 'x' } });

    const all = (await req('GET', '/api/v3/history')).json();
    expect(all.totalRecords).toBe(4);
    expect(all.records.map((r: { date: string }) => r.date.slice(0, 10))).toEqual(['2026-01-03', '2026-01-02', '2026-01-01', '2026-01-01']);
    expect(all.records[0].data).toEqual({ indexer: 'x' });

    const page2 = (await req('GET', '/api/v3/history?page=2&pageSize=3')).json();
    expect(page2.records).toHaveLength(1);
    expect(page2.totalRecords).toBe(4);

    const asc = (await req('GET', '/api/v3/history?sortDirection=ascending')).json();
    expect(asc.records[0].date.slice(0, 10)).toBe('2026-01-01');

    expect((await req('GET', '/api/v3/history?eventType=downloadFailed')).json().totalRecords).toBe(1);
    expect((await req('GET', `/api/v3/history?seriesId=${b}`)).json().totalRecords).toBe(1);
    expect((await req('GET', `/api/v3/history?episodeId=${epsA[1]}`)).json().totalRecords).toBe(1);
    expect((await req('GET', `/api/v3/history/series?seriesId=${a}`)).json()).toHaveLength(3);
    expect((await req('GET', '/api/v3/history?pageSize=1001')).statusCode).toBe(400);
    expect((await req('GET', '/api/v3/history?eventType=bogus')).statusCode).toBe(400);

    expect(findGrabbedByDownloadId(t!.app.db, 'dl1')).toHaveLength(2);
    expect(findGrabbedByDownloadId(t!.app.db, 'none')).toHaveLength(0);
  });

  it('cascades with the series', async () => {
    const { a, epsA } = await setup();
    recordGrabbed(t!.app, { seriesId: a, episodeIds: [epsA[0]!], sourceTitle: 'x', quality });
    addToBlocklist(t!.app, { seriesId: a, episodeIds: [epsA[0]!], sourceTitle: 'x', quality, protocol: 'usenet' });
    expect((await req('DELETE', `/api/v3/series/${a}`)).statusCode).toBe(200);
    expect(t!.app.sqlite.prepare('select count(*) as n from history').get()).toEqual({ n: 0 });
    expect(t!.app.sqlite.prepare('select count(*) as n from blocklist').get()).toEqual({ n: 0 });
  });
});

describe('blocklist', () => {
  it('matches by info hash, or by title and indexer', async () => {
    const { a } = await setup();
    addToBlocklist(t!.app, { seriesId: a, episodeIds: [], sourceTitle: 'Show.S01E01.720p', quality, protocol: 'torrent', indexer: 'Idx', torrentInfoHash: 'ABCDEF' });
    addToBlocklist(t!.app, { seriesId: a, episodeIds: [], sourceTitle: 'Other Show S01E02', quality, protocol: 'usenet', indexer: 'Nzb' });
    const db = t!.app.db;
    expect(isBlocklisted(db, a, { title: 'different', torrentInfoHash: 'abcdef' })).toBe(true);
    expect(isBlocklisted(db, a, { title: 'Show.S01E01.720p', torrentInfoHash: '123456', indexer: 'Idx' })).toBe(false);
    expect(isBlocklisted(db, a, { title: 'show s01e01 720p', indexer: 'idx' })).toBe(true);
    expect(isBlocklisted(db, a, { title: 'other.show.s01e02', indexer: 'Nzb' })).toBe(true);
    expect(isBlocklisted(db, a, { title: 'other.show.s01e02', indexer: 'Else' })).toBe(false);
    expect(isBlocklisted(db, a + 99, { title: 'other.show.s01e02', indexer: 'Nzb' })).toBe(false);
  });

  it('lists, pages, deletes and bulk deletes', async () => {
    const { a } = await setup();
    const ids = [1, 2, 3, 4].map((i) => addToBlocklist(t!.app, { seriesId: a, episodeIds: [], sourceTitle: `r${i}`, quality, protocol: 'usenet', size: i }).id);
    const list = (await req('GET', '/api/v3/blocklist?pageSize=3')).json();
    expect(list.totalRecords).toBe(4);
    expect(list.records).toHaveLength(3);
    expect(list.sortKey).toBe('date');
    expect((await req('DELETE', `/api/v3/blocklist/${ids[0]}`)).statusCode).toBe(200);
    expect((await req('DELETE', `/api/v3/blocklist/${ids[0]}`)).statusCode).toBe(404);
    expect((await req('DELETE', '/api/v3/blocklist/bulk', { ids: [ids[1], ids[2]] })).statusCode).toBe(200);
    expect((await req('GET', '/api/v3/blocklist')).json().totalRecords).toBe(1);
    expect((await req('DELETE', '/api/v3/blocklist/bulk', { ids: [] })).statusCode).toBe(400);
    expect((await req('DELETE', '/api/v3/blocklist/bulk', { ids: Array.from({ length: 1001 }, (_, i) => i + 1) })).statusCode).toBe(400);
  });
});
