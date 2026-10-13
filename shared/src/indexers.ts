import { z } from 'zod';
import type { QualityModel } from './series.js';

export const protocolSchema = z.enum(['usenet', 'torrent']);
export type Protocol = z.infer<typeof protocolSchema>;

const httpUrl = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be a valid http(s) URL');

const priority = z.number().int().min(1).max(50);
const tagIds = z.array(z.number().int());

// ---- Indexers ----

export const indexerImplementations = ['Newznab', 'Torznab'] as const;
export const indexerImplementationSchema = z.enum(indexerImplementations);
export type IndexerImplementation = z.infer<typeof indexerImplementationSchema>;

export const indexerSettingsSchema = z.object({
  baseUrl: httpUrl,
  apiPath: z.string().default('/api'),
  apiKey: z.string().default(''),
  /** Defaults ([5030, 5040] newznab, [5000] torznab) are applied server-side when omitted. */
  categories: z.array(z.number().int()).optional(),
  animeCategories: z.array(z.number().int()).default([]),
  minimumSeeders: z.number().int().min(0).default(1),
  seedRatio: z.number().min(0).nullable().default(null),
  seedTime: z.number().int().min(0).nullable().default(null),
});
export type IndexerSettingsInput = z.input<typeof indexerSettingsSchema>;
export interface IndexerSettings {
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  categories: number[];
  animeCategories: number[];
  minimumSeeders: number;
  seedRatio: number | null;
  seedTime: number | null;
}

export const indexerInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  implementation: indexerImplementationSchema,
  enableRss: z.boolean().default(true),
  enableAutomaticSearch: z.boolean().default(true),
  enableInteractiveSearch: z.boolean().default(true),
  priority: priority.default(25),
  tags: tagIds.default([]),
  settings: indexerSettingsSchema,
});
export type IndexerInput = z.infer<typeof indexerInputSchema>;

export interface IndexerResource {
  id: number;
  name: string;
  implementation: IndexerImplementation;
  protocol: Protocol;
  enableRss: boolean;
  enableAutomaticSearch: boolean;
  enableInteractiveSearch: boolean;
  priority: number;
  tags: number[];
  settings: IndexerSettings;
}

// ---- Download clients ----

export const downloadClientImplementations = ['SABnzbd', 'NZBGet', 'QBittorrent', 'Transmission'] as const;
export const downloadClientImplementationSchema = z.enum(downloadClientImplementations);
export type DownloadClientImplementation = z.infer<typeof downloadClientImplementationSchema>;

export const downloadClientSettingsSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  useSsl: z.boolean().default(false),
  urlBase: z.string().default(''),
  username: z.string().default(''),
  password: z.string().default(''),
  apiKey: z.string().default(''),
  category: z.string().default('tv'),
});
export type DownloadClientSettings = z.infer<typeof downloadClientSettingsSchema>;

export const downloadClientInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  implementation: downloadClientImplementationSchema,
  enable: z.boolean().default(true),
  priority: priority.default(1),
  removeCompletedDownloads: z.boolean().default(true),
  removeFailedDownloads: z.boolean().default(true),
  tags: tagIds.default([]),
  settings: downloadClientSettingsSchema,
});
export type DownloadClientInput = z.infer<typeof downloadClientInputSchema>;

export interface DownloadClientResource {
  id: number;
  name: string;
  implementation: DownloadClientImplementation;
  protocol: Protocol;
  enable: boolean;
  priority: number;
  removeCompletedDownloads: boolean;
  removeFailedDownloads: boolean;
  tags: number[];
  settings: DownloadClientSettings;
}

// ---- Releases ----

export interface Rejection {
  reason: string;
  type: 'permanent' | 'temporary';
}

export interface ReleaseResource {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  size: number;
  publishDate: string;
  /** Age in days. */
  age: number;
  ageHours: number;
  downloadUrl: string;
  infoUrl?: string;
  protocol: Protocol;
  seeders?: number;
  leechers?: number;
  quality: QualityModel;
  qualityWeight: number;
  seriesId?: number;
  seriesTitle?: string;
  episodeIds: number[];
  seasonNumber: number;
  episodeNumbers: number[];
  absoluteEpisodeNumbers: number[];
  fullSeason: boolean;
  releaseGroup?: string;
  languages: string[];
  approved: boolean;
  temporarilyRejected: boolean;
  rejected: boolean;
  rejections: string[];
  downloadAllowed: boolean;
}

// ---- Queue ----

export type QueueStatus = 'queued' | 'paused' | 'downloading' | 'completed' | 'failed' | 'warning';
export type TrackedDownloadStatus = 'ok' | 'warning' | 'error';
export type TrackedDownloadState =
  | 'downloading'
  | 'importPending'
  | 'importing'
  | 'imported'
  | 'failedPending'
  | 'failed';

export interface QueueResource {
  id: number;
  seriesId?: number;
  episodeIds: number[];
  seasonNumber?: number;
  title: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  status: QueueStatus;
  trackedDownloadStatus: TrackedDownloadStatus;
  trackedDownloadState: TrackedDownloadState;
  statusMessages: { title: string; messages: string[] }[];
  errorMessage?: string;
  downloadId: string;
  protocol: Protocol;
  downloadClient: string;
  indexer?: string;
  quality: QualityModel;
  outputPath?: string;
}

// ---- History / blocklist / tasks ----

export const historyEventTypes = [
  'grabbed',
  'downloadFolderImported',
  'downloadFailed',
  'episodeFileDeleted',
  'episodeFileRenamed',
  'downloadIgnored',
] as const;
export type HistoryEventType = (typeof historyEventTypes)[number];

export interface HistoryResource {
  id: number;
  seriesId: number;
  episodeId?: number;
  sourceTitle: string;
  quality: QualityModel;
  date: string;
  eventType: HistoryEventType;
  downloadId?: string;
  data: Record<string, string>;
}

export interface BlocklistResource {
  id: number;
  seriesId: number;
  episodeIds: number[];
  sourceTitle: string;
  quality: QualityModel;
  date: string;
  publishedDate?: string;
  size?: number;
  protocol: Protocol;
  indexer?: string;
  message?: string;
}

export interface ScheduledTaskResource {
  name: string;
  commandName: string;
  /** Minutes. */
  interval: number;
  lastExecution?: string;
  lastStartTime?: string;
  nextExecution: string;
}

export interface Paged<T> {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: 'ascending' | 'descending';
  totalRecords: number;
  records: T[];
}
