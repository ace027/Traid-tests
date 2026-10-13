import { describe, expect, it } from 'vitest';
import { QUALITIES, namingConfigSchema, type NamingConfig, type QualityModel } from '@sonarr/shared';
import { parseTitle } from '../parser/index.js';
import {
  buildEpisodeFileName,
  buildSeasonFolderName,
  buildSeriesFolderName,
  getNamingExamples,
  validateNaming,
  type EpisodeNameInput,
  type NamingEpisode,
} from './naming.js';

const defaults = (over: Partial<NamingConfig> = {}): NamingConfig => namingConfigSchema.parse(over);
const q = (name: string, version = 1, isRepack = false): QualityModel => ({
  quality: QUALITIES.find((x) => x.name === name)!,
  revision: { version, real: 0, isRepack },
});
const ep = (n: number, title = `Episode Title (${n})`, season = 1): NamingEpisode => ({ seasonNumber: season, episodeNumber: n, title });
const series = { title: 'The Series Title!', year: 2010, seriesType: 'standard' as const };
const input = (over: Partial<EpisodeNameInput> = {}): EpisodeNameInput => ({
  series,
  episodes: [ep(1)],
  quality: q('HDTV-720p'),
  releaseGroup: 'RlsGrp',
  sceneName: 'The.Series.Title.S01E01.720p.HDTV-RlsGrp',
  originalFileName: 'original.name.mkv',
  ...over,
});
const name = (format: string, over: Partial<EpisodeNameInput> = {}, cfg: Partial<NamingConfig> = {}) =>
  buildEpisodeFileName(input(over), defaults({ standardEpisodeFormat: format, ...cfg }));

describe('tokens', () => {
  const table: [string, string][] = [
    ['{Series Title}', 'The Series Title!'],
    ['{Series TitleYear}', 'The Series Title! (2010)'],
    ['{Series CleanTitle}', 'The Series Title'],
    ['{Series TitleThe}', 'Series Title!, The'],
    ['{season:0}', '1'],
    ['{season:00}', '01'],
    ['{episode:0}', '1'],
    ['{episode:00}', '01'],
    ['{absolute:00}', ''],
    ['{Episode Title}', 'Episode Title (1)'],
    ['{Episode CleanTitle}', 'Episode Title 1'],
    ['{Quality Full}', 'HDTV-720p'],
    ['{Quality Title}', 'HDTV-720p'],
    ['{Quality Proper}', ''],
    ['{Release Group}', 'RlsGrp'],
    ['{Original Title}', 'The.Series.Title.S01E01.720p.HDTV-RlsGrp'],
    ['{Original Filename}', 'original.name'],
  ];
  it.each(table)('renders %s', (token, expected) => {
    expect(name(`${token} S{season:00}E{episode:00}`)).toBe(`${expected} S01E01`.trim());
  });

  it('renders air date tokens', () => {
    const daily = { episodes: [{ ...ep(1), airDate: '2013-10-30' }] };
    expect(name('{Air-Date}', daily)).toBe('2013-10-30');
    expect(name('{Air Date}', daily)).toBe('2013 10 30');
  });

  it('pads absolute numbers', () => {
    const e = [{ ...ep(1), absoluteEpisodeNumber: 7 }];
    expect(name('{absolute:000}', { episodes: e })).toBe('007');
  });

  it('applies case from the token casing', () => {
    expect(name('{series title}')).toBe('the series title!');
    expect(name('{SERIES TITLE}')).toBe('THE SERIES TITLE!');
    expect(name('{Series Title}')).toBe('The Series Title!');
  });

  it('applies separator variants', () => {
    expect(name('{Series.Title}')).toBe('The.Series.Title!');
    expect(name('{Series_Title}')).toBe('The_Series_Title!');
    expect(name('{series.title}')).toBe('the.series.title!');
    expect(name('{Quality.Full}', { quality: q('Bluray-1080p Remux') })).toBe('Bluray-1080p.Remux');
  });

  it('adds Proper and Repack to the full quality', () => {
    expect(name('{Quality Full}', { quality: q('WEBDL-1080p', 2) })).toBe('WEBDL-1080p Proper');
    expect(name('{Quality Full}', { quality: q('WEBDL-1080p', 2, true) })).toBe('WEBDL-1080p Repack');
    expect(name('{Quality Proper}', { quality: q('WEBDL-1080p', 2) })).toBe('Proper');
  });

  it('leaves unknown tokens as written', () => {
    expect(name('{Nope} S{season:00}E{episode:00}')).toBe('{Nope} S01E01');
  });
});

