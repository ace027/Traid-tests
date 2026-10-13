import { describe, expect, it } from 'vitest';
import { parseTitle } from './index.js';

interface Expected {
  title: string;
  season?: number;
  episodes?: number[];
  absolute?: number[];
  airDate?: string;
  group?: string;
  quality?: string;
  fullSeason?: boolean;
  multiSeason?: boolean;
  special?: boolean;
  year?: number;
}

const table: [string, Expected][] = [
  // standard
  ['Show.Name.S01E02.720p.HDTV.x264-GRP', { title: 'Show Name', season: 1, episodes: [2], group: 'GRP', quality: 'HDTV-720p' }],
  ['Show Name S01E02 720p HDTV', { title: 'Show Name', season: 1, episodes: [2], quality: 'HDTV-720p' }],
  ['Show_Name_S01E02_720p_HDTV', { title: 'Show Name', season: 1, episodes: [2] }],
  ['show.name.s1e2.web-dl', { title: 'show name', season: 1, episodes: [2], quality: 'WEBDL-480p' }],
  ['Show.Name.S01.E02.1080p.WEB-DL.DD5.1.H.264-NTb', { title: 'Show Name', season: 1, episodes: [2], group: 'NTb', quality: 'WEBDL-1080p' }],
  ['Show Name S01 E02', { title: 'Show Name', season: 1, episodes: [2] }],
  ['Show Name - S10E123 - Episode Title', { title: 'Show Name', season: 10, episodes: [123] }],
  ['Show.Name.1x01.HDTV', { title: 'Show Name', season: 1, episodes: [1] }],
  ['Show Name 12x05 720p', { title: 'Show Name', season: 12, episodes: [5], quality: 'HDTV-720p' }],
  ['Show.Name.S02E03.PROPER.1080p.BluRay.x264-GRP', { title: 'Show Name', season: 2, episodes: [3], group: 'GRP', quality: 'Bluray-1080p' }],
  ['S03E04.720p.mkv', { title: '', season: 3, episodes: [4], quality: 'HDTV-720p' }],
  // multi-episode
  ['Show.Name.S01E01E02.720p.HDTV-GRP', { title: 'Show Name', season: 1, episodes: [1, 2], group: 'GRP' }],
  ['Show.Name.S01E01E02E03.HDTV', { title: 'Show Name', season: 1, episodes: [1, 2, 3] }],
  ['Show.Name.S01E01-E03.HDTV', { title: 'Show Name', season: 1, episodes: [1, 2, 3] }],
  ['Show.Name.S01E01-03.HDTV', { title: 'Show Name', season: 1, episodes: [1, 2, 3] }],
  ['Show.Name.S01E01.S01E02.HDTV', { title: 'Show Name', season: 1, episodes: [1, 2] }],
  ['Show Name S01E01-S01E02', { title: 'Show Name', season: 1, episodes: [1, 2] }],
  ['Show.Name.S01E05-06.720p.WEB-DL-GRP', { title: 'Show Name', season: 1, episodes: [5, 6], group: 'GRP' }],
  ['Show.Name.1x01-02.HDTV', { title: 'Show Name', season: 1, episodes: [1, 2] }],
  ['Show.Name.1x01x02.HDTV', { title: 'Show Name', season: 1, episodes: [1, 2] }],
  ['Show.Name.S01E01-1080p.WEB-DL', { title: 'Show Name', season: 1, episodes: [1], quality: 'WEBDL-1080p' }],
  // daily
  ['Daily.Show.2024.03.15.720p.HDTV.x264-GRP', { title: 'Daily Show', airDate: '2024-03-15', group: 'GRP', quality: 'HDTV-720p' }],
  ['Daily Show 2024-03-15', { title: 'Daily Show', airDate: '2024-03-15' }],
  ['Daily.Show.2024.02.29.WEB', { title: 'Daily Show', airDate: '2024-02-29' }],
  // anime
  ['[SubGroup] Anime Show - 001 [1080p].mkv', { title: 'Anime Show', absolute: [1], group: 'SubGroup', quality: 'HDTV-1080p' }],
  ['[SubGroup] Anime Show - 12v2 [720p][ABCD1234].mkv', { title: 'Anime Show', absolute: [12], group: 'SubGroup', quality: 'HDTV-720p' }],
  ['[SubGroup] Anime Show - 01-02 [720p]', { title: 'Anime Show', absolute: [1, 2], group: 'SubGroup' }],
  ['[SubGroup] Anime - Show - 1050 (BDRip 1080p)', { title: 'Anime - Show', absolute: [1050], group: 'SubGroup', quality: 'Bluray-1080p' }],
  ['Anime Show - 07v2', { title: 'Anime Show', absolute: [7] }],
  // season packs
  ['Show.Name.S01.1080p.BluRay.x264-GRP', { title: 'Show Name', season: 1, episodes: [], fullSeason: true, group: 'GRP', quality: 'Bluray-1080p' }],
  ['Show Name Season 2 720p WEB-DL', { title: 'Show Name', season: 2, episodes: [], fullSeason: true, quality: 'WEBDL-720p' }],
  ['Show.Name.S01-S03.COMPLETE.720p', { title: 'Show Name', season: 1, episodes: [], fullSeason: true, multiSeason: true }],
  // specials
  ['Show.Name.S00E01.Special.720p.HDTV', { title: 'Show Name', season: 0, episodes: [1], special: true }],
  ['/tv/Show Name/Specials/Show Name - S00E02 - Pilot.mkv', { title: 'Show Name', season: 0, episodes: [2], special: true }],
  // years and digits in titles
  ['Doctor Who (2005) - S01E01', { title: 'Doctor Who', season: 1, episodes: [1], year: 2005 }],
  ['Doctor.Who.2005.S01E01.720p.HDTV', { title: 'Doctor Who 2005', season: 1, episodes: [1] }],
  ['9-1-1 S05E01', { title: '9-1-1', season: 5, episodes: [1] }],
  ['9-1-1.Lone.Star.S02E03.720p.WEB-DL-GRP', { title: '9-1-1 Lone Star', season: 2, episodes: [3], group: 'GRP' }],
  ['24.S08E12.1080p.BluRay.x264-GRP', { title: '24', season: 8, episodes: [12], group: 'GRP' }],
  ['Marvels.Agents.of.S.H.I.E.L.D.S03E04.HDTV', { title: 'Marvels Agents of S H I E L D', season: 3, episodes: [4] }],
  ['Spider-Man.S01E01.720p.HDTV', { title: 'Spider-Man', season: 1, episodes: [1] }],
  ['Show.Name.2024.S02E05.1080p.WEB-DL', { title: 'Show Name 2024', season: 2, episodes: [5] }],
  ['Show 1920x1080 S01E01', { title: 'Show 1920x1080', season: 1, episodes: [1] }],
  // release groups
  ['Show.Name.S01E01.720p.WEB-DL.DD5.1.H.264-GRP', { title: 'Show Name', season: 1, episodes: [1], group: 'GRP' }],
  ['Show.Name.S01E01.720p.WEB-DL', { title: 'Show Name', season: 1, episodes: [1] }],
  ['Show.Name.S01E01.1080p.BluRay.x264-DON', { title: 'Show Name', season: 1, episodes: [1], group: 'DON', quality: 'Bluray-1080p' }],
  ['Show.Name.S01E01.DVD-Rip', { title: 'Show Name', season: 1, episodes: [1], quality: 'DVD' }],
  ['Show.Name.S01E01.720p.HDTV.x264-GRP[rarbg]', { title: 'Show Name', season: 1, episodes: [1], group: 'GRP' }],
  ['Show.Name.S01E01.720p-1080p', { title: 'Show Name', season: 1, episodes: [1] }],
  // paths
  ['/tv/Show/Season 1/Show.S01E02.720p.mkv', { title: 'Show', season: 1, episodes: [2], quality: 'HDTV-720p' }],
  ['C:\\TV\\Show\\Season 1\\Show - S01E03 - Title.mp4', { title: 'Show', season: 1, episodes: [3] }],
  ['/tv/9-1-1/Season 5/9-1-1 - S05E02 - Title.avi', { title: '9-1-1', season: 5, episodes: [2] }],
];

