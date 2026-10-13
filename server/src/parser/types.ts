import type { Quality } from '@sonarr/shared';

export interface QualityRevision {
  /** 1 = original release, 2+ = PROPER/REPACK/vN. */
  version: number;
  /** Number of REAL tags. */
  real: number;
  isRepack: boolean;
}

export interface QualityModel {
  quality: Quality;
  revision: QualityRevision;
}

export interface ParsedEpisodeInfo {
  seriesTitle: string;
  /** Lowercase letters/digits only, leading "the " dropped. */
  cleanSeriesTitle: string;
  /** Year parsed from a parenthesised "(YYYY)" suffix of the title, if any. */
  year?: number;
  /** 0 for daily and absolute-numbered releases, and for specials. */
  seasonNumber: number;
  episodeNumbers: number[];
  absoluteEpisodeNumbers: number[];
  /** YYYY-MM-DD */
  airDate?: string;
  fullSeason: boolean;
  isDaily: boolean;
  isAbsoluteNumbering: boolean;
  isMultiSeason: boolean;
  special: boolean;
  quality: QualityModel;
  releaseGroup?: string;
  releaseTitle: string;
  languages: string[];
}