describe('multi-episode styles', () => {
  const three = { episodes: [ep(1), ep(2), ep(3)] };
  const fmt = 'S{season:00}E{episode:00}';
  const cases: [NamingConfig['multiEpisodeStyle'], string][] = [
    ['extend', 'S01E01-02-03'],
    ['duplicate', 'S01E01.S01E02.S01E03'],
    ['repeat', 'S01E01E02E03'],
    ['scene', 'S01E01-E02-E03'],
    ['range', 'S01E01-03'],
    ['prefixedRange', 'S01E01-E03'],
  ];
  it.each(cases)('%s', (style, expected) => {
    expect(name(fmt, three, { multiEpisodeStyle: style })).toBe(expected);
  });

  it('collapses identical numbered titles', () => {
    expect(name('{Episode Title}', three)).toBe('Episode Title');
  });

  it('joins different titles with +', () => {
    expect(name('{Episode Title}', { episodes: [ep(1, 'One'), ep(2, 'Two')] })).toBe('One + Two');
  });

  it('keeps the numbered title of a single episode', () => {
    expect(name('{Episode Title}')).toBe('Episode Title (1)');
  });
});

describe('cleaning', () => {
  const t = (title: string, cfg: Partial<NamingConfig> = {}) => name('{Episode Title}', { episodes: [ep(1, title)] }, cfg);
  it('handles colon modes', () => {
    expect(t('A: B', { colonReplacementFormat: 'delete' })).toBe('A B');
    expect(t('A: B', { colonReplacementFormat: 'dash' })).toBe('A- B');
    expect(t('A: B', { colonReplacementFormat: 'spaceDash' })).toBe('A - B');
    expect(t('A: B', { colonReplacementFormat: 'spaceDashSpace' })).toBe('A - B');
    expect(t('A: B', { colonReplacementFormat: 'smart' })).toBe('A - B');
    expect(t('A:B', { colonReplacementFormat: 'smart' })).toBe('A-B');
    expect(t('A:B', { colonReplacementFormat: 'delete' })).toBe('AB');
  });

  it('replaces illegal characters', () => {
    expect(t('What? A "test" <of> a/b*c|d\\e')).toBe("What! A 'test' of a+b-c-d+e");
  });

  it('removes illegal characters when replacing is off', () => {
    expect(t('A: What? "B"', { replaceIllegalCharacters: false })).toBe('A What B');
  });

  it('collapses empty release group separators', () => {
    const noGroup = { releaseGroup: undefined };
    expect(name('{Series Title} - S{season:00}E{episode:00} - {Release Group}', noGroup)).toBe('The Series Title! - S01E01');
    expect(name('{Series Title} - {Release Group} - S{season:00}E{episode:00}', noGroup)).toBe('The Series Title! - S01E01');
    expect(name('{Series Title} [{Release Group}]', noGroup)).toBe('The Series Title!');
    expect(name('{Series Title}-{Release Group}')).toBe('The Series Title!-RlsGrp');
  });

  it('trims trailing dots and spaces', () => {
    expect(t('Title...  ')).toBe('Title');
  });
});

describe('formats by series type', () => {
  it('uses the daily format for daily series', () => {
    const r = buildEpisodeFileName(
      input({ series: { ...series, seriesType: 'daily' }, episodes: [{ seasonNumber: 1, episodeNumber: 1, title: 'Daily', airDate: '2013-10-30' }] }),
      defaults(),
    );
    expect(r).toBe('The Series Title! - 2013-10-30 - Daily HDTV-720p');
  });

  it('uses the anime format for anime series', () => {
    const r = buildEpisodeFileName(
      input({ series: { ...series, seriesType: 'anime' }, episodes: [{ ...ep(1, 'Anime'), absoluteEpisodeNumber: 1 }] }),
      defaults(),
    );
    expect(r).toBe('The Series Title! - S01E01 - 001 - Anime HDTV-720p');
  });

  it('returns the original name when renaming is off', () => {
    expect(buildEpisodeFileName(input(), defaults({ renameEpisodes: false }))).toBe('original.name');
  });
});

describe('folders', () => {
  it('builds series folders', () => {
    expect(buildSeriesFolderName({ title: 'The Series Title!', year: 2010 }, defaults())).toBe('The Series Title! (2010)');
  });
  it('omits a missing year', () => {
    expect(buildSeriesFolderName({ title: 'No Year', year: 0 }, defaults())).toBe('No Year');
  });
  it('replaces colons and trims trailing dots', () => {
    expect(buildSeriesFolderName({ title: 'Mr. Robot: Part 2...', year: 0 }, defaults())).toBe('Mr. Robot - Part 2');
  });
  it('builds season and specials folders', () => {
    expect(buildSeasonFolderName(3, defaults())).toBe('Season 03');
    expect(buildSeasonFolderName(0, defaults())).toBe('Specials');
    expect(buildSeasonFolderName(2, defaults({ seasonFolderFormat: 'Season {season:0}' }))).toBe('Season 2');
  });
});

