import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
let root: string | undefined;
let outside: string | undefined;
afterEach(async () => {
  await t?.cleanup();
  for (const d of [root, outside]) if (d) fs.rmSync(d, { recursive: true, force: true });
  t = undefined;
  root = undefined;
  outside = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

async function setup(tvMazeId = 100) {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  expect((await req('POST', '/api/v3/rootfolder', { path: root })).statusCode).toBe(201);
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  const res = await req('POST', '/api/v3/series', { tvMazeId, qualityProfileId: profileId, rootFolderPath: root });
  expect(res.statusCode).toBe(201);
  await t.app.commands.waitForIdle();
  return res.json() as { id: number; path: string };
}

const rescan = async (seriesId: number) => {
  t!.app.commands.enqueue('RescanSeries', { seriesId }, 'manual');
  await t!.app.commands.waitForIdle();
};

describe('episode listing', () => {
  it('lists by series and season ordered, and by ids', async () => {
    const s = await setup();
    const all = (await req('GET', `/api/v3/episode?seriesId=${s.id}`)).json();
    expect(all.map((e: { seasonNumber: number; episodeNumber: number }) => `${e.seasonNumber}x${e.episodeNumber}`)).toEqual([
      '0x1', '1x1', '1x2', '2x1', '2x2', '2x3',
    ]);
    expect(all[0]).toMatchObject({ seriesId: s.id, episodeFileId: 0, hasFile: false });
    const s2 = (await req('GET', `/api/v3/episode?seriesId=${s.id}&seasonNumber=2`)).json();
    expect(s2).toHaveLength(3);
    const ids = all.slice(1, 3).map((e: { id: number }) => e.id);
    const byIds = (await req('GET', `/api/v3/episode?episodeIds=${ids.join(',')}`)).json();
    expect(byIds.map((e: { id: number }) => e.id)).toEqual(ids);
    expect((await req('GET', '/api/v3/episode?episodeIds=1,x')).statusCode).toBe(400);
  });

  it('requires seriesId', async () => {
    await setup();
    const res = await req('GET', '/api/v3/episode');
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].propertyName).toBe('seriesId');
    expect((await req('GET', '/api/v3/episode?seriesId=abc')).statusCode).toBe(400);
  });

  it('gets one episode and 404s for unknown', async () => {
    const s = await setup();
    const first = (await req('GET', `/api/v3/episode?seriesId=${s.id}`)).json()[1];
    expect((await req('GET', `/api/v3/episode/${first.id}`)).json().id).toBe(first.id);
    expect((await req('GET', '/api/v3/episode/99999')).statusCode).toBe(404);
  });
});

