import { describe, expect, it } from 'vitest';
import { QUALITIES } from '@sonarr/shared';
import { parseQuality } from './quality.js';

const cases: [string, string][] = [
  ['Show.S01E01.HDTV.x264-GRP', 'SDTV'],
  ['Show.S01E01.SDTV.XviD-GRP', 'SDTV'],
  ['Show.S01E01.PDTV.XviD-GRP', 'SDTV'],
  ['Show.S01E01.DSR.XviD-GRP', 'SDTV'],
  ['Show.S01E01.720p.HDTV.x264-GRP', 'HDTV-720p'],
  ['Show.S01E01.1080p.HDTV.x264-GRP', 'HDTV-1080p'],
  ['Show.S01E01.1080i.HDTV.MPEG2-GRP', 'HDTV-1080p'],
  ['Show.S01E01.2160p.HDTV.x265-GRP', 'HDTV-2160p'],
  ['Show.S01E01.4K.HDTV.x265-GRP', 'HDTV-2160p'],
  ['Show.S01E01.DVDRip.XviD-GRP', 'DVD'],
  ['Show.S01E01.DVD.x264-GRP', 'DVD'],
  ['Show.S01E01.NTSC.DVD-GRP', 'DVD'],
  ['Show.S01E01.XviD-GRP', 'DVD'],
  ['Show.S01E01.WEB-DL.x264-GRP', 'WEBDL-480p'],
  ['Show.S01E01.480p.WEB-DL.x264-GRP', 'WEBDL-480p'],
  ['Show.S01E01.720p.WEB-DL.DD5.1.H.264-GRP', 'WEBDL-720p'],
  ['Show.S01E01.1080p.WEB-DL.DD5.1.H.264-GRP', 'WEBDL-1080p'],
  ['Show.S01E01.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP', 'WEBDL-1080p'],
  ['Show.S01E01.1080p.NF.WEB.H264-GRP', 'WEBDL-1080p'],
  ['Show.S01E01.2160p.DSNP.WEBDL.DDP5.1-GRP', 'WEBDL-2160p'],
  ['Show.S01E01.720p.WEBRip.x264-GRP', 'WEBRip-720p'],
  ['Show.S01E01.1080p.WEB-Rip.x264-GRP', 'WEBRip-1080p'],
  ['Show.S01E01.2160p.WEBRip.x265-GRP', 'WEBRip-2160p'],
  ['Show.S01E01.WEBRip.x264-GRP', 'WEBRip-480p'],
  ['Show.S01E01.480p.BluRay.x264-GRP', 'Bluray-480p'],
  ['Show.S01E01.576p.BluRay.x264-GRP', 'Bluray-480p'],
  ['Show.S01E01.720p.BluRay.x264-GRP', 'Bluray-720p'],
  ['Show.S01E01.1080p.Blu-ray.x264-GRP', 'Bluray-1080p'],
  ['Show.S01E01.1080p.BDRip.x264-GRP', 'Bluray-1080p'],
  ['Show.S01E01.1080p.BRRip.x264-GRP', 'Bluray-1080p'],
  ['Show.S01E01.2160p.UHD.BluRay.x265-GRP', 'Bluray-2160p'],
  ['Show.S01E01.BluRay.x264-GRP', 'Bluray-720p'],
  ['Show.S01E01.1080p.BluRay.REMUX.AVC-GRP', 'Bluray-1080p Remux'],
  ['Show.S01E01.2160p.BluRay.Remux.HEVC-GRP', 'Bluray-2160p Remux'],
  ['Show.S01E01.Remux-GRP', 'Bluray-1080p Remux'],
  ['Show.S01E01.Raw-HD.MPEG2-GRP', 'Raw-HD'],
  ['Show.S01E01.RawHD-GRP', 'Raw-HD'],
  ['Show.S01E01.720p.x264-GRP', 'HDTV-720p'],
  ['Show.S01E01.1920x1080.x264-GRP', 'HDTV-1080p'],
  ['Show S01E01 1080p WEB DL', 'WEBDL-1080p'],
  ['Show_S01E01_720p_HDTV', 'HDTV-720p'],
  ['Show.S01E01.mkv', 'Unknown'],
  ['', 'Unknown'],
];

describe('parseQuality sources and resolutions', () => {
  it.each(cases)('%s -> %s', (name, expected) => {
    expect(parseQuality(name).quality.name).toBe(expected);
  });

  it('is exercised for every quality in QUALITIES', () => {
    const produced = new Set(cases.map(([, q]) => q));
    const missing = QUALITIES.map((q) => q.name).filter((n) => !produced.has(n));
    expect(missing).toEqual([]);
  });

  it('returns the shared Quality object', () => {
    const q = parseQuality('Show.S01E01.720p.HDTV.x264-GRP').quality;
    expect(QUALITIES).toContain(q);
    expect(q).toMatchObject({ id: 4, source: 'television', resolution: 720 });
  });
});

describe('parseQuality revisions', () => {
  const revisions: [string, { version: number; real: number; isRepack: boolean }][] = [
    ['Show.S01E01.720p.HDTV.x264-GRP', { version: 1, real: 0, isRepack: false }],
    ['Show.S01E01.PROPER.720p.HDTV.x264-GRP', { version: 2, real: 0, isRepack: false }],
    ['Show.S01E01.720p.HDTV.proper.x264-GRP', { version: 2, real: 0, isRepack: false }],
    ['Show.S01E01.REPACK.720p.HDTV.x264-GRP', { version: 2, real: 0, isRepack: true }],
    ['Show.S01E01.RERIP.720p.HDTV.x264-GRP', { version: 2, real: 0, isRepack: true }],
    ['Show.S01E01.REAL.PROPER.720p.HDTV.x264-GRP', { version: 2, real: 1, isRepack: false }],
    ['Show.S01E01.REAL.REAL.720p.HDTV.x264-GRP', { version: 1, real: 2, isRepack: false }],
    ['[Group] Show - 01v2 [720p]', { version: 2, real: 0, isRepack: false }],
    ['[Group] Show - 01 v3 [720p]', { version: 3, real: 0, isRepack: false }],
    ['[Group] Show - 01v4 [1080p]', { version: 4, real: 0, isRepack: false }],
    ['Show.S01E01.real.life.720p.HDTV-GRP', { version: 1, real: 0, isRepack: false }],
  ];
  it.each(revisions)('%s', (name, revision) => {
    expect(parseQuality(name).revision).toEqual(revision);
  });
});

describe('parseQuality performance', () => {
  const adversarial = [
    'a'.repeat(10_000),
    ' '.repeat(10_000),
    '-'.repeat(10_000),
    'web-'.repeat(2_500),
    '1080p'.repeat(2_000),
    'REAL.'.repeat(2_000),
    'v2'.repeat(5_000),
    'blu ray '.repeat(1_250),
  ];
  it.each(adversarial.map((s) => [s.slice(0, 12), s] as const))('parses %s... quickly', (_label, input) => {
    const start = performance.now();
    parseQuality(input);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
