import type { SeriesLookup } from '@sonarr/shared';

export interface ProviderEpisode {
  tvMazeId: number;
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  title: string;
  overview: string;
  airDate?: string;
  airDateUtc?: string;
  runtime: number;
}

export interface MetadataProvider {
  search(term: string): Promise<SeriesLookup[]>;
  getSeries(tvMazeId: number): Promise<{ series: SeriesLookup; episodes: ProviderEpisode[] }>;
}

export class MetadataError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MetadataError';
  }
}
