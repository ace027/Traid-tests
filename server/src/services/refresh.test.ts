import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeMetadataProvider, makeEpisode } from '../test/fakeMetadata.js';
import { MetadataError } from './metadata/types.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

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

async function setup(extra: Record<string, unknown> = {}) {
  const provider = new FakeMetadataProvider();
  t = await createTestApp({ metadataProvider: provider });
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  const res = await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: profileId, rootFolderPath: root, ...extra });
  await t.app.commands.waitForIdle();
  return { provider, series: res.json() as { id: number; path: string } };
}

async function refresh(body: Record<string, unknown>) {
  const cmd = await req('POST', '/api/v3/command', { name: 'RefreshSeries', ...body });
  expect(cmd.statusCode).toBe(201);
  await t!.app.commands.waitForIdle();
  return (await req('GET', `/api/v3/command/${cmd.json().id}`)).json() as { status: string; message: string | null };
}

const eps = (seriesId: number) =>
  t!.app.sqlite
    .prepare('SELECT season_number AS s, episode_number AS e, title, monitored AS m, episode_file_id AS f FROM episodes WHERE series_id = ? ORDER BY season_number, episode_number')
    .all(seriesId) as { s: number; e: number; title: string; m: number; f: number | null }[];

describe('RefreshSeries', () => {
  it('adds new episodes and updates fields, keeping monitored flags and file links', async () => {
    const { provider, series } = await setup();
    fs.mkdirSync(series.path, { recursive: true });
    fs.writeFileSync(path.join(series.path, 'Show.S01E01.mkv'), 'x');
    t!.app.commands.enqueue('RescanSeries', { seriesId: series.id });
    await t!.app.commands.waitForIdle();
    const [first] = eps(series.id).filter((e) => e.s === 1 && e.e === 1);
    expect(first!.f).not.toBeNull();
    t!.app.sqlite.prepare('UPDATE episodes SET monitored = 0 WHERE series_id = ? AND season_number = 1 AND episode_number = 2').run(series.id);

    provider.addEpisode(100, makeEpisode(1007, 2, 4, '2999-02-01'));
    provider.addEpisode(100, makeEpisode(1008, 3, 1, '2999-03-01'));
    provider.shows.get(100)!.series.overview = 'New overview';
    provider.shows.get(100)!.episodes.find((e) => e.tvMazeId === 1003)!.title = 'Renamed';

    const cmd = await refresh({ seriesId: series.id });
    expect(cmd.status).toBe('completed');
    const after = eps(series.id);
    expect(after.find((e) => e.s === 2 && e.e === 4)).toMatchObject({ m: 1, f: null });
    expect(after.find((e) => e.s === 3 && e.e === 1)!.m).toBe(1);
    expect(after.find((e) => e.s === 1 && e.e === 2)).toMatchObject({ m: 0, title: 'Renamed' });
    expect(after.find((e) => e.s === 1 && e.e === 1)!.f).toBe(first!.f);
    const api = (await req('GET', `/api/v3/series/${series.id}`)).json();
    expect(api.overview).toBe('New overview');
    expect(api.seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 3).monitored).toBe(true);
    expect(t!.app.sqlite.prepare('SELECT last_info_sync AS l FROM series WHERE id = ?').get(series.id)).not.toEqual({ l: null });
  });

  it('does not monitor new episodes when monitorNewItems is none', async () => {
    const { provider, series } = await setup({ monitorNewItems: 'none' });
    provider.addEpisode(100, makeEpisode(1007, 2, 4, '2999-02-01'));
    await refresh({ seriesId: series.id });
    expect(eps(series.id).find((e) => e.s === 2 && e.e === 4)!.m).toBe(0);
  });

  it('removes vanished episodes without a file but keeps ones with a file', async () => {
    const { provider, series } = await setup();
    fs.mkdirSync(series.path, { recursive: true });
    fs.writeFileSync(path.join(series.path, 'Show.S01E01.mkv'), 'x');
    t!.app.commands.enqueue('RescanSeries', { seriesId: series.id });
    await t!.app.commands.waitForIdle();
    provider.removeEpisode(100, 1, 1);
    provider.removeEpisode(100, 1, 2);
    const cmd = await refresh({ seriesId: series.id });
    expect(cmd.message).toContain('1 removed');
    const keys = eps(series.id).map((e) => `${e.s}x${e.e}`);
    expect(keys).toContain('1x1');
    expect(keys).not.toContain('1x2');
  });

  it('runs a rescan afterwards and handles all series when seriesId is absent', async () => {
    const { series } = await setup();
    fs.mkdirSync(series.path, { recursive: true });
    fs.writeFileSync(path.join(series.path, 'Show.S01E02.mkv'), 'x');
    await refresh({});
    const cmds = (await req('GET', '/api/v3/command')).json() as { name: string; status: string }[];
    expect(cmds.some((c) => c.name === 'RescanSeries' && c.status === 'completed')).toBe(true);
    expect(eps(series.id).find((e) => e.s === 1 && e.e === 2)!.f).not.toBeNull();
  });

  it('fails the command when the provider fails', async () => {
    const { provider, series } = await setup();
    provider.failWith = new MetadataError(503, 'Unable to reach TVmaze');
    const cmd = await refresh({ seriesId: series.id });
    expect(cmd.status).toBe('failed');
    expect(cmd.message).toContain('Unable to reach TVmaze');
  });
});