describe('parseTitle table', () => {
  it.each(table)('%s', (input, e) => {
    const p = parseTitle(input);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.seriesTitle).toBe(e.title);
    expect(p.seasonNumber).toBe(e.season ?? 0);
    expect(p.episodeNumbers).toEqual(e.episodes ?? []);
    expect(p.absoluteEpisodeNumbers).toEqual(e.absolute ?? []);
    expect(p.airDate).toBe(e.airDate);
    expect(p.isDaily).toBe(e.airDate !== undefined);
    expect(p.isAbsoluteNumbering).toBe(e.absolute !== undefined);
    expect(p.fullSeason).toBe(e.fullSeason ?? false);
    expect(p.isMultiSeason).toBe(e.multiSeason ?? false);
    expect(p.special).toBe(e.special ?? false);
    expect(p.releaseGroup).toBe(e.group);
    expect(p.year).toBe(e.year);
    if (e.quality) expect(p.quality.quality.name).toBe(e.quality);
  });
});

describe('parseTitle details', () => {
  it('derives cleanSeriesTitle', () => {
    expect(parseTitle('The.Show-Name!.S01E01')?.cleanSeriesTitle).toBe('showname');
    expect(parseTitle('Doctor Who (2005) - S01E01')?.cleanSeriesTitle).toBe('doctorwho');
    expect(parseTitle('9-1-1 S05E01')?.cleanSeriesTitle).toBe('911');
  });

  it('keeps the release title without directories or extension', () => {
    expect(parseTitle('/tv/Show/Season 1/Show.S01E02.720p.mkv')?.releaseTitle).toBe('Show.S01E02.720p');
  });

  it('parses revision from the release', () => {
    const p = parseTitle('Show.S01E01.REPACK.720p.HDTV-GRP');
    expect(p?.quality.revision).toEqual({ version: 2, real: 0, isRepack: true });
    expect(parseTitle('Show.S01E01.REPACK.720p.HDTV-GRP')?.quality.revision.isRepack).toBe(true);
    expect(parseTitle('[G] Anime - 05v2 [720p]')?.quality.revision.version).toBe(2);
  });

  it('detects languages and defaults to English', () => {
    expect(parseTitle('Show.S01E01.720p.HDTV-GRP')?.languages).toEqual(['English']);
    expect(parseTitle('Show.S01E01.FRENCH.720p.HDTV-GRP')?.languages).toEqual(['French']);
    expect(parseTitle('Show.S01E01.MULTi.German.1080p.WEB-DL-GRP')?.languages).toEqual(['Multi', 'German']);
  });

  it('does not treat a leading quality-like bracket tag as the series title', () => {
    expect(parseTitle('[Group] Show S01E05 720p')).toMatchObject({
      seriesTitle: 'Show',
      seasonNumber: 1,
      episodeNumbers: [5],
      releaseGroup: 'Group',
    });
  });
});

