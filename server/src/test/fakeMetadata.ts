import type { SeriesLookup } from '@sonarr/shared';
import { MetadataError, type MetadataProvider, type ProviderEpisode } from '../services/metadata/types.js';

export interface FakeShow {
  series: SeriesLookup;
  episodes: ProviderEpisode[];
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function makeShow(
  tvMazeId: number,
  title: string,
  opts: { year?: number; tvdbId?: number; status?: 'continuing' | 'ended'; seriesType?: 'standard' | 'daily' | 'anime' } = {},
): SeriesLookup {
  const year = opts.year ?? 2020;
  return {
    title,
    sortTitle: title.toLowerCase(),
    status: opts.status ?? 'continuing',
    overview: `${title} overview`,
    network: 'Fake Network',
    airTime: '21:00',
    images: [{ coverType: 'poster', url: `https://img.test/${tvMazeId}.jpg`, remoteUrl: `https://img.test/${tvMazeId}.jpg` }],
    seasons: [],
    year,
    path: '',
    qualityProfileId: 0,
    seasonFolder: true,
    monitored: true,
    monitorNewItems: 'all',
    runtime: 45,
    tvdbId: opts.tvdbId ?? 0,
    tvMazeId,
    imdbId: `tt${1000000 + tvMazeId}`,
    firstAired: `${year}-01-01`,
    seriesType: opts.seriesType ?? 'standard',
    cleanTitle: title.toLowerCase().replace(/[^a-z0-9]/g, ''),
    titleSlug: slug(title),
    rootFolderPath: '',
    certification: null,
    genres: ['Drama'],
    tags: [],
    added: '0001-01-01T00:00:00Z',
    ratings: { votes: 0, value: 8 },
    remotePoster: `https://img.test/${tvMazeId}.jpg`,
  };
}

export function makeEpisode(
  tvMazeId: number,
  seasonNumber: number,
  episodeNumber: number,
  airDate?: string,
  title = `Episode ${episodeNumber}`,
): ProviderEpisode {
  const ep: ProviderEpisode = { tvMazeId, seasonNumber, episodeNumber, title, overview: '', runtime: 45 };
  if (airDate) {
    ep.airDate = airDate;
    ep.airDateUtc = `${airDate}T01:00:00Z`;
  }
  return ep;
}

/** In-memory metadata catalog. Never touches the network. */
export class FakeMetadataProvider implements MetadataProvider {
  readonly shows = new Map<number, FakeShow>();
  searchCalls = 0;
  failWith: MetadataError | null = null;

  constructor() {
    // 100: continuing standard show, 2 aired seasons + one future episode + specials
    this.addShow(makeShow(100, 'Fake Show', { year: 2020, tvdbId: 7001 }), [
      makeEpisode(1001, 0, 1, '2020-06-01', 'Special One'),
      makeEpisode(1002, 1, 1, '2020-01-01'),
      makeEpisode(1003, 1, 2, '2020-01-08'),
      makeEpisode(1004, 2, 1, '2021-01-01'),
      makeEpisode(1005, 2, 2, '2021-01-08'),
      makeEpisode(1006, 2, 3, '2999-01-01'),
    ]);
    // 200: ended show
    this.addShow(makeShow(200, 'Ended Show', { year: 2010, tvdbId: 7002, status: 'ended' }), [
      makeEpisode(2001, 1, 1, '2010-01-01'),
      makeEpisode(2002, 1, 2, '2010-01-08'),
    ]);
    // 300: daily show
    this.addShow(makeShow(300, 'Daily Show', { year: 2015, tvdbId: 7003, seriesType: 'daily' }), [
      makeEpisode(3001, 1, 1, '2015-03-02'),
      makeEpisode(3002, 1, 2, '2015-03-03'),
      makeEpisode(3003, 1, 3, '2015-03-04'),
    ]);
    // 400: same title as 100 but different year, for slug collision tests
    this.addShow(makeShow(400, 'Fake Show', { year: 2005, tvdbId: 7004 }), [makeEpisode(4001, 1, 1, '2005-01-01')]);
    // 500: no premiere year
    const noYear = makeShow(500, 'Yearless Show', { year: 0, tvdbId: 7005 });
    noYear.firstAired = null;
    this.addShow(noYear, [makeEpisode(5001, 1, 1)]);
  }

  addShow(series: SeriesLookup, episodes: ProviderEpisode[]): void {
    this.shows.set(series.tvMazeId, { series, episodes });
  }

  addEpisode(tvMazeId: number, ep: ProviderEpisode): void {
    this.mustGet(tvMazeId).episodes.push(ep);
  }

  removeEpisode(tvMazeId: number, seasonNumber: number, episodeNumber: number): void {
    const show = this.mustGet(tvMazeId);
    show.episodes = show.episodes.filter((e) => !(e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber));
  }

  private mustGet(id: number): FakeShow {
    const s = this.shows.get(id);
    if (!s) throw new MetadataError(404, 'Series not found');
    return s;
  }

  async search(term: string): Promise<SeriesLookup[]> {
    this.searchCalls++;
    if (this.failWith) throw this.failWith;
    const t = term.trim().toLowerCase();
    const m = /^(tvdb|imdb|tvmaze):(.+)$/.exec(t);
    const all = [...this.shows.values()].map((s) => s.series);
    let found: SeriesLookup[];
    if (m) {
      const v = m[2]!.trim();
      found = all.filter((s) =>
        m[1] === 'tvdb' ? String(s.tvdbId) === v : m[1] === 'imdb' ? s.imdbId === v : String(s.tvMazeId) === v,
      );
    } else {
      found = all.filter((s) => s.title.toLowerCase().includes(t));
    }
    return structuredClone(found);
  }

  async getSeries(tvMazeId: number): Promise<FakeShow> {
    if (this.failWith) throw this.failWith;
    return structuredClone(this.mustGet(tvMazeId));
  }
}
