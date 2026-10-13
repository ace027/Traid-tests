import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CalendarEpisode } from '@sonarr/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { buildICalendar, foldLine } from '../services/ical.js';

let t: TestApp | undefined;
let root: string | undefined;
afterEach(async () => {
  await t?.cleanup();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  t = undefined;
  root = undefined;
});

const req = (url: string, method: 'GET' | 'POST' | 'PUT' = 'GET', payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

async function setup() {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('/api/v3/rootfolder', 'POST', { path: root });
  const profileId = (await req('/api/v3/qualityprofile')).json()[0].id as number;
  const seriesId = (await req('/api/v3/series', 'POST', { tvMazeId: 100, qualityProfileId: profileId, rootFolderPath: root })).json().id as number;
  const sql = t.app.sqlite;
  // Park every episode far away, then place the ones under test.
  sql.prepare("update episodes set air_date_utc = '2000-01-01T00:00:00.000Z', air_date = '2000-01-01'").run();
  const ids = (sql.prepare('select id from episodes where series_id = ? and season_number > 0 order by season_number, episode_number').all(seriesId) as { id: number }[]).map((r) => r.id);
  const place = (id: number, days: number) => {
    const iso = inDays(days);
    sql.prepare('update episodes set air_date_utc = ?, air_date = ? where id = ?').run(iso, iso.slice(0, 10), id);
  };
  return { seriesId, ids, place, sql };
}

const lines = (text: string) => text.split('\r\n');

/** Minimal RFC 5545 checks for the properties this feed emits. */
function validateICal(text: string): void {
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  const raw = lines(text).slice(0, -1);
  for (const l of raw) {
    expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
  }
  const unfolded: string[] = [];
  for (const l of raw) {
    if (l.startsWith(' ')) {
      expect(unfolded.length).toBeGreaterThan(0);
      unfolded[unfolded.length - 1] += l.slice(1);
    } else unfolded.push(l);
  }
  expect(unfolded[0]).toBe('BEGIN:VCALENDAR');
  expect(unfolded.at(-1)).toBe('END:VCALENDAR');
  expect(unfolded).toContain('VERSION:2.0');
  expect(unfolded).toContain('PRODID:-//sonarr-replica//EN');
  let open = false;
  let props: string[] = [];
  for (const l of unfolded.slice(1, -1)) {
    if (l === 'BEGIN:VEVENT') {
      expect(open).toBe(false);
      open = true;
      props = [];
    } else if (l === 'END:VEVENT') {
      expect(open).toBe(true);
      open = false;
      for (const required of ['UID', 'DTSTAMP', 'DTSTART', 'SUMMARY']) expect(props).toContain(required);
    } else {
      if (!open) {
        expect(l).toMatch(/^(CALSCALE|X-WR-CALNAME|VERSION|PRODID):/);
        continue;
      }
      props.push(l.split(/[:;]/)[0]!);
      const value = l.slice(l.indexOf(':') + 1);
      if (/^(SUMMARY|DESCRIPTION|CATEGORIES):/.test(l)) expect(value).not.toMatch(/(?<!\\)[,;]/);
    }
  }
  expect(open).toBe(false);
}

describe('calendar api', () => {
  it('filters by range, validates and orders', async () => {
    const { ids, place, seriesId } = await setup();
    place(ids[0]!, 2);
    place(ids[1]!, 1);
    place(ids[2]!, 20);

    const def = (await req('/api/v3/calendar')).json() as CalendarEpisode[];
    expect(def.map((e) => e.id)).toEqual([ids[1], ids[0]]);
    expect(def[0]!.series.id).toBe(seriesId);

    const start = encodeURIComponent(inDays(10));
    const end = encodeURIComponent(inDays(30));
    expect(((await req(`/api/v3/calendar?start=${start}&end=${end}`)).json() as CalendarEpisode[]).map((e) => e.id)).toEqual([ids[2]]);

    expect((await req(`/api/v3/calendar?start=${encodeURIComponent(inDays(0))}&end=${encodeURIComponent(inDays(100))}`)).statusCode).toBe(400);
    expect((await req('/api/v3/calendar?start=garbage')).statusCode).toBe(400);
    expect((await req(`/api/v3/calendar?start=${end}&end=${start}`)).statusCode).toBe(400);

    expect(((await req('/api/v3/calendar?includeSeries=false')).json() as CalendarEpisode[])[0]!.series).toBeUndefined();
  });

  it('includes date-only episodes without air time', async () => {
    const { ids, sql } = await setup();
    const day = inDays(3).slice(0, 10);
    sql.prepare('update episodes set air_date_utc = null, air_date = ? where id = ?').run(day, ids[0]);
    const res = (await req('/api/v3/calendar')).json() as CalendarEpisode[];
    expect(res.map((e) => e.id)).toEqual([ids[0]]);
  });

  it('filters unmonitored episodes and series', async () => {
    const { ids, place, sql } = await setup();
    place(ids[0]!, 1);
    place(ids[1]!, 2);
    sql.prepare('update episodes set monitored = 0 where id = ?').run(ids[1]);
    expect(((await req('/api/v3/calendar')).json() as CalendarEpisode[]).map((e) => e.id)).toEqual([ids[0]]);
    expect(((await req('/api/v3/calendar?unmonitored=true')).json() as CalendarEpisode[]).map((e) => e.id)).toEqual([ids[0], ids[1]]);
    // Monitored episode of an unmonitored series stays hidden.
    sql.prepare('update series set monitored = 0').run();
    expect((await req('/api/v3/calendar')).json()).toEqual([]);
    expect((await req('/api/v3/calendar?unmonitored=true')).json()).toHaveLength(2);
  });

  it('filters by tags', async () => {
    const { ids, place, sql } = await setup();
    place(ids[0]!, 1);
    sql.prepare("update series set tags = '[3]'").run();
    expect((await req('/api/v3/calendar?tags=3')).json()).toHaveLength(1);
    expect((await req('/api/v3/calendar?tags=4,5')).json()).toHaveLength(0);
    expect((await req('/api/v3/calendar?tags=x')).statusCode).toBe(400);
  });

  it('includes episode files on request', async () => {
    const { ids, place, sql, seriesId } = await setup();
    place(ids[0]!, 1);
    const q = JSON.stringify({ quality: { id: 1, name: 'x', source: 'unknown', resolution: 0 }, revision: { version: 1, real: 0, isRepack: false } });
    const info = sql
      .prepare('insert into episode_files (series_id, season_number, relative_path, path, size, date_added, quality) values (?, 1, ?, ?, 1, ?, ?)')
      .run(seriesId, 'a.mkv', '/x/a.mkv', '2020-01-01T00:00:00.000Z', q);
    sql.prepare('update episodes set episode_file_id = ? where id = ?').run(info.lastInsertRowid, ids[0]);
    expect(((await req('/api/v3/calendar?includeEpisodeFile=true')).json() as CalendarEpisode[])[0]!.episodeFile?.relativePath).toBe('a.mkv');
    expect(((await req('/api/v3/calendar')).json() as CalendarEpisode[])[0]!.episodeFile).toBeUndefined();
  });
});

describe('ical feed', () => {
  it('requires the api key and returns a valid calendar', async () => {
    const { ids, place, sql } = await setup();
    place(ids[0]!, 1);
    place(ids[1]!, 2);
    sql.prepare('update episodes set title = ?, overview = ? where id = ?').run('Ünïcödé 日本語のとても長いタイトル, with; punctuation '.repeat(4), 'Line one, two;\nline \\ three', ids[0]);

    expect((await t!.app.inject({ method: 'GET', url: '/feed/v3/calendar/sonarr.ics' })).statusCode).toBe(401);
    const res = await t!.app.inject({ method: 'GET', url: `/feed/v3/calendar/sonarr.ics?apikey=${t!.apiKey}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    validateICal(res.body);
    expect(res.body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(res.body).toContain(`UID:sonarr_episode_${ids[0]}\r\n`);
    expect(res.body).toContain('\r\n ');
    expect(res.body).toContain('DTSTART:');

    const premieres = await t!.app.inject({ method: 'GET', url: `/feed/v3/calendar/sonarr.ics?apikey=${t!.apiKey}&premieresOnly=true` });
    expect(premieres.body.match(/BEGIN:VEVENT/g)?.length ?? 0).toBeLessThan(2);
    const allDay = await t!.app.inject({ method: 'GET', url: `/feed/v3/calendar/sonarr.ics?apikey=${t!.apiKey}&asAllDay=true` });
    expect(allDay.body).toContain('DTSTART;VALUE=DATE:');
    expect(allDay.body).not.toMatch(/DTSTART:/);
    const bad = await t!.app.inject({ method: 'GET', url: `/feed/v3/calendar/sonarr.ics?apikey=${t!.apiKey}&pastDays=400` });
    expect(bad.statusCode).toBe(400);
  });
});

describe('buildICalendar', () => {
  const episode = (over: Partial<CalendarEpisode> = {}): CalendarEpisode =>
    ({
      id: 7,
      seriesId: 1,
      seasonNumber: 2,
      episodeNumber: 3,
      title: 'Title',
      overview: 'a,b;c\\d\ne',
      runtime: 0,
      airDateUtc: '2026-03-01T20:00:00.000Z',
      airDate: '2026-03-01',
      series: { title: 'Show', network: 'HBO, Max', runtime: 0 },
      ...over,
    }) as unknown as CalendarEpisode;

  it('writes timed events with the default runtime and escapes text', () => {
    const text = buildICalendar([episode()], { now: new Date('2026-01-01T00:00:00Z') });
    validateICal(text);
    expect(text).toContain('DTSTAMP:20260101T000000Z\r\n');
    expect(text).toContain('DTSTART:20260301T200000Z\r\n');
    expect(text).toContain('DTEND:20260301T203000Z\r\n');
    expect(text).toContain('SUMMARY:Show - 2x03 - Title\r\n');
    expect(text).toContain('DESCRIPTION:a\\,b\\;c\\\\d\\ne\r\n');
    expect(text).toContain('CATEGORIES:HBO\\, Max\r\n');
    expect(text).toContain('STATUS:CONFIRMED\r\n');
  });

  it('uses all-day dates when asked or when there is no air time', () => {
    const noTime = episode({ airDateUtc: undefined });
    const text = buildICalendar([noTime, episode({ id: 8 })], { asAllDay: true });
    expect(text.match(/DTSTART;VALUE=DATE:20260301\r\n/g)).toHaveLength(2);
    expect(text).toContain('DTEND;VALUE=DATE:20260302\r\n');
    expect(buildICalendar([noTime])).toContain('DTSTART;VALUE=DATE:20260301');
    expect(buildICalendar([episode({ airDateUtc: undefined, airDate: undefined })])).not.toContain('BEGIN:VEVENT');
  });

  it('never splits a multi-byte character when folding', () => {
    for (let pad = 0; pad < 4; pad++) {
      const line = `SUMMARY:${'a'.repeat(pad)}${'日本語€😀'.repeat(20)}`;
      const folded = foldLine(line);
      for (const l of folded) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
      expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(line);
      expect(folded.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    }
  });
});
