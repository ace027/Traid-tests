import { z } from 'zod';
import { QUALITIES } from './qualities.js';

export const monitorOptions = ['all', 'future', 'missing', 'existing', 'pilot', 'firstSeason', 'lastSeason', 'none'] as const;
export const monitorOptionSchema = z.enum(monitorOptions);
export type MonitorOption = z.infer<typeof monitorOptionSchema>;

export const seriesStatusSchema = z.enum(['continuing', 'ended', 'upcoming', 'deleted']);
export type SeriesStatus = z.infer<typeof seriesStatusSchema>;
export const seriesTypeSchema = z.enum(['standard', 'daily', 'anime']);
export type SeriesType = z.infer<typeof seriesTypeSchema>;
export const monitorNewItemsSchema = z.enum(['all', 'none']);
export type MonitorNewItems = z.infer<typeof monitorNewItemsSchema>;

export const seriesImageSchema = z.object({
  coverType: z.enum(['poster', 'fanart', 'banner']),
  url: z.string(),
  remoteUrl: z.string(),
});
export type SeriesImage = z.infer<typeof seriesImageSchema>;

export const seasonStatisticsSchema = z.object({
  nextAiring: z.string().optional(),
  previousAiring: z.string().optional(),
  episodeFileCount: z.number(),
  episodeCount: z.number(),
  totalEpisodeCount: z.number(),
  sizeOnDisk: z.number(),
  percentOfEpisodes: z.number(),
});
export type SeasonStatistics = z.infer<typeof seasonStatisticsSchema>;

export const seriesStatisticsSchema = seasonStatisticsSchema.extend({
  seasonCount: z.number(),
});
export type SeriesStatistics = z.infer<typeof seriesStatisticsSchema>;

export const seasonSchema = z.object({
  seasonNumber: z.number().int(),
  monitored: z.boolean(),
  statistics: seasonStatisticsSchema.optional(),
});
export type Season = z.infer<typeof seasonSchema>;

export const seriesRatingsSchema = z.object({ votes: z.number(), value: z.number() });

export const seriesSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  sortTitle: z.string(),
  status: seriesStatusSchema,
  overview: z.string(),
  network: z.string().nullable().optional(),
  airTime: z.string().nullable().optional(),
  images: z.array(seriesImageSchema),
  seasons: z.array(seasonSchema),
  year: z.number().int(),
  path: z.string(),
  qualityProfileId: z.number().int(),
  seasonFolder: z.boolean(),
  monitored: z.boolean(),
  monitorNewItems: monitorNewItemsSchema,
  runtime: z.number().int(),
  tvdbId: z.number().int(),
  tvMazeId: z.number().int(),
  imdbId: z.string().nullable().optional(),
  firstAired: z.string().nullable().optional(),
  seriesType: seriesTypeSchema,
  cleanTitle: z.string(),
  titleSlug: z.string(),
  rootFolderPath: z.string(),
  certification: z.string().nullable().optional(),
  genres: z.array(z.string()),
  tags: z.array(z.number().int()),
  added: z.string(),
  ratings: seriesRatingsSchema,
  statistics: seriesStatisticsSchema.optional(),
  addOptions: z.unknown().optional(),
});
export type Series = z.infer<typeof seriesSchema>;

export type SeriesLookup = Omit<Series, 'id'> & { remotePoster?: string };

export const addSeriesInputSchema = z
  .object({
    tvMazeId: z.number().int().positive(),
    tvdbId: z.number().int().positive().nullish(),
    title: z.string().trim().min(1).optional(),
    qualityProfileId: z.number().int().positive(),
    rootFolderPath: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    seriesType: seriesTypeSchema.default('standard'),
    seasonFolder: z.boolean().default(true),
    monitored: z.boolean().default(true),
    monitorNewItems: monitorNewItemsSchema.default('all'),
    tags: z.array(z.number().int()).default([]),
    addOptions: z
      .object({
        monitor: monitorOptionSchema.default('all'),
        searchForMissingEpisodes: z.boolean().default(false),
        searchForCutoffUnmetEpisodes: z.boolean().default(false),
      })
      .default({ monitor: 'all', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false }),
  })
  .superRefine((v, ctx) => {
    if (!v.rootFolderPath && !v.path) {
      ctx.addIssue({ code: 'custom', path: ['rootFolderPath'], message: 'Root folder or path is required' });
    }
  });
export type AddSeriesInput = z.infer<typeof addSeriesInputSchema>;

export const updateSeriesInputSchema = z.object({
  monitored: z.boolean().optional(),
  monitorNewItems: monitorNewItemsSchema.optional(),
  qualityProfileId: z.number().int().positive().optional(),
  seriesType: seriesTypeSchema.optional(),
  seasonFolder: z.boolean().optional(),
  path: z.string().min(1).optional(),
  tags: z.array(z.number().int()).optional(),
  seasons: z.array(z.object({ seasonNumber: z.number().int(), monitored: z.boolean() })).optional(),
});
export type UpdateSeriesInput = z.infer<typeof updateSeriesInputSchema>;

export interface Episode {
  id: number;
  seriesId: number;
  tvMazeId: number;
  /** 0 when the episode has no file. */
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  title: string;
  airDate?: string;
  airDateUtc?: string;
  overview: string;
  runtime: number;
  hasFile: boolean;
  monitored: boolean;
}

export interface QualityRevision {
  version: number;
  real: number;
  isRepack: boolean;
}

export interface QualityModel {
  quality: (typeof QUALITIES)[number];
  revision: QualityRevision;
}

export interface EpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  releaseGroup?: string;
  quality: QualityModel;
}
