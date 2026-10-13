import type { QualityModel, Rejection } from '@sonarr/shared';
import type { EpisodeRow, SeriesRow } from '../decision/types.js';

export type { EpisodeRow, Rejection, SeriesRow };

/** Rejection reasons of the import specifications, in evaluation order. */
export const IMPORT_REJECTIONS = {
  notVideo: 'Not a video file',
  sample: 'Sample',
  unparseable: 'Unable to parse file',
  unknownSeries: 'Unknown Series',
  episodesNotFound: 'Episode(s) not found',
  notUpgrade: 'Not an upgrade for existing episode file(s)',
  freeSpace: 'Not enough free space',
  alreadyImported: 'Episode file already imported',
  locked: 'Locked file, try again later',
} as const;

/** 'hardlink' falls back to a copy when the destination is on another device or links are not permitted. */
export type TransferMode = 'move' | 'copy' | 'hardlink';

export interface ImportDecision {
  source: { path: string; size: number };
  series?: SeriesRow;
  /** Sorted by season and episode number. */
  episodes: EpisodeRow[];
  quality: QualityModel;
  releaseGroup?: string;
  /** Release title of the download the file came from, used as the history source title and {Original Title}. */
  sceneName?: string;
  downloadId?: string;
  rejections: Rejection[];
  approved: boolean;
}

export interface ImportResult {
  decision: ImportDecision;
  result: 'imported' | 'rejected' | 'failed';
  message: string;
  importedPath?: string;
}

export interface ImportOptions {
  mode: TransferMode;
  downloadId?: string;
  /** Download client name, recorded in history. */
  downloadClient?: string;
}
