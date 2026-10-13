import type { SeriesImage, SeriesLookup, SeriesStatus, SeriesType } from '@sonarr/shared';
import { MetadataError, type MetadataProvider, type ProviderEpisode } from './types.js';

type FetchFn = typeof globalThis.fetch;

export interface TvMazeOptions {
  fetch?: FetchFn;
  baseUrl?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10_000;
const MAX_RETRIES = 3;
const DEFAULT_RETRY_MS = 2000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

interface TvMazeImage {
  original?: string;
  medium?: string;
}
interface TvMazeShow {
  id: number;
  name: string;
  type?: string;
  status?: string;
  runtime?: number | null;
  averageRuntime?: number | null;
  premiered?: string | null;
  schedule?: { time?: string; days?: string[] };
  rating?: { average?: number | null };
  network?: { name?: string } | null;
  webChannel?: { name?: string } | null;
  externals?: { thetvdb?: number | null; imdb?: string | null };
  image?: TvMazeImage | null;
  genres?: string[];
  summary?: string | null;
  _embedded?: {
    episodes?: TvMazeEpisode[];
    seasons?: { number: number | null }[];
    images?: { type?: string; resolutions?: { original?: { url?: string } } }[];
  };
}
interface TvMazeEpisode {
  id: number;
  name?: string;
  season: number;
  number: number | null;
  type?: string;
  airdate?: string | null;
  airstamp?: string | null;
  runtime?: number | null;
  summary?: string | null;
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

const cleanTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
const slugify = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function mapStatus(s: string | undefined): SeriesStatus {
  if (s === 'Ended') return 'ended';
  if (s === 'To Be Determined' || s === 'In Development') return 'upcoming';
  return 'continuing';
}

function mapType(show: TvMazeShow): SeriesType {
  if (show.type === 'Talk Show' || show.type === 'News' || show.type === 'Variety') return 'daily';
  if ((show.schedule?.days?.length ?? 0) >= 5) return 'daily';
  return 'standard';
}

function mapShow(show: TvMazeShow): SeriesLookup {
  const images: SeriesImage[] = [];
  const poster = show.image?.original ?? show.image?.medium;
  if (poster) images.push({ coverType: 'poster', url: poster, remoteUrl: poster });
  const bg = show._embedded?.images?.find((i) => i.type === 'background')?.resolutions?.original?.url;
  if (bg) images.push({ coverType: 'fanart', url: bg, remoteUrl: bg });
  const year = show.premiered ? Number(show.premiered.slice(0, 4)) || 0 : 0;
  const seasonNumbers = new Set<number>();
  for (const s of show._embedded?.seasons ?? []) if (s.number != null) seasonNumbers.add(s.number);
  for (const e of show._embedded?.episodes ?? []) seasonNumbers.add(e.number == null ? 0 : e.season);
  const seasons = [...seasonNumbers]
    .sort((a, b) => a - b)
    .map((seasonNumber) => ({ seasonNumber, monitored: seasonNumber > 0 }));
  return {
    title: show.name,
    sortTitle: show.name.toLowerCase().replace(/^(the|an|a)\s+/, ''),
    status: mapStatus(show.status),
    overview: stripHtml(show.summary),
    network: show.network?.name ?? show.webChannel?.name ?? null,
    airTime: show.schedule?.time || null,
    images,
    seasons,
    year,
    path: '',
    qualityProfileId: 0,
    seasonFolder: true,
    monitored: true,
    monitorNewItems: 'all',
    runtime: show.runtime ?? show.averageRuntime ?? 0,
    tvdbId: show.externals?.thetvdb ?? 0,
    tvMazeId: show.id,
    imdbId: show.externals?.imdb ?? null,
    firstAired: show.premiered ?? null,
    seriesType: mapType(show),
    cleanTitle: cleanTitle(show.name),
    titleSlug: slugify(show.name),
    rootFolderPath: '',
    certification: null,
    genres: show.genres ?? [],
    tags: [],
    added: '0001-01-01T00:00:00Z',
    ratings: { votes: 0, value: show.rating?.average ?? 0 },
    remotePoster: poster,
  };
}

function mapEpisodes(raw: TvMazeEpisode[], showRuntime: number): ProviderEpisode[] {
  const regularSorted = raw
    .filter((e) => e.number != null && e.season > 0)
    .sort((a, b) => (a.airstamp ?? '').localeCompare(b.airstamp ?? '') || a.season - b.season || a.number! - b.number!);
  const absolute = new Map<number, number>();
  regularSorted.forEach((e, i) => absolute.set(e.id, i + 1));
  let specialIndex = 0;
  const out: ProviderEpisode[] = [];
  for (const e of raw) {
    const special = e.number == null || e.season === 0;
    const ep: ProviderEpisode = {
      tvMazeId: e.id,
      seasonNumber: special ? 0 : e.season,
      episodeNumber: special ? ++specialIndex : e.number!,
      title: e.name ?? '',
      overview: stripHtml(e.summary),
      runtime: e.runtime ?? showRuntime,
    };
    if (!special && absolute.has(e.id)) ep.absoluteEpisodeNumber = absolute.get(e.id);
    if (e.airdate) ep.airDate = e.airdate;
    if (e.airstamp) ep.airDateUtc = e.airstamp;
    out.push(ep);
  }
  return out;
}

export class TvMazeProvider implements MetadataProvider {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly stamps: number[] = [];
  private bucketChain: Promise<void> = Promise.resolve();
  private readonly cache = new Map<string, { at: number; value: SeriesLookup[] }>();