describe('validateNaming', () => {
  it('accepts the defaults', () => {
    expect(validateNaming(defaults())).toEqual({ valid: true, errors: [] });
  });
  it('reports unknown tokens', () => {
    const r = validateNaming(defaults({ standardEpisodeFormat: '{Series Title} {Bogus} S{season:00}E{episode:00}' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([{ propertyName: 'standardEpisodeFormat', errorMessage: "Unknown token '{Bogus}'" }]);
  });
  it('requires season and episode in the standard format unless Original Title is used', () => {
    expect(validateNaming(defaults({ standardEpisodeFormat: '{Series Title}' })).valid).toBe(false);
    expect(validateNaming(defaults({ standardEpisodeFormat: '{Original Title}' })).valid).toBe(true);
  });
  it('requires an air date in the daily format', () => {
    expect(validateNaming(defaults({ dailyEpisodeFormat: '{Series Title} S{season:00}E{episode:00}' })).valid).toBe(false);
    expect(validateNaming(defaults({ dailyEpisodeFormat: '{Series Title} {Air Date}' })).valid).toBe(true);
  });
  it('requires numbering in the anime format', () => {
    expect(validateNaming(defaults({ animeEpisodeFormat: '{Series Title}' })).valid).toBe(false);
    expect(validateNaming(defaults({ animeEpisodeFormat: '{Series Title} {absolute:000}' })).valid).toBe(true);
  });
  it('reports nested and unbalanced braces and bad number formats', () => {
    expect(validateNaming(defaults({ standardEpisodeFormat: '{Series {Title}} S{season:00}E{episode:00}' })).valid).toBe(false);
    expect(validateNaming(defaults({ standardEpisodeFormat: 'S{season:xx}E{episode:00}' })).valid).toBe(false);
    expect(validateNaming(defaults({ seriesFolderFormat: 'Series' })).valid).toBe(false);
  });
});

describe('examples', () => {
  it('builds the default examples', () => {
    expect(getNamingExamples(defaults())).toEqual({
      singleEpisodeExample: 'The Series Title! - S01E01 - Episode Title (1) HDTV-720p',
      multiEpisodeExample: 'The Series Title! - S01E01-E03 - Episode Title HDTV-720p',
      dailyEpisodeExample: 'The Series Title! - 2013-10-30 - Daily Episode Title HDTV-720p',
      animeEpisodeExample: 'The Series Title! - S01E01 - 001 - Anime Episode Title HDTV-720p',
      seriesFolderExample: 'The Series Title! (2010)',
      seasonFolderExample: 'Season 01',
      specialsFolderExample: 'Specials',
    });
  });
  it('previews custom formats', () => {
    const ex = getNamingExamples(defaults({ standardEpisodeFormat: '{series.title}.{season:0}x{episode:00}', multiEpisodeStyle: 'extend' }));
    expect(ex.singleEpisodeExample).toBe('the.series.title!.1x01');
    expect(ex.multiEpisodeExample).toBe('the.series.title!.1x01-02-03');
  });
});

describe('round trip through the parser', () => {
  it('standard', () => {
    const cfg = defaults();
    const single = parseTitle(`${buildEpisodeFileName(input({ sceneName: undefined }), cfg)}.mkv`)!;
    expect(single.seasonNumber).toBe(1);
    expect(single.episodeNumbers).toEqual([1]);
    const multi = parseTitle(`${buildEpisodeFileName(input({ episodes: [ep(1), ep(2), ep(3)] }), cfg)}.mkv`)!;
    expect(multi.seasonNumber).toBe(1);
    expect(multi.episodeNumbers).toEqual([1, 2, 3]);
  });
  it('daily', () => {
    const r = buildEpisodeFileName(
      input({ series: { ...series, title: 'Daily Show', seriesType: 'daily' }, episodes: [{ seasonNumber: 1, episodeNumber: 1, title: 'Guest', airDate: '2013-10-30' }] }),
      defaults(),
    );
    const p = parseTitle(`${r}.mkv`)!;
    expect(p.airDate).toBe('2013-10-30');
    expect(p.isDaily).toBe(true);
  });
  it('anime', () => {
    const r = buildEpisodeFileName(
      input({ series: { ...series, title: 'Anime Show', seriesType: 'anime' }, episodes: [{ ...ep(1, 'Pilot'), absoluteEpisodeNumber: 12, episodeNumber: 12 }] }),
      defaults(),
    );
    const p = parseTitle(`${r}.mkv`)!;
    // The default anime format carries SxxEyy, which the parser prefers over the absolute number.
    expect(p.seasonNumber).toBe(1);
    expect(p.episodeNumbers).toEqual([12]);
  });
});
