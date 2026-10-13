import { z } from 'zod';
import type { Episode, EpisodeFile, QualityModel, Series } from './series.js';

export const downloadPropersAndRepacksOptions = ['preferAndUpgrade', 'doNotUpgrade', 'doNotPrefer'] as const;
export const fileDateOptions = ['none', 'localAirDate', 'utcAirDate'] as const;

export const mediaManagementConfigSchema = z.object({
  autoUnmonitorPreviouslyDownloadedEpisodes: z.boolean().default(false),
  recycleBin: z
    .string()
    .default('')
    .refine((v) => v === '' || v.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('\\\\'), {
      message: 'Recycle bin must be an absolute path',
    }),
  recycleBinCleanupDays: z.number().int().min(0).max(365).default(7),
  downloadPropersAndRepacks: z.enum(downloadPropersAndRepacksOptions).default('preferAndUpgrade'),
  createEmptySeriesFolders: z.boolean().default(false),
  deleteEmptyFolders: z.boolean().default(false),
  fileDate: z.enum(fileDateOptions).default('none'),
  skipFreeSpaceCheckWhenImporting: z.boolean().default(false),
  minimumFreeSpaceWhenImporting: z.number().int().min(0).max(100000).default(100),
  copyUsingHardlinks: z.boolean().default(true),
  importExtraFiles: z.boolean().default(false),
  extraFileExtensions: z.string().default('srt,nfo'),
  setPermissionsLinux: z.boolean().default(false),
  chmodFolder: z.string().regex(/^[0-7]{3,4}$/, 'Folder permissions must be an octal mode such as 755').default('755'),
});
export type MediaManagementConfig = z.infer<typeof mediaManagementConfigSchema>;

export const colonReplacementFormats = ['delete', 'dash', 'spaceDash', 'spaceDashSpace', 'smart'] as const;
export const multiEpisodeStyles = ['extend', 'duplicate', 'repeat', 'scene', 'range', 'prefixedRange'] as const;

const format = (def: string) => z.string().min(1, 'Format is required').max(500, 'Format is too long').default(def);

export const namingConfigSchema = z.object({
  renameEpisodes: z.boolean().default(true),
  replaceIllegalCharacters: z.boolean().default(true),
  colonReplacementFormat: z.enum(colonReplacementFormats).default('smart'),
  multiEpisodeStyle: z.enum(multiEpisodeStyles).default('prefixedRange'),
  standardEpisodeFormat: format('{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}'),
  dailyEpisodeFormat: format('{Series Title} - {Air-Date} - {Episode Title} {Quality Full}'),
  animeEpisodeFormat: format('{Series Title} - S{season:00}E{episode:00} - {absolute:000} - {Episode Title} {Quality Full}'),
  seriesFolderFormat: format('{Series TitleYear}'),
  seasonFolderFormat: format('Season {season:00}'),
  specialsFolderFormat: format('Specials'),
});
export type NamingConfig = z.infer<typeof namingConfigSchema>;

export const downloadClientConfigSchema = z.object({
  enableCompletedDownloadHandling: z.boolean().default(true),
  autoRedownloadFailed: z.boolean().default(true),
});
export type DownloadClientConfig = z.infer<typeof downloadClientConfigSchema>;

export interface NamingExamples {
  singleEpisodeExample: string;
  multiEpisodeExample: string;
  dailyEpisodeExample: string;
  animeEpisodeExample: string;
  seriesFolderExample: string;
  seasonFolderExample: string;
  specialsFolderExample: string;
}

export interface NamingValidation {
  valid: boolean;
  errors: { propertyName: string; errorMessage: string }[];
}

export type WantedRecord = Episode & { series: Series };
export type CalendarEpisode = Episode & { series: Series; episodeFile?: EpisodeFile };

export interface ManualImportItem {
  /** Index in the listing. */
  id: number;
  path: string;
  relativePath: string;
  folderName: string;
  name: string;
  size: number;
  series?: { id: number; title: string };
  seasonNumber?: number;
  episodes: { id: number; seasonNumber: number; episodeNumber: number; title: string }[];
  quality: QualityModel;
  releaseGroup?: string;
  downloadId?: string;
  rejections: { reason: string; type: string }[];
}

export interface ManualImportFile {
  path: string;
  seriesId: number;
  episodeIds: number[];
  quality: QualityModel;
  releaseGroup?: string;
  downloadId?: string;
}

export interface RenamePreview {
  seriesId: number;
  seasonNumber: number;
  episodeNumbers: number[];
  episodeFileId: number;
  existingPath: string;
  newPath: string;
}