  constructor(opts: TvMazeOptions = {}) {
    this.fetchFn = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.baseUrl = (opts.baseUrl ?? 'https://api.tvmaze.com').replace(/\/+$/, '');
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Waits for a token: at most RATE_LIMIT requests per RATE_WINDOW_MS. Serialised so waiters keep order. */
  private acquire(): Promise<void> {
    const next = this.bucketChain.then(async () => {
      for (;;) {
        const t = this.now();
        while (this.stamps.length && t - this.stamps[0]! >= RATE_WINDOW_MS) this.stamps.shift();
        if (this.stamps.length < RATE_LIMIT) {
          this.stamps.push(t);
          return;
        }
        await this.sleep(Math.max(1, RATE_WINDOW_MS - (t - this.stamps[0]!)));
      }
    });
    this.bucketChain = next.catch(() => {});
    return next;
  }

  private async request<T>(path: string, notFoundEmpty?: T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.acquire();
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}${path}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new MetadataError(503, 'Unable to reach TVmaze');
      }
      if (res.status === 404) {
        if (notFoundEmpty !== undefined) return notFoundEmpty;
        throw new MetadataError(404, 'Series not found');
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new MetadataError(503, `TVmaze error (${res.status})`);
        const ra = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : DEFAULT_RETRY_MS);
        continue;
      }
      if (!res.ok) throw new MetadataError(502, `Unexpected TVmaze response (${res.status})`);
      try {
        return (await res.json()) as T;
      } catch {
        throw new MetadataError(502, 'Invalid response from TVmaze');
      }
    }
  }

  async search(termRaw: string): Promise<SeriesLookup[]> {
    const term = termRaw.trim();
    const key = term.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return structuredClone(hit.value);
    const result = await this.doSearch(term);
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), value: result });
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return structuredClone(result);
  }

  private async doSearch(term: string): Promise<SeriesLookup[]> {
    const m = /^(tvdb|imdb|tvmaze):\s*(.+)$/i.exec(term);
    if (m) {
      const kind = m[1]!.toLowerCase();
      const value = m[2]!.trim();
      if (kind === 'tvmaze') {
        if (!/^\d+$/.test(value)) return [];
        const show = await this.request<TvMazeShow | null>(`/shows/${value}`, null);
        return show ? [mapShow(show)] : [];
      }
      const qs = kind === 'tvdb' ? `thetvdb=${encodeURIComponent(value)}` : `imdb=${encodeURIComponent(value)}`;
      const show = await this.request<TvMazeShow | null>(`/lookup/shows?${qs}`, null);
      return show ? [mapShow(show)] : [];
    }
    const rows = await this.request<{ show: TvMazeShow }[]>(`/search/shows?q=${encodeURIComponent(term)}`);
    return rows.map((r) => mapShow(r.show));
  }

  async getSeries(tvMazeId: number): Promise<{ series: SeriesLookup; episodes: ProviderEpisode[] }> {
    const show = await this.request<TvMazeShow>(`/shows/${tvMazeId}?embed[]=episodes&embed[]=seasons`);
    // The embedded list omits specials; fetch the full list including them.
    const raw = await this.request<TvMazeEpisode[]>(`/shows/${tvMazeId}/episodes?specials=1`);
    show._embedded = { ...show._embedded, episodes: raw };
    const series = mapShow(show);
    return { series, episodes: mapEpisodes(raw, series.runtime) };
  }
}
