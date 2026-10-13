import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeMetadataProvider } from '../test/fakeMetadata.js';
import { MetadataError } from '../services/metadata/types.js';
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

async function setup(provider?: FakeMetadataProvider) {
  t = await createTestApp(provider ? { metadataProvider: provider } : {});
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  expect((await req('POST', '/api/v3/rootfolder', { path: root })).statusCode).toBe(201);
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  return { profileId };
}

const add = (profileId: number, tvMazeId: number, extra: Record<string, unknown> = {}) =>
  req('POST', '/api/v3/series', { tvMazeId, qualityProfileId: profileId, rootFolderPath: root, ...extra });

const episodes = (seriesId: number) =>
  (t!.app.sqlite
    .prepare('SELECT season_number AS s, episode_number AS e, monitored AS m FROM episodes WHERE series_id = ? ORDER BY season_number, episode_number')
    .all(seriesId) as { s: number; e: number; m: number }[]);

describe('series lookup', () => {
  it('finds by name and tvdb id', async () => {
    await setup();
    const byName = await req('GET', '/api/v3/series/lookup?term=fake');
    expect(byName.json().map((s: { tvMazeId: number }) => s.tvMazeId).sort()).toEqual([100, 400]);
    const byTvdb = await req('GET', '/api/v3/series/lookup?term=tvdb:7002');
    expect(byTvdb.json()).toHaveLength(1);
    expect(byTvdb.json()[0].title).toBe('Ended Show');
  });

  it('rejects an empty term and maps provider failure to 503', async () => {
    const p = new FakeMetadataProvider();
    await setup(p);
    expect((await req('GET', '/api/v3/series/lookup?term=')).statusCode).toBe(400);
    p.failWith = new MetadataError(503, 'Unable to reach TVmaze');
    const res = await req('GET', '/api/v3/series/lookup?term=fake');
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toBe('Unable to reach TVmaze');
  });
});

describe('add series', () => {
  it('creates series, seasons and episodes with monitor=all (specials unmonitored)', async () => {
    const { profileId } = await setup();
    const res = await add(profileId, 100);
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s).toMatchObject({ title: 'Fake Show', path: path.join(root!, 'Fake Show (2020)'), monitored: true });
    expect(s.seasons.map((x: { seasonNumber: number; monitored: boolean }) => [x.seasonNumber, x.monitored])).toEqual([
      [0, false],
      [1, true],
      [2, true],
    ]);
    expect(episodes(s.id).filter((e) => e.m).length).toBe(5);
    expect(fs.existsSync(s.path)).toBe(false);
  });

  it.each([
    ['future', 1],
    ['none', 0],
    ['pilot', 1],
  ])('applies monitor option %s', async (option, count) => {
    const { profileId } = await setup();
    const res = await add(profileId, 100, { addOptions: { monitor: option } });
    expect(episodes(res.json().id).filter((e) => e.m).length).toBe(count);
  });

  it('rejects duplicates by tvmaze and tvdb id', async () => {
    const { profileId } = await setup();
    expect((await add(profileId, 100)).statusCode).toBe(201);
    const dup = await add(profileId, 100);
    expect(dup.statusCode).toBe(400);
    expect(dup.json().errors[0]).toMatchObject({ propertyName: 'tvdbId', errorMessage: 'This series has already been added' });
    const dupTvdb = await add(profileId, 400, { tvdbId: 7001 });
    expect(dupTvdb.statusCode).toBe(400);
  });

  it('rejects unknown root folder, outside paths and unknown profile', async () => {
    const { profileId } = await setup();
    expect((await add(profileId, 100, { rootFolderPath: path.join(root!, 'nope') })).statusCode).toBe(400);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-outside-'));
    try {
      const res = await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: profileId, path: path.join(outside, 'Show') });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].propertyName).toBe('path');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    expect((await add(99999, 100)).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/series', { tvMazeId: 100, qualityProfileId: profileId })).statusCode).toBe(400);
  });

  it('accepts an explicit path inside a root folder', async () => {
    const { profileId } = await setup();
    const p = path.join(root!, 'Custom Name');
    const res = await req('POST', '/api/v3/series', { tvMazeId: 200, qualityProfileId: profileId, path: p });
    expect(res.statusCode).toBe(201);
    expect(res.json().path).toBe(p);
  });

  it('gives same-title shows distinct slugs and handles no premiere year', async () => {
    const { profileId } = await setup();
    const a = (await add(profileId, 100)).json();
    const b = (await add(profileId, 400)).json();
    expect(a.titleSlug).toBe('fake-show');
    expect(b.titleSlug).toBe('fake-show-2005');
    expect(b.path).not.toBe(a.path);
    const c = (await add(profileId, 500)).json();
    expect(c.path).toBe(path.join(root!, 'Yearless Show'));
  });

  it('maps an unknown tvmaze id to 400 and provider outage to 503', async () => {
    const p = new FakeMetadataProvider();
    const { profileId } = await setup(p);
    expect((await add(profileId, 9999)).statusCode).toBe(400);
    p.failWith = new MetadataError(503, 'down');
    expect((await add(profileId, 100)).statusCode).toBe(503);
  });

  it('publishes events and enqueues rescan when registered', async () => {
    const { profileId } = await setup();
    const seen: string[] = [];
    t!.app.events.subscribe((e: { name: string; action: string }) => seen.push(`${e.name}:${e.action}`));
    const queued: unknown[] = [];
    t!.app.commands.register('RescanSeries', async () => {});
    const orig = t!.app.commands.enqueue.bind(t!.app.commands);
    t!.app.commands.enqueue = ((name: string, body: Record<string, unknown>, trig: never) => {
      queued.push([name, body]);
      return orig(name, body, trig);
    }) as typeof orig;
    const s = (await add(profileId, 200)).json();
    expect(queued).toEqual([['RescanSeries', { seriesId: s.id }]]);
    expect(seen).toContain('series:created');
  });
});

