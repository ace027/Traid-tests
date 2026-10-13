import { QUALITIES } from '@sonarr/shared';
import type { Episode, NamingConfig, NamingExamples, NamingValidation, QualityModel, Series } from '@sonarr/shared';
import { parseFormat, renderFormat, resolveToken, type RenderOptions, type TokenContext } from './tokens.js';

export type NamingSeries = Pick<Series, 'title' | 'year' | 'seriesType'>;
export type NamingEpisode = Pick<Episode, 'seasonNumber' | 'episodeNumber' | 'title'> &
  Partial<Pick<Episode, 'airDate' | 'absoluteEpisodeNumber'>>;

export interface EpisodeNameInput {
  series: NamingSeries;
  /** Sorted by episode number. */
  episodes: NamingEpisode[];
  quality: QualityModel;
  releaseGroup?: string;
  sceneName?: string;
  originalFileName?: string;
}

const renderOptions = (n: NamingConfig): RenderOptions => ({
  replaceIllegalCharacters: n.replaceIllegalCharacters,
  colonReplacementFormat: n.colonReplacementFormat,
  multiEpisodeStyle: n.multiEpisodeStyle,
});

/** Episode title for one or several episodes; "Title (1)", "Title (2)" collapse to "Title". */
function joinTitles(episodes: NamingEpisode[]): string {
  const titles = episodes.map((e) => e.title.trim());
  if (titles.length <= 1) return titles[0] ?? '';
  const bases = titles.map((t) => t.replace(/\s*\(\d+\)$/, '').trim());
  if (bases.every((b) => b === bases[0])) return bases[0]!;
  return [...new Set(titles)].join(' + ');
}

const stripExtension = (name: string) => name.replace(/\.[A-Za-z0-9]{2,4}$/, '');

/** The file name (no extension) for the episode file, per the naming config. */
export function buildEpisodeFileName(input: EpisodeNameInput, naming: NamingConfig): string {
  const { series, episodes } = input;
  const first = episodes[0];
  if (!naming.renameEpisodes && input.originalFileName) return stripExtension(input.originalFileName);
  const absolute = episodes.map((e) => e.absoluteEpisodeNumber).filter((n): n is number => typeof n === 'number' && n > 0);
  const ctx: TokenContext = {
    seriesTitle: series.title,
    seriesYear: series.year,
    seasonNumber: first?.seasonNumber ?? 0,
    episodeNumbers: episodes.map((e) => e.episodeNumber),
    absoluteNumbers: absolute,
    episodeTitle: joinTitles(episodes),
    quality: input.quality,
  };
  if (first?.airDate) ctx.airDate = first.airDate;
  if (input.releaseGroup) ctx.releaseGroup = input.releaseGroup;
  if (input.sceneName) ctx.originalTitle = input.sceneName;
  if (input.originalFileName) ctx.originalFilename = stripExtension(input.originalFileName);

  let format = naming.standardEpisodeFormat;
  if (series.seriesType === 'daily' && first?.airDate) format = naming.dailyEpisodeFormat;
  else if (series.seriesType === 'anime' && absolute.length > 0) format = naming.animeEpisodeFormat;
  const name = renderFormat(format, ctx, renderOptions(naming));
  return name || stripExtension(input.originalFileName ?? '') || 'Episode';
}

export function buildSeriesFolderName(series: Pick<Series, 'title' | 'year'>, naming: NamingConfig): string {
  const ctx: TokenContext = {
    seriesTitle: series.title,
    seriesYear: series.year,
    seasonNumber: 0,
    episodeNumbers: [],
    absoluteNumbers: [],
    episodeTitle: '',
  };
  return renderFormat(naming.seriesFolderFormat, ctx, renderOptions(naming)) || 'Series';
}

export function buildSeasonFolderName(seasonNumber: number, naming: NamingConfig): string {
  const ctx: TokenContext = {
    seriesTitle: '',
    seriesYear: 0,
    seasonNumber,
    episodeNumbers: [],
    absoluteNumbers: [],
    episodeTitle: '',
  };
  const format = seasonNumber === 0 ? naming.specialsFolderFormat : naming.seasonFolderFormat;
  return renderFormat(format, ctx, renderOptions(naming)) || `Season ${seasonNumber}`;
}

