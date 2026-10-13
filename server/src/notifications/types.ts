import type { SendMailOptions } from './smtp.js';

export const NOTIFICATION_EVENTS = [
  'Grab',
  'Download',
  'Rename',
  'EpisodeFileDelete',
  'SeriesAdd',
  'SeriesDelete',
  'Health',
  'HealthRestored',
  'Test',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface MessageSeries {
  id: number;
  title: string;
  path: string;
  tvdbId: number;
  tvMazeId: number;
  type: string;
  /** Remote poster URL, when known. */
  posterUrl?: string;
}

export interface MessageEpisode {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  airDate?: string;
}

export interface MessageRelease {
  quality: string;
  releaseTitle: string;
  indexer?: string;
  size?: number;
  releaseGroup?: string;
}

export interface MessageEpisodeFile {
  relativePath: string;
  path: string;
  quality: string;
  size?: number;
}

export interface MessageHealth {
  level: 'warning' | 'error';
  message: string;
  type: string;
  wikiUrl?: string;
}

/** Everything a provider may need to describe one event. */
export interface NotificationMessage {
  eventType: NotificationEvent;
  series?: MessageSeries;
  episodes?: MessageEpisode[];
  release?: MessageRelease;
  episodeFile?: MessageEpisodeFile;
  isUpgrade?: boolean;
  downloadClient?: string;
  downloadId?: string;
  health?: MessageHealth;
  /** EpisodeFileDelete: why the file went away ('upgrade' for replaced files). */
  deleteReason?: string;
}

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<void>;
  test(): Promise<void>;
}

export type FetchFn = typeof fetch;
export type SendMailFn = (options: SendMailOptions) => Promise<void>;

export interface ProviderContext {
  instanceName: string;
  applicationUrl: string;
}

/** Injectable I/O for providers (tests replace them). */
export interface ProviderDeps {
  fetch?: FetchFn;
  sendMail?: SendMailFn;
  /** Request timeout in milliseconds (default 10 s). */
  timeoutMs?: number;
  /** Delay used before the single retry; injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Provider failure; the message never contains URLs, credentials or tokens. */
export class NotificationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}
