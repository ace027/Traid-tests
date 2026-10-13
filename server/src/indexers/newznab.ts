import { MAX_XML_BYTES, readCaps, readError, readRssItems, type RawItem } from './xml.js';
import {
  IndexerError,
  parseIndexerSettings,
  protocolFor,
  redactSecret,
  type IndexerClient,
  type IndexerRow,
  type ReleaseInfo,
  type SearchCriteria,
} from './types.js';

export interface NewznabDeps {
  fetch: typeof fetch;
  now: () => Date;
}

const TIMEOUT_MS = 30_000;
const LIMIT = 100;

const cleanQuery = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pad2 = (n: string | number) => String(n).padStart(2, '0');

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function positive(v: string | undefined): number | undefined {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
}

export function createNewznabClient(row: IndexerRow, deps: NewznabDeps): IndexerClient {
  const settings = parseIndexerSettings(row);
  const protocol = protocolFor(row.implementation);
  const torrent = protocol === 'torrent';

  const redact = (text: string) => redactSecret(text, settings.apiKey);

  function buildUrl(t: string, cats: number[], extra: Record<string, string> = {}, forCaps = false): string {
    const base = settings.baseUrl.replace(/\/+$/, '');
    const apiPath = settings.apiPath ? (settings.apiPath.startsWith('/') ? settings.apiPath : '/' + settings.apiPath) : '';
    const params = new URLSearchParams();
    params.set('t', t);
    if (settings.apiKey) params.set('apikey', settings.apiKey);
    if (!forCaps) {
      if (cats.length) params.set('cat', cats.join(','));
      params.set('extended', '1');
      params.set('limit', String(LIMIT));
    }
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return `${base}${apiPath}?${params.toString()}`;
  }

  async function get(url: string): Promise<string> {
    let res: Response;
    try {
      res = await deps.fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/xml, text/xml, application/rss+xml, */*' },
      });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new IndexerError(`Indexer request timed out after ${TIMEOUT_MS / 1000}s`);
      }
      throw new IndexerError(redact(`Unable to connect to indexer: ${err.message ?? String(e)}`));
    }
    if (res.status === 401 || res.status === 403) throw new IndexerError('Invalid API key', res.status);
    if (res.status === 429) {
      const retry = res.headers.get('retry-after');
      throw new IndexerError(
        `Indexer rate limit reached (HTTP 429)${retry ? `, retry after ${retry}s` : ', try again later'}`,
        429,
      );
    }
    if (!res.ok) throw new IndexerError(`Indexer returned HTTP ${res.status}`, res.status);
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      throw new IndexerError(redact(`Failed to read indexer response: ${(e as Error).message}`));
    }
    if (text.length > MAX_XML_BYTES) throw new IndexerError('Indexer response is too large');
    const head = text.slice(0, 2048).toLowerCase();
    if (!(head.includes('<rss') || head.includes('<caps') || head.includes('<error'))) {
      throw new IndexerError('Indexer returned an invalid response (expected XML, got HTML or text)');
    }
    const err = readError(text);
    if (err) {
      if (err.code >= 100 && err.code <= 102) throw new IndexerError('Invalid API key');
      throw new IndexerError(redact(`${err.description || 'Indexer error'} (code ${err.code})`));
    }
    return text;
  }

  function toRelease(item: RawItem): ReleaseInfo | null {
    const a = (name: string) => item.attrs[name]?.[0];
    const magnetAttr = a('magneturl');
    const link = item.link;
    let downloadUrl = item.enclosure?.url || link || '';
    let magnetUrl = magnetAttr || (link.startsWith('magnet:') ? link : undefined);
    if (!magnetUrl && downloadUrl.startsWith('magnet:')) magnetUrl = downloadUrl;
    if (!downloadUrl && magnetUrl) downloadUrl = magnetUrl;
    if (!item.title || !downloadUrl) return null;

    const size = positive(item.enclosure?.length) ?? positive(a('size')) ?? positive(item.size) ?? 0;
    let publishDate = '';
    for (const candidate of [item.pubDate, a('usenetdate') ?? '']) {
      const ms = candidate ? Date.parse(candidate) : NaN;
      if (Number.isFinite(ms)) {
        publishDate = new Date(ms).toISOString();
        break;
      }
    }
    if (!publishDate) publishDate = deps.now().toISOString();

    const categories: number[] = [];
    for (const c of item.attrs.category ?? []) {
      const n = Number(c);
      if (Number.isInteger(n) && !categories.includes(n)) categories.push(n);
    }

    const release: ReleaseInfo = {
      guid: item.guid || link || downloadUrl,
      title: item.title,
      size,
      publishDate,
      downloadUrl,
      indexerId: row.id,
      indexer: row.name,
      indexerPriority: row.priority,
      protocol,
      categories,
    };
    if (item.comments) release.infoUrl = item.comments;
    const tvdb = positive(a('tvdbid'));
    if (tvdb !== undefined) release.tvdbId = tvdb;
    const tvmaze = positive(a('tvmazeid'));
    if (tvmaze !== undefined) release.tvMazeId = tvmaze;
    const imdb = a('imdb') ?? a('imdbid');
    if (imdb && Number(imdb) !== 0) release.imdbId = imdb;
    if (torrent) {
      const seeders = num(a('seeders'));
      const peers = num(a('peers'));
      const leechers = num(a('leechers'));
      if (seeders !== undefined) release.seeders = seeders;
      if (leechers !== undefined) release.leechers = leechers;
      else if (peers !== undefined) release.leechers = Math.max(0, peers - (seeders ?? 0));
      const hash = a('infohash') ?? (magnetUrl ? /xt=urn:btih:([A-Za-z0-9]+)/.exec(magnetUrl)?.[1] : undefined);
      if (hash) release.infoHash = hash.toLowerCase();
      if (magnetUrl) release.magnetUrl = magnetUrl;
    }
    return release;
  }

  function parse(xml: string): ReleaseInfo[] {
    const out: ReleaseInfo[] = [];
    for (const item of readRssItems(xml)) {
      const r = toRelease(item);
      if (r) out.push(r);
    }
    return out;
  }

  function seriesParams(c: Exclude<SearchCriteria, { type: 'anime' }>): Record<string, string> {
    const p: Record<string, string> = {};
    if (c.series.tvdbId) p.tvdbid = String(c.series.tvdbId);
    else p.q = cleanQuery(c.series.title);
    return p;
  }

  return {
    async test() {
      const xml = await get(buildUrl('caps', [], {}, true));
      const caps = readCaps(xml);
      if (!caps.tvSearchAvailable) throw new IndexerError('Indexer does not support TV search (tv-search unavailable)');
    },

    async fetchRss() {
      return parse(await get(buildUrl('tvsearch', settings.categories)));
    },

    async search(criteria) {
      switch (criteria.type) {
        case 'episode': {
          const extra = { ...seriesParams(criteria), season: String(criteria.seasonNumber) };
          if (criteria.episodeNumbers.length === 1) Object.assign(extra, { ep: String(criteria.episodeNumbers[0]) });
          return parse(await get(buildUrl('tvsearch', settings.categories, extra)));
        }
        case 'season': {
          const extra = { ...seriesParams(criteria), season: String(criteria.seasonNumber) };
          return parse(await get(buildUrl('tvsearch', settings.categories, extra)));
        }
        case 'daily': {
          const [y, m, d] = criteria.airDate.split('-');
          const extra = { ...seriesParams(criteria), season: y ?? '', ep: `${pad2(m ?? '')}/${pad2(d ?? '')}` };
          return parse(await get(buildUrl('tvsearch', settings.categories, extra)));
        }
        case 'anime': {
          const title = cleanQuery(criteria.series.title);
          const queries = criteria.absoluteEpisodeNumbers.length
            ? criteria.absoluteEpisodeNumbers.map((n) => `${title} ${n}`)
            : [title];
          const seen = new Set<string>();
          const out: ReleaseInfo[] = [];
          for (const q of queries) {
            for (const r of parse(await get(buildUrl('search', settings.animeCategories, { q })))) {
              if (!seen.has(r.guid)) {
                seen.add(r.guid);
                out.push(r);
              }
            }
          }
          return out;
        }
      }
    },
  };
}
