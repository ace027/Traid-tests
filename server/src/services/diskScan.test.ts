import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
const tmp: string[] = [];
afterEach(async () => {
  await t?.cleanup();
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

const mktmp = (prefix: string) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
};

async function setup(tvMazeId = 100, extra: Record<string, unknown> = {}) {
  t = await createTestApp();
  const root = mktmp('sonarr-root-');
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  const res = await req('POST', '/api/v3/series', { tvMazeId, qualityProfileId: profileId, rootFolderPath: root, ...extra });
  expect(res.statusCode).toBe(201);
  await t.app.commands.waitForIdle();
  return { root, series: res.json() as { id: number; path: string } };
}

const write = (base: string, rel: string, content = 'video') => {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

async function rescan(seriesId: number) {
  const cmd = t!.app.commands.enqueue('RescanSeries', { seriesId }, 'manual');
  await t!.app.commands.waitForIdle();
  return (await req('GET', `/api/v3/command/${cmd.id}`)).json() as { status: string; message: string | null };
}

const files = (seriesId: number) =>
  t!.app.sqlite.prepare('SELECT * FROM episode_files WHERE series_id = ? ORDER BY relative_path').all(seriesId) as {
    id: number;
    relative_path: string;
    quality: string;
    size: number;
  }[];
const linked = (seriesId: number) =>
  t!.app.sqlite
    .prepare('SELECT season_number AS s, episode_number AS e, episode_file_id AS f, monitored AS m FROM episodes WHERE series_id = ? ORDER BY season_number, episode_number')
    .all(seriesId) as { s: number; e: number; f: number | null; m: number }[];

describe('disk scan', () => {
  it('links a standard file with detected quality', async () => {
    const { series } = await setup();
    write(series.path, 'Season 1/Show.S01E01.720p.HDTV.mkv', 'abcdef');
    const cmd = await rescan(series.id);
    expect(cmd.status).toBe('completed');
    const f = files(series.id);
    expect(f).toHaveLength(1);
    expect(JSON.parse(f[0]!.quality).quality.name).toBe('HDTV-720p');
    expect(f[0]!.size).toBe(6);
    expect(f[0]!.relative_path).toBe(path.join('Season 1', 'Show.S01E01.720p.HDTV.mkv'));
    expect(linked(series.id).find((e) => e.s === 1 && e.e === 1)!.f).toBe(f[0]!.id);
    expect(cmd.message).toContain('1 added');
  });

  it('links a multi-episode file to both episodes', async () => {
    const { series } = await setup();
    write(series.path, 'Show.S01E01E02.1080p.WEB-DL.mkv');
    await rescan(series.id);
    const f = files(series.id);
    expect(f).toHaveLength(1);
    expect(linked(series.id).filter((e) => e.f === f[0]!.id).map((e) => `${e.s}x${e.e}`)).toEqual(['1x1', '1x2']);
  });

  it('matches daily shows by air date', async () => {
    const { series } = await setup(300);
    write(series.path, 'Daily.Show.2015.03.03.720p.HDTV.mkv');
    await rescan(series.id);
    const l = linked(series.id);
    expect(l.filter((e) => e.f !== null).map((e) => `${e.s}x${e.e}`)).toEqual(['1x2']);
  });

  it('falls back to the Season folder for the season number', async () => {
    const { series } = await setup();
    write(series.path, 'Season 2/E02 - Title.mkv');
    await rescan(series.id);
    expect(linked(series.id).filter((e) => e.f !== null).map((e) => `${e.s}x${e.e}`)).toEqual(['2x2']);
  });

  it('skips samples, extras and non-video files', async () => {
    const { series } = await setup();
    write(series.path, 'Show.S01E01.sample.mkv');
    write(series.path, 'Extras/Show.S01E01.mkv');
    write(series.path, 'Show.S01E01.nfo');
    write(series.path, 'Show.S01E01.srt');
    const cmd = await rescan(series.id);
    expect(files(series.id)).toHaveLength(0);
    expect(cmd.message).toContain('0 unparsed');
  });

  it('unlinks a deleted file on rescan', async () => {
    const { series } = await setup();
    const full = write(series.path, 'Show.S01E01.mkv');
    await rescan(series.id);
    expect(files(series.id)).toHaveLength(1);
    fs.rmSync(full);
    const cmd = await rescan(series.id);
    expect(files(series.id)).toHaveLength(0);
    expect(linked(series.id).every((e) => e.f === null)).toBe(true);
    expect(cmd.message).toContain('1 removed');
  });

  it('keeps file rows and fails when the series folder is gone or unmounted', async () => {
    const { series } = await setup();
    write(series.path, 'Show.S01E01.mkv');
    await rescan(series.id);
    const moved = `${series.path}-moved`;
    fs.renameSync(series.path, moved);
    tmp.push(moved);
    const cmd = await rescan(series.id);
    expect(cmd.status).toBe('failed');
    expect(cmd.message).toContain('not accessible');
    expect(files(series.id)).toHaveLength(1);
    expect(linked(series.id).filter((e) => e.f !== null)).toHaveLength(1);
  });

  it('keeps file rows when the series folder cannot be read', async () => {
    const { series } = await setup();
    write(series.path, 'Show.S01E01.mkv');
    await rescan(series.id);
    fs.chmodSync(series.path, 0o000);
    try {
      if (process.getuid?.() === 0) return; // root bypasses permissions
      const cmd = await rescan(series.id);
      expect(cmd.status).toBe('failed');
      expect(files(series.id)).toHaveLength(1);
    } finally {
      fs.chmodSync(series.path, 0o755);
    }
  });

  it('does not follow symlinks that leave the series folder, nor loops', async () => {
    const { series } = await setup();
    const outside = mktmp('sonarr-out-');
    write(outside, 'Show.S01E02.mkv');
    fs.mkdirSync(series.path, { recursive: true });
    fs.symlinkSync(outside, path.join(series.path, 'linked'));
    fs.symlinkSync(path.join(outside, 'Show.S01E02.mkv'), path.join(series.path, 'Show.S01E02.mkv'));
    write(series.path, 'Season 1/Show.S01E01.mkv');
    fs.symlinkSync(series.path, path.join(series.path, 'Season 1', 'loop'));
    const cmd = await rescan(series.id);
    expect(cmd.status).toBe('completed');
    const f = files(series.id);
    expect(f.map((x) => x.relative_path)).toEqual([path.join('Season 1', 'Show.S01E01.mkv')]);
  });

  it('fails when the series folder is outside the root folders', async () => {
    const { series } = await setup();
    const outside = mktmp('sonarr-out-');
    write(outside, 'Show.S01E01.mkv');
    fs.rmSync(series.path, { recursive: true, force: true });
    fs.symlinkSync(outside, series.path);
    const cmd = await rescan(series.id);
    expect(cmd.status).toBe('failed');
    expect(cmd.message).toBe('Series folder is outside root folders');
    expect(files(series.id)).toHaveLength(0);
  });

  it('reports unparsed, unmatched and duplicate files, keeping the larger duplicate', async () => {
    const { series } = await setup();
    write(series.path, 'random-movie-file.mkv');
    write(series.path, 'Show.S09E09.mkv'); // not in metadata
    write(series.path, 'Show.S01E01.720p.HDTV.mkv', 'small');
    write(series.path, 'Show.S01E01.1080p.WEB-DL.mkv', 'much larger content');
    const cmd = await rescan(series.id);
    expect(files(series.id).map((f) => f.relative_path)).toEqual(['Show.S01E01.1080p.WEB-DL.mkv']);
    expect(cmd.message).toContain('3 unparsed');
    expect(cmd.message).toContain('random-movie-file.mkv');
    expect(cmd.message).toContain('Show.S09E09.mkv (no matching episode)');
    expect(cmd.message).toContain('Show.S01E01.720p.HDTV.mkv (duplicate');
  });

  it("applies add_options 'existing' with file knowledge on the first scan only", async () => {
    const { series } = await setup(100, { addOptions: { monitor: 'existing' } });
    expect(linked(series.id).filter((e) => e.m).length).toBe(0);
    write(series.path, 'Season 1/Show.S01E02.mkv');
    await rescan(series.id);
    expect(linked(series.id).filter((e) => e.m).map((e) => `${e.s}x${e.e}`)).toEqual(['1x2']);
    const api = (await req('GET', `/api/v3/series/${series.id}`)).json();
    expect(api.addOptions).toBeUndefined();
    expect(api.seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 1).monitored).toBe(true);
    expect(api.seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 2).monitored).toBe(false);
    // user changes survive later scans
    t!.app.sqlite.prepare('UPDATE episodes SET monitored = 1 WHERE series_id = ?').run(series.id);
    await rescan(series.id);
    expect(linked(series.id).every((e) => e.m === 1)).toBe(true);
  });

  it('is idempotent', async () => {
    const { series } = await setup();
    write(series.path, 'Season 1/Show.S01E01.mkv');
    write(series.path, 'Season 1/Show.S01E02.mkv');
    await rescan(series.id);
    const before = JSON.stringify([files(series.id), linked(series.id)]);
    const cmd = await rescan(series.id);
    expect(JSON.stringify([files(series.id), linked(series.id)])).toBe(before);
    expect(cmd.message).toContain('0 added, 0 updated, 0 removed');
  });

  it('handles many files within the entry cap', async () => {
    const { series } = await setup();
    for (let i = 0; i < 300; i++) write(series.path, `junk/file${i}.txt`, '');
    write(series.path, 'Show.S01E01.mkv');
    const cmd = await rescan(series.id);
    expect(cmd.status).toBe('completed');
    expect(files(series.id)).toHaveLength(1);
  });
});