describe('episode monitoring', () => {
  it('toggles a single episode and only writes monitored', async () => {
    const s = await setup();
    const ep = (await req('GET', `/api/v3/episode?seriesId=${s.id}`)).json()[1];
    expect(ep.monitored).toBe(true);
    const res = await req('PUT', `/api/v3/episode/${ep.id}`, { ...ep, monitored: false, title: 'Hacked', seasonNumber: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ monitored: false, title: ep.title, seasonNumber: ep.seasonNumber });
    expect((await req('GET', `/api/v3/episode/${ep.id}`)).json().monitored).toBe(false);
    expect((await req('PUT', '/api/v3/episode/99999', { monitored: true })).statusCode).toBe(404);
    expect((await req('PUT', `/api/v3/episode/${ep.id}`, {})).statusCode).toBe(400);
  });

  it('bulk monitors and leaves season flags alone', async () => {
    const s = await setup();
    const eps = (await req('GET', `/api/v3/episode?seriesId=${s.id}&seasonNumber=1`)).json() as { id: number }[];
    const res = await req('PUT', '/api/v3/episode/monitor', { episodeIds: eps.map((e) => e.id), monitored: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(res.json().every((e: { monitored: boolean }) => !e.monitored)).toBe(true);
    const after = (await req('GET', `/api/v3/episode?seriesId=${s.id}`)).json() as { seasonNumber: number; monitored: boolean }[];
    expect(after.filter((e) => e.seasonNumber === 2).every((e) => e.monitored)).toBe(true);
    const season1 = (await req('GET', `/api/v3/series/${s.id}`)).json().seasons.find((x: { seasonNumber: number }) => x.seasonNumber === 1);
    expect(season1.monitored).toBe(true);
    expect((await req('PUT', '/api/v3/episode/monitor', { episodeIds: 'x', monitored: true })).statusCode).toBe(400);
  });
});

describe('episode files', () => {
  function writeFile(seriesPath: string, rel: string, content = 'video') {
    const full = path.join(seriesPath, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  it('lists, gets and deleting unlinks episodes and removes the file', async () => {
    const s = await setup();
    const file = writeFile(s.path, 'Season 1/Fake.Show.S01E01.720p.HDTV.mkv');
    await rescan(s.id);
    const files = (await req('GET', `/api/v3/episodefile?seriesId=${s.id}`)).json();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ seriesId: s.id, relativePath: path.join('Season 1', 'Fake.Show.S01E01.720p.HDTV.mkv'), size: 5 });
    expect((await req('GET', `/api/v3/episodefile/${files[0].id}`)).json().path).toBe(file);
    const ep = (await req('GET', `/api/v3/episode?seriesId=${s.id}&seasonNumber=1`)).json()[0];
    expect(ep).toMatchObject({ hasFile: true, episodeFileId: files[0].id });

    const del = await req('DELETE', `/api/v3/episodefile/${files[0].id}`);
    expect(del.statusCode).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
    expect((await req('GET', `/api/v3/episode/${ep.id}`)).json()).toMatchObject({ hasFile: false, episodeFileId: 0 });
    expect((await req('GET', `/api/v3/episodefile/${files[0].id}`)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/v3/episodefile/${files[0].id}`)).statusCode).toBe(404);
  });

  it('requires seriesId', async () => {
    await setup();
    expect((await req('GET', '/api/v3/episodefile')).statusCode).toBe(400);
  });

  it('still deletes the row when the file is already gone', async () => {
    const s = await setup();
    const file = writeFile(s.path, 'Season 1/Fake.Show.S01E02.mkv');
    await rescan(s.id);
    const [f] = (await req('GET', `/api/v3/episodefile?seriesId=${s.id}`)).json();
    fs.rmSync(file);
    expect((await req('DELETE', `/api/v3/episodefile/${f.id}`)).statusCode).toBe(200);
    expect((await req('GET', `/api/v3/episodefile?seriesId=${s.id}`)).json()).toHaveLength(0);
  });

  it('keeps a file on disk whose path is outside the series folder', async () => {
    const s = await setup();
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-out-')));
    const victim = path.join(outside, 'precious.mkv');
    fs.writeFileSync(victim, 'keep me');
    t!.app.sqlite
      .prepare(
        `INSERT INTO episode_files (series_id, season_number, relative_path, path, size, date_added, quality)
         VALUES (?, 1, 'precious.mkv', ?, 7, '2020-01-01T00:00:00Z', '{}')`,
      )
      .run(s.id, victim);
    const row = t!.app.sqlite.prepare('SELECT id FROM episode_files WHERE path = ?').get(victim) as { id: number };
    const ep = (await req('GET', `/api/v3/episode?seriesId=${s.id}&seasonNumber=1`)).json()[0];
    t!.app.sqlite.prepare('UPDATE episodes SET episode_file_id = ? WHERE id = ?').run(row.id, ep.id);

    expect((await req('DELETE', `/api/v3/episodefile/${row.id}`)).statusCode).toBe(200);
    expect(fs.existsSync(victim)).toBe(true);
    expect((await req('GET', `/api/v3/episode/${ep.id}`)).json().hasFile).toBe(false);
  });
});