describe('parseTitle rejects', () => {
  const rejects = [
    '',
    '   ',
    'readme.txt',
    'random text without markers',
    'Show.Name.2024.13.45',
    'Daily.Show.2024.02.30',
    'Daily.Show.1800.01.01',
    'Season 1',
    '/tv/Show/Season 1',
    'Show Name - 101',
    'Show.Name.1920x1080.mkv',
    'Movie.Title.2019.1080p.BluRay.x264-GRP',
    'poster.jpg',
  ];
  it.each(rejects)('%j -> null', (input) => {
    expect(parseTitle(input)).toBeNull();
  });
});

describe('parseTitle performance', () => {
  const adversarial = [
    'a'.repeat(10_000),
    ' '.repeat(10_000),
    '-'.repeat(10_000),
    '.'.repeat(10_000),
    '['.repeat(10_000),
    '[a] ' + 'a - '.repeat(2_500),
    '[a] ' + ' - '.repeat(3_000) + 'x',
    'Show '.repeat(2_000),
    'S01E01-'.repeat(1_400),
    'S01E01E'.repeat(1_400),
    's1 '.repeat(3_000),
    '1x01-'.repeat(2_000),
    '2024.03.'.repeat(1_250),
    'a-b'.repeat(3_300),
    'Show.S01E01.' + 'x-'.repeat(5_000),
    '1'.repeat(10_000) + 'x',
  ];
  it.each(adversarial.map((s) => [s.slice(0, 14), s] as const))('parses %j... in under 50 ms', (_l, input) => {
    const start = performance.now();
    parseTitle(input);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
