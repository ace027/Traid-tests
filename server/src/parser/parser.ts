import { parseQuality } from './quality.js';
import type { ParsedEpisodeInfo } from './types.js';

// Every regex below is flat: bounded repetition only, no nested quantifiers, and
// anchored/lookaround-delimited tokens, so matching is linear in the input length.
// Input is additionally capped so a hostile release title cannot cost more than a bounded scan.

const MAX_INPUT = 4096;
const MAX_RANGE = 100;
const MAX_CONTINUATIONS = 100;

const VIDEO_EXTENSIONS = new Set([
  'mkv', 'mp4', 'avi', 'm4v', 'wmv', 'ts', 'mov', 'webm', 'mpg', 'mpeg', 'm2ts',
]);

const ANIME = /^(.+?) - (\d{1,4})(?:-(\d{1,4}))?(v[2-4])?(?= |\[|\(|$)/;
const DAILY = /(?<![0-9])(\d{4})([. -])(\d{2})\2(\d{2})(?![0-9])/g;
const SXXEYY = /(?<![a-z0-9])s(\d{1,2})[ .]?e(\d{1,3})(?![0-9])/i;
const NXMM = /(?<![a-z0-9])(\d{1,2})x(\d{2,3})(?![0-9])/i;
const SEASON = /(?<![a-z0-9])(?:s|season[ .]?)(\d{1,2})(?![0-9a-z])/i;

const CONT_SEASON_EP = /([-. ]?)s(\d{1,2})[ .]?e(\d{1,3})(?![0-9])/iy;
const CONT_EP = /([-. ]?)e(\d{1,3})(?![0-9])/iy;
const CONT_X = /()x(\d{2,3})(?![0-9])/iy;
const CONT_RANGE = /(-)(\d{1,3})(?![0-9a-z])/iy;
const CONT_SEASON = /[-. ]?(?:to[-. ])?s(?:eason)?[ .]?(\d{1,2})(?![0-9a-z])/iy;

const GROUP = /-([a-z0-9]{2,20})(?:\[[a-z0-9]{1,20}\])?$/i;
const NOT_A_GROUP = new Set(['dl', 'ray', 'rip', 'hd', 'web', 'tv', 'multi', 'sub', 'subs', 'dub']);
const LANGUAGE = /(?<![a-z0-9])(french|german|spanish|italian|japanese|multi)(?![a-z0-9])/gi;
const LANGUAGE_NAMES: Record<string, string> = {
  french: 'French',
  german: 'German',
  spanish: 'Spanish',
  italian: 'Italian',
  japanese: 'Japanese',
  multi: 'Multi',
};

interface Match {
  /** Index in the body where the title ends. */
  index: number;
  /** Index in the body where the matched token ends. */
  end: number;
  seasonNumber: number;
  episodeNumbers: number[];
  absoluteEpisodeNumbers: number[];
  airDate?: string;
  fullSeason: boolean;
  isMultiSeason: boolean;
  isDaily: boolean;
  isAbsoluteNumbering: boolean;
  /** Text prepended to the rest before quality parsing (e.g. anime "v2"). */
  restPrefix: string;
}

function trimSeparators(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isSeparator(s.charCodeAt(start))) start++;
  while (end > start && isSeparator(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

function isSeparator(code: number): boolean {
  // space, '-', '.'
  return code === 32 || code === 45 || code === 46;
}

function collapseSpaces(s: string): string {
  return s.replace(/[._]/g, ' ').replace(/ {2,}/g, ' ');
}

function cleanTitle(raw: string): { title: string; year?: number } {
  let title = trimSeparators(collapseSpaces(raw));
  let year: number | undefined;
  if (title.length > 6) {
    const tail = /^\((\d{4})\)$/.exec(title.slice(-6));
    if (tail) {
      year = Number(tail[1]);
      title = trimSeparators(title.slice(0, -6));
    }
  }
  return year === undefined ? { title } : { title, year };
}

function cleanSeriesTitle(title: string): string {
  const lower = title.toLowerCase();
  const stripped = lower.startsWith('the ') ? lower.slice(4) : lower;
  return stripped.replace(/[^\p{L}\p{N}]/gu, '');
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

function addEpisode(episodes: number[], n: number, expand: boolean): void {
  const last = episodes[episodes.length - 1];
  if (expand && last !== undefined && n > last && n - last <= MAX_RANGE) {
    episodes.push(...range(last + 1, n));
  } else if (!episodes.includes(n)) {
    episodes.push(n);
  }
}

/** Reads trailing "E02", "-E03", "-03", ".S01E02" style continuations after the first episode. */
function extendEpisodes(
  body: string,
  start: number,
  season: number,
  episodes: number[],
  patterns: RegExp[],
): number {
  let pos = start;
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    let advanced = false;
    for (const re of patterns) {
      re.lastIndex = pos;
      const m = re.exec(body);
      if (!m) continue;
      if (re === CONT_SEASON_EP) {
        if (Number(m[2]) !== season) return pos;
        addEpisode(episodes, Number(m[3]), m[1] === '-');
      } else {
        addEpisode(episodes, Number(m[2]), m[1] === '-');
      }
      pos = re.lastIndex;
      advanced = true;
      break;
    }
    if (!advanced) break;
  }
  return pos;
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1950 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= days;
}

function base(index: number, end: number): Match {
  return {
    index,
    end,
    seasonNumber: 0,
    episodeNumbers: [],
    absoluteEpisodeNumbers: [],
    fullSeason: false,
    isMultiSeason: false,
    isDaily: false,
    isAbsoluteNumbering: false,
    restPrefix: '',
  };
}

function matchAnime(body: string, hasGroup: boolean): Match | null {
  const m = ANIME.exec(body);
  if (!m) return null;
  const next = body.charAt(m[0].length);
  // Without a leading [Group], require an explicit version or trailing tag to avoid false positives.
  if (!hasGroup && !m[4] && next !== '[' && next !== '(') return null;
  const first = Number(m[2]);
  const absolute = [first];
  if (m[3] !== undefined) addEpisode(absolute, Number(m[3]), true);
  const match = base((m[1] ?? '').length, m[0].length - (m[4]?.length ?? 0));
  match.absoluteEpisodeNumbers = absolute;
  match.isAbsoluteNumbering = true;
  match.restPrefix = m[4] ? `${m[4]} ` : '';
  return match;
}

function matchDaily(body: string): Match | null {
  DAILY.lastIndex = 0;
  for (let m = DAILY.exec(body); m; m = DAILY.exec(body)) {
    const year = Number(m[1]);
    const month = Number(m[3]);
    const day = Number(m[4]);
    if (!validDate(year, month, day)) continue;
    const match = base(m.index, m.index + m[0].length);
    match.isDaily = true;
    match.airDate = `${m[1]}-${m[3]}-${m[4]}`;
    return match;
  }
  return null;
}

function matchEpisodic(body: string): Match | null {
  const se = SXXEYY.exec(body);
  if (se) {
    const season = Number(se[1]);
    const episodes = [Number(se[2])];
    const end = extendEpisodes(body, se.index + se[0].length, season, episodes, [
      CONT_SEASON_EP,
      CONT_EP,
      CONT_RANGE,
    ]);
    const match = base(se.index, end);
    match.seasonNumber = season;
    match.episodeNumbers = episodes;
    return match;
  }
  const nx = NXMM.exec(body);
  if (nx) {
    const season = Number(nx[1]);
    const episodes = [Number(nx[2])];
    const end = extendEpisodes(body, nx.index + nx[0].length, season, episodes, [CONT_X, CONT_RANGE]);
    const match = base(nx.index, end);
    match.seasonNumber = season;
    match.episodeNumbers = episodes;
    return match;
  }
  return null;
}

function matchSeasonPack(body: string): Match | null {
  const m = SEASON.exec(body);
  if (!m) return null;
  let pos = m.index + m[0].length;
  const match = base(m.index, pos);
  match.seasonNumber = Number(m[1]);
  match.fullSeason = true;
  for (let i = 0; i < 20; i++) {
    CONT_SEASON.lastIndex = pos;
    const c = CONT_SEASON.exec(body);
    if (!c) break;
    match.isMultiSeason = true;
    pos = CONT_SEASON.lastIndex;
  }
  match.end = pos;
  return match;
}

function findGroup(rest: string): string | undefined {
  const m = GROUP.exec(rest);
  const group = m?.[1];
  if (!group) return undefined;
  const lower = group.toLowerCase();
  if (NOT_A_GROUP.has(lower)) return undefined;
  if (/^(?:\d+[pi]?|e\d+|\d+x\d+)$/.test(lower)) return undefined;
  return group;
}

function findLanguages(rest: string): string[] {
  const found: string[] = [];
  for (const m of rest.matchAll(LANGUAGE)) {
    const name = LANGUAGE_NAMES[(m[1] ?? '').toLowerCase()];
    if (name && !found.includes(name)) found.push(name);
  }
  return found.length > 0 ? found : ['English'];
}

function splitPath(input: string): { name: string; inSpecials: boolean } {
  const parts = input.slice(-MAX_INPUT * 2).split(/[\\/]/);
  const name = parts[parts.length - 1] ?? '';
  const inSpecials = parts.slice(0, -1).some((p) => p.trim().toLowerCase() === 'specials');
  return { name, inSpecials };
}

/** Parses a file name, path or release title. Returns null when no episode pattern matches. */
export function parseTitle(input: string): ParsedEpisodeInfo | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const { name, inSpecials } = splitPath(input);

  let normalized = name.slice(0, MAX_INPUT);
  const dot = normalized.lastIndexOf('.');
  if (dot >= 0 && VIDEO_EXTENSIONS.has(normalized.slice(dot + 1).toLowerCase())) {
    normalized = normalized.slice(0, dot);
  }
  normalized = normalized.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;

  let leadGroup: string | undefined;
  let body = normalized;
  if (body.startsWith('[')) {
    const close = body.indexOf(']');
    if (close > 1 && close <= 65) {
      leadGroup = body.slice(1, close).trim() || undefined;
      body = body.slice(close + 1).trim();
    }
  }

  let match: Match | null = null;
  if (leadGroup) match = matchAnime(body, true);
  match ??= matchDaily(body);
  match ??= matchEpisodic(body);
  if (!match) {
    const pack = matchSeasonPack(body);
    // A bare "Season 1" with no series title is a folder name, not a release.
    if (pack && trimSeparators(collapseSpaces(body.slice(0, pack.index))).length > 0) match = pack;
  }
  if (!match && !leadGroup) match = matchAnime(body, false);
  if (!match) return null;

  const { title, year } = cleanTitle(body.slice(0, match.index));
  const rest = match.restPrefix + body.slice(match.end);
  const releaseGroup = (match.isAbsoluteNumbering ? undefined : findGroup(rest)) ?? leadGroup;

  const special =
    !match.isDaily &&
    ((match.isAbsoluteNumbering && inSpecials) || (!match.isAbsoluteNumbering && match.seasonNumber === 0));

  const info: ParsedEpisodeInfo = {
    seriesTitle: title,
    cleanSeriesTitle: cleanSeriesTitle(title),
    seasonNumber: match.seasonNumber,
    episodeNumbers: match.episodeNumbers,
    absoluteEpisodeNumbers: match.absoluteEpisodeNumbers,
    fullSeason: match.fullSeason,
    isDaily: match.isDaily,
    isAbsoluteNumbering: match.isAbsoluteNumbering,
    isMultiSeason: match.isMultiSeason,
    special,
    quality: parseQuality(rest),
    releaseTitle: normalized,
    languages: findLanguages(rest),
  };
  if (year !== undefined) info.year = year;
  if (match.airDate) info.airDate = match.airDate;
  if (releaseGroup) info.releaseGroup = releaseGroup;
  return info;
}
