import type { IndexerSettings, Protocol } from '@sonarr/shared';
import type { schema } from '../db/index.js';

export type IndexerRow = typeof schema.indexers.$inferSelect;

export interface ReleaseInfo {
  guid: string;
  title: string;
  size: number;
  /** ISO 8601. */
  publishDate: string;
  downloadUrl: string;
  infoUrl?: string;
  indexerId: number;
  indexer: string;
  indexerPriority: number;
  protocol: Protocol;
  seeders?: number;
  leechers?: number;
  tvdbId?: number;
  tvMazeId?: number;
  imdbId?: string;
  categories: number[];
  infoHash?: string;
  magnetUrl?: string;
}

export interface SearchSeries {
  title: string;
  tvdbId?: number | null;
  tvMazeId?: number | null;
  imdbId?: string | null;
  cleanTitle: string;
}

export type SearchCriteria =
  | { type: 'episode'; series: SearchSeries; seasonNumber: number; episodeNumbers: number[] }
  | { type: 'season'; series: SearchSeries; seasonNumber: number }
  | { type: 'daily'; series: SearchSeries; airDate: string }
  | { type: 'anime'; series: SearchSeries; absoluteEpisodeNumbers: number[] };

export interface IndexerClient {
  test(): Promise<void>;
  fetchRss(): Promise<ReleaseInfo[]>;
  search(criteria: SearchCriteria): Promise<ReleaseInfo[]>;
}

export class IndexerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'IndexerError';
  }
}

export function redactSecret(text: string, secret: string | undefined): string {
  let out = text;
  if (secret) out = out.split(secret).join('********');
  return out.replace(/apikey=[^&\s"']*/gi, 'apikey=********');
}

export function defaultCategories(implementation: string): number[] {
  return implementation.toLowerCase() === 'torznab' ? [5000] : [5030, 5040];
}

export function protocolFor(implementation: string): Protocol {
  return implementation.toLowerCase() === 'torznab' ? 'torrent' : 'usenet';
}

/** Parses stored settings JSON and fills defaults. */
export function parseIndexerSettings(row: Pick<IndexerRow, 'implementation' | 'settings'>): IndexerSettings {
  let raw: Partial<IndexerSettings> = {};
  try {
    raw = JSON.parse(row.settings) as Partial<IndexerSettings>;
  } catch {
    raw = {};
  }
  return {
    baseUrl: raw.baseUrl ?? '',
    apiPath: raw.apiPath ?? '/api',
    apiKey: raw.apiKey ?? '',
    categories: raw.categories ?? defaultCategories(row.implementation),
    animeCategories: raw.animeCategories ?? [],
    minimumSeeders: raw.minimumSeeders ?? 1,
    seedRatio: raw.seedRatio ?? null,
    seedTime: raw.seedTime ?? null,
  };
}