// ---------------------------------------------------------------- validation

const FORMAT_FIELDS = [
  'standardEpisodeFormat',
  'dailyEpisodeFormat',
  'animeEpisodeFormat',
  'seriesFolderFormat',
  'seasonFolderFormat',
  'specialsFolderFormat',
] as const;

export function validateNaming(naming: NamingConfig): NamingValidation {
  const errors: NamingValidation['errors'] = [];
  const add = (propertyName: string, errorMessage: string) => errors.push({ propertyName, errorMessage });

  for (const field of FORMAT_FIELDS) {
    const { parts, errors: structural } = parseFormat(naming[field]);
    for (const e of structural) add(field, e);
    const keys = new Set<string>();
    for (const p of parts) {
      if (p.kind !== 'token') continue;
      if (!resolveToken(p)) add(field, `Unknown token '{${p.raw}}'`);
      else keys.add(p.key);
    }
    const has = (k: string) => keys.has(k);
    const original = has('original title') || has('original filename');
    const seasonEpisode = has('season') && has('episode');
    switch (field) {
      case 'standardEpisodeFormat':
        if (!seasonEpisode && !original) add(field, 'Must contain season and episode numbers or Original Title');
        break;
      case 'dailyEpisodeFormat':
        if (!has('air-date') && !has('air date') && !original) add(field, 'Must contain Air-Date or Original Title');
        break;
      case 'animeEpisodeFormat':
        if (!has('absolute') && !seasonEpisode && !original) {
          add(field, 'Must contain absolute episode number or season and episode numbers, or Original Title');
        }
        break;
      case 'seriesFolderFormat':
        if (![...keys].some((k) => k.startsWith('series '))) add(field, 'Must contain a Series token');
        break;
      case 'seasonFolderFormat':
        if (!has('season')) add(field, 'Must contain a season token');
        break;
      default:
        break;
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------- examples

const sampleQuality = (): QualityModel => ({
  quality: QUALITIES.find((q) => q.name === 'HDTV-720p')!,
  revision: { version: 1, real: 0, isRepack: false },
});

export function getNamingExamples(naming: NamingConfig): NamingExamples {
  const series: NamingSeries = { title: 'The Series Title!', year: 2010, seriesType: 'standard' };
  const base = { quality: sampleQuality(), releaseGroup: 'RlsGrp' };
  const ep = (n: number): NamingEpisode => ({ seasonNumber: 1, episodeNumber: n, title: `Episode Title (${n})` });
  const safe = (fn: () => string) => {
    try {
      return fn();
    } catch {
      return '';
    }
  };
  return {
    singleEpisodeExample: safe(() => buildEpisodeFileName({ ...base, series, episodes: [ep(1)] }, naming)),
    multiEpisodeExample: safe(() => buildEpisodeFileName({ ...base, series, episodes: [ep(1), ep(2), ep(3)] }, naming)),
    dailyEpisodeExample: safe(() =>
      buildEpisodeFileName(
        {
          ...base,
          series: { ...series, seriesType: 'daily' },
          episodes: [{ seasonNumber: 1, episodeNumber: 1, title: 'Daily Episode Title', airDate: '2013-10-30' }],
        },
        naming,
      ),
    ),
    animeEpisodeExample: safe(() =>
      buildEpisodeFileName(
        {
          ...base,
          series: { ...series, seriesType: 'anime' },
          episodes: [{ seasonNumber: 1, episodeNumber: 1, title: 'Anime Episode Title', absoluteEpisodeNumber: 1 }],
        },
        naming,
      ),
    ),
    seriesFolderExample: safe(() => buildSeriesFolderName(series, naming)),
    seasonFolderExample: safe(() => buildSeasonFolderName(1, naming)),
    specialsFolderExample: safe(() => buildSeasonFolderName(0, naming)),
  };
}
