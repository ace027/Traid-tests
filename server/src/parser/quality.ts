import { QUALITIES, type Quality } from '@sonarr/shared';
import type { QualityModel } from './types.js';

// All patterns are flat alternations of literals with lookaround word boundaries
// (no nested quantifiers), so matching is linear in the input length.
const word = (alts: string): RegExp => new RegExp(`(?<![a-z0-9])(?:${alts})(?![a-z0-9])`);

const RESOLUTION = /(?<![a-z0-9])(?:(2160|1080|720|576|480)[pi]|\d{3,4}x(2160|1080|720|576|480)|(4k|uhd))(?![a-z0-9])/;
const REMUX = word('remux|bdremux');
const RAW_HD = word('raw[- ]?hd');
const BLURAY = word('blu[- .]?ray|bdrip|brrip');
const WEBRIP = word('web[- .]?rip');
const WEBDL = word('web[- .]?dl|web|amzn|nf|dsnp|hmax|atvp|hulu|pcok');
const TELEVISION = word('hdtv|pdtv|dsr|dsrip|tvrip|hdtvrip');
const SDTV = word('sdtv');
const DVD = word('dvd|dvdrip|dvd[- ]?r|ntsc|pal');
const XVID = word('xvid');

const PROPER = word('proper');
const REPACK = word('repack|rerip');
const VERSION = /(?:^|[^a-z0-9])v([2-4])(?![a-z0-9])|\dv([2-4])(?![a-z0-9])/;
const REAL = /(?<![A-Za-z0-9])REAL(?![A-Za-z0-9])/g;

const byName = new Map<string, Quality>(QUALITIES.map((q) => [q.name, q]));

function get(name: string): Quality {
  const quality = byName.get(name);
  if (!quality) throw new Error(`Unknown quality ${name}`);
  return quality;
}

function resolutionOf(n: string): number {
  const m = RESOLUTION.exec(n);
  if (!m) return 0;
  if (m[3]) return 2160;
  return Number(m[1] ?? m[2]);
}

function pick(prefix: string, resolution: number, fallback: string): Quality {
  if (resolution >= 2160) return get(`${prefix}-2160p`);
  if (resolution >= 1080) return get(`${prefix}-1080p`);
  if (resolution >= 720) return get(`${prefix}-720p`);
  if (resolution > 0) return get(`${prefix}-480p`);
  return get(fallback);
}

function qualityOf(n: string): Quality {
  const res = resolutionOf(n);
  if (REMUX.test(n)) return get(res >= 2160 ? 'Bluray-2160p Remux' : 'Bluray-1080p Remux');
  if (RAW_HD.test(n)) return get('Raw-HD');
  if (BLURAY.test(n)) return pick('Bluray', res, 'Bluray-720p');
  if (WEBRIP.test(n)) return pick('WEBRip', res, 'WEBRip-480p');
  if (WEBDL.test(n)) return pick('WEBDL', res, 'WEBDL-480p');
  if (SDTV.test(n)) return get('SDTV');
  if (TELEVISION.test(n)) {
    if (res >= 2160) return get('HDTV-2160p');
    if (res >= 1080) return get('HDTV-1080p');
    if (res >= 720) return get('HDTV-720p');
    return get('SDTV');
  }
  if (DVD.test(n) || (res === 0 && XVID.test(n))) return get('DVD');
  // Resolution only, no recognised source: assume broadcast.
  if (res >= 2160) return get('HDTV-2160p');
  if (res >= 1080) return get('HDTV-1080p');
  if (res >= 720) return get('HDTV-720p');
  if (res > 0) return get('SDTV');
  return get('Unknown');
}

export function parseQuality(name: string): QualityModel {
  const original = name.slice(0, 4096).replace(/_/g, ' ');
  const n = original.toLowerCase();

  let version = 1;
  let isRepack = false;
  if (PROPER.test(n)) version = 2;
  if (REPACK.test(n)) {
    version = 2;
    isRepack = true;
  }
  const v = VERSION.exec(n);
  if (v) version = Math.max(version, Number(v[1] ?? v[2]));
  const real = Array.from(original.matchAll(REAL)).length;

  return { quality: qualityOf(n), revision: { version, real, isRepack } };
}
