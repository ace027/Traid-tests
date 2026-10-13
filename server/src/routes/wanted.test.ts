import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QUALITIES } from '@sonarr/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
let root: string | undefined;
afterEach(async () => {
  await t?.cleanup();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  t = undefined;
  root = undefined;
});

const req = (url: string, method: 'GET' | 'POST' = 'GET', payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

async function setup() {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('/api/v3/rootfolder', 'POST', { path: root });
  const profile = (await req('/api/v3/qualityprofile')).json()[0] as { id: number; cutoff: number | { id: number } };
  const seriesId = (await req('/api/v3/series', 'POST', { tvMazeId: 100, qualityProfileId: profile.id, rootFolderPath: root })).json().id as number;
  const sql = t.app.sqlite;
  sql.prepare('update episodes set air_date_utc = ?, air_date = ?, monitored = 1, episode_file_id = null').run(PAST, PAST.slice(0, 10));
  const ids = (sql.prepare('select id from episodes where series_id = ? and season_number > 0 order by season_number, episode_number').all(seriesId) as { id: number }[]).map((r) => r.id);
  const cutoffId = (sql.prepare('select cutoff from quality_profiles where id = ?').get(profile.id) as { cutoff: number }).cutoff;
  const addFile = (episodeId: number, qualityId: number) => {
    const q = QUALITIES.find((x) => x.id === qualityId)!;
    const info = sql
      .prepare('insert into episode_files (series_id, season_number, relative_path, path, size, date_added, quality) values (?, 1, ?, ?, 1, ?, ?)')
      .run(seriesId, `f${episodeId}.mkv`, `/x/f${episodeId}.mkv`, PAST, JSON.stringify({ quality: q, revision: { version: 1, real: 0, isRepack: false } }));
    sql.prepare('update episodes set episode_file_id = ? where id = ?').run(info.lastInsertRowid, episodeId);
  };
  return { seriesId, ids, addFile, cutoffId, sql };
}

describe('wanted', () => {
  it('missing excludes future, specials, files and unmonitored', async () => {
    const { seriesId, ids, addFile, sql } = await setup();
    expect(ids.length).toBeGreaterThanOrEqual(5);
    const [a, b, c, d, e] = ids as [number, number, number, number, number];
    sql.prepare('update episodes set air_date_utc = ? where id = ?').run(FUTURE, a);
    sql.prepare('update episodes set season_number = 0, episode_number = 99 where id = ?').run(b);
    addFile(c, QUALITIES[0]!.id);
    sql.prepare('update episodes set monitored = 0 where id = ?').run(d);

    const res = (await req('/api/v3/wanted/missing?pageSize=1000')).json();
    const got = (res.records as { id: number; series?: { id: number } }[]).map((r) => r.id);
    for (const x of [a, b, c, d]) expect(got).not.toContain(x);
    expect(got).toContain(e);
    expect(res.totalRecords).toBe(ids.length - 4);
    expect(res.records[0].series.id).toBe(seriesId);

    const unmon = (await req('/api/v3/wanted/missing?monitored=false')).json();
    expect(unmon.records.map((r: { id: number }) => r.id)).toEqual([d]);

    sql.prepare('update series set monitored = 0').run();
    expect((await req('/api/v3/wanted/missing')).json().totalRecords).toBe(0);
    expect((await req('/api/v3/wanted/missing?monitored=false')).json().totalRecords).toBe(ids.length - 3);
  });

  it('pages and sorts', async () => {
    const { ids, sql } = await setup();
    ids.forEach((id, i) => sql.prepare('update episodes set air_date_utc = ?, title = ? where id = ?').run(`2020-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, `T${String(ids.length - i).padStart(2, '0')}`, id));
    const asc = (await req('/api/v3/wanted/missing?sortDirection=ascending&pageSize=2&page=2&includeSeries=false')).json();
    expect(asc.page).toBe(2);
    expect(asc.totalRecords).toBe(ids.length);
    expect(asc.records.map((r: { id: number }) => r.id)).toEqual([ids[2], ids[3]]);
    expect(asc.records[0].series).toBeUndefined();
    const desc = (await req('/api/v3/wanted/missing?pageSize=1')).json();
    expect(desc.records[0].id).toBe(ids[ids.length - 1]);
    const byTitle = (await req('/api/v3/wanted/missing?sortKey=episodeTitle&sortDirection=ascending&pageSize=1')).json();
    expect(byTitle.records[0].id).toBe(ids[ids.length - 1]);
    expect((await req('/api/v3/wanted/missing?sortKey=bogus')).statusCode).toBe(400);
  });

  it('cutoff unmet lists files below cutoff only', async () => {
    const { ids, addFile, cutoffId, sql } = await setup();
    const below = QUALITIES.find((q) => q.id !== cutoffId && QUALITIES.findIndex((x) => x.id === q.id) < QUALITIES.findIndex((x) => x.id === cutoffId))!;
    addFile(ids[0]!, below.id);
    addFile(ids[1]!, cutoffId);
    addFile(ids[2]!, below.id);
    sql.prepare('update episodes set monitored = 0 where id = ?').run(ids[2]);
    const res = (await req('/api/v3/wanted/cutoff')).json();
    expect(res.records.map((r: { id: number }) => r.id)).toEqual([ids[0]]);
    expect(res.totalRecords).toBe(1);
    expect((await req('/api/v3/wanted/cutoff?monitored=false')).json().records.map((r: { id: number }) => r.id)).toEqual([ids[2]]);
  });
});