describe('list, edit, delete', () => {
  it('computes statistics per series without cross-talk', async () => {
    const { profileId } = await setup();
    const a = (await add(profileId, 100)).json();
    let list = (await req('GET', '/api/v3/series')).json();
    expect(list).toHaveLength(1);
    expect(list[0].statistics).toMatchObject({ totalEpisodeCount: 6, episodeFileCount: 0, seasonCount: 2, episodeCount: 4 });
    expect(list[0].statistics.nextAiring).toBeTruthy();
    const b = (await add(profileId, 200)).json();
    // give series b a file on S01E01
    const sqlite = t!.app.sqlite;
    const fileId = Number(
      sqlite
        .prepare("INSERT INTO episode_files (series_id, season_number, relative_path, path, size, date_added, quality) VALUES (?, 1, 'a.mkv', ?, 500, 'x', '{}')")
        .run(b.id, path.join(root!, 'a.mkv')).lastInsertRowid,
    );
    sqlite.prepare('UPDATE episodes SET episode_file_id = ? WHERE series_id = ? AND episode_number = 1').run(fileId, b.id);
    list = (await req('GET', '/api/v3/series')).json();
    const sa = list.find((s: { id: number }) => s.id === a.id).statistics;
    const sb = list.find((s: { id: number }) => s.id === b.id).statistics;
    expect(sa).toMatchObject({ episodeFileCount: 0, sizeOnDisk: 0, totalEpisodeCount: 6 });
    expect(sb).toMatchObject({ episodeFileCount: 1, sizeOnDisk: 500, totalEpisodeCount: 2, episodeCount: 2, percentOfEpisodes: 50 });
    const one = (await req('GET', `/api/v3/series/${b.id}`)).json();
    expect(one.statistics.sizeOnDisk).toBe(500);
    expect((await req('GET', '/api/v3/series/9999')).statusCode).toBe(404);
  });

  it('cascades season monitoring to episodes', async () => {
    const { profileId } = await setup();
    const s = (await add(profileId, 100)).json();
    const res = await req('PUT', `/api/v3/series/${s.id}`, { seasons: [{ seasonNumber: 1, monitored: false }], monitored: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().monitored).toBe(false);
    expect(res.json().seasons.find((x: { seasonNumber: number }) => x.seasonNumber === 1).monitored).toBe(false);
    expect(episodes(s.id).filter((e) => e.s === 1 && e.m)).toHaveLength(0);
    expect(episodes(s.id).filter((e) => e.s === 2 && e.m)).toHaveLength(3);
    expect((await req('PUT', '/api/v3/series/9999', {})).statusCode).toBe(404);
  });

  it('delete without files keeps the folder; with deleteFiles removes it', async () => {
    const { profileId } = await setup();
    const s = (await add(profileId, 100)).json();
    fs.mkdirSync(s.path, { recursive: true });
    fs.writeFileSync(path.join(s.path, 'ep.mkv'), 'x');
    expect((await req('DELETE', `/api/v3/series/${s.id}`)).statusCode).toBe(200);
    expect(fs.existsSync(s.path)).toBe(true);
    expect((await req('GET', '/api/v3/series')).json()).toHaveLength(0);
    expect(t!.app.sqlite.prepare('SELECT COUNT(*) AS c FROM episodes').get()).toEqual({ c: 0 });

    const s2 = (await add(profileId, 100)).json();
    fs.mkdirSync(s2.path, { recursive: true });
    fs.writeFileSync(path.join(s2.path, 'ep.mkv'), 'x');
    expect((await req('DELETE', `/api/v3/series/${s2.id}?deleteFiles=true`)).statusCode).toBe(200);
    expect(fs.existsSync(s2.path)).toBe(false);
    expect(fs.existsSync(root!)).toBe(true);
    expect((await req('DELETE', `/api/v3/series/${s2.id}`)).statusCode).toBe(404);
  });

  it('refuses to delete files outside root folders', async () => {
    const { profileId } = await setup();
    const s = (await add(profileId, 100)).json();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-outside-'));
    try {
      t!.app.sqlite.prepare('UPDATE series SET path = ? WHERE id = ?').run(outside, s.id);
      expect((await req('DELETE', `/api/v3/series/${s.id}?deleteFiles=true`)).statusCode).toBe(400);
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('integration with quality profiles and tags', () => {
  it('blocks deleting an in-use quality profile', async () => {
    const { profileId } = await setup();
    await add(profileId, 100);
    const res = await req('DELETE', `/api/v3/qualityprofile/${profileId}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0]).toMatchObject({ propertyName: 'id', errorMessage: 'Quality profile is in use by a series' });
  });

  it('lists series ids in tag detail', async () => {
    const { profileId } = await setup();
    const tag = (await req('POST', '/api/v3/tag', { label: 'kids' })).json();
    const s = (await add(profileId, 100, { tags: [tag.id] })).json();
    expect((await add(profileId, 200, { tags: [9999] })).statusCode).toBe(400);
    const detail = (await req('GET', '/api/v3/tag/detail')).json();
    expect(detail.find((d: { id: number }) => d.id === tag.id).seriesIds).toEqual([s.id]);
  });
});
