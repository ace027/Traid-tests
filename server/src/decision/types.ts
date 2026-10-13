import type { Rejection } from '@sonarr/shared';
import type { schema } from '../db/index.js';
import type { ReleaseInfo } from '../indexers/types.js';
import type { ParsedEpisodeInfo } from '../parser/index.js';

export type { Rejection };

export type SeriesRow = typeof schema.series.$inferSelect;
export type EpisodeRow = typeof schema.episodes.$inferSelect;
export type EpisodeFileRow = typeof schema.episodeFiles.$inferSelect;

export interface RemoteEpisode {
  release: ReleaseInfo;
  /** null when the release title could not be parsed. */
  parsed: ParsedEpisodeInfo | null;
  series?: SeriesRow;
  episodes: EpisodeRow[];
}

export interface DownloadDecision {
  remoteEpisode: RemoteEpisode;
  rejections: Rejection[];
  approved: boolean;
  /** Rejected, but only for temporary reasons (queue, recently grabbed). */
  temporarilyRejected: boolean;
}

/**
 * What a search asked for. `seasonNumber` is set for season searches (any episode of that season is
 * requested); otherwise a release is requested when it contains at least one of `episodes`.
 */
export interface SearchCriteria {
  series: SeriesRow;
  episodes: EpisodeRow[];
  seasonNumber?: number;
}

export interface SearchContext {
  /** Absent for RSS sync. */
  searchCriteria?: SearchCriteria;
  interactive: boolean;
  now: Date;
}

export function rejection(reason: string, type: Rejection['type'] = 'permanent'): Rejection {
  return { reason, type };
}
