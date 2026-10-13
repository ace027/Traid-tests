import { z } from 'zod';

// ---- Notifications ----

export const notificationImplementations = ['Webhook', 'Discord', 'Email'] as const;
export const notificationImplementationSchema = z.enum(notificationImplementations);
export type NotificationImplementation = z.infer<typeof notificationImplementationSchema>;

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

const emailAddress = z
  .string()
  .trim()
  .regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, 'Must be a valid email address');

export const webhookSettingsSchema = z.object({
  url: httpUrl,
  method: z.enum(['POST', 'PUT']).default('POST'),
  username: z.string().default(''),
  password: z.string().default(''),
});
export type WebhookSettings = z.infer<typeof webhookSettingsSchema>;

export const discordSettingsSchema = z.object({
  webHookUrl: httpUrl,
  username: z.string().default(''),
  avatar: z.string().default(''),
});
export type DiscordSettings = z.infer<typeof discordSettingsSchema>;

export const emailSettingsSchema = z.object({
  server: z.string().trim().min(1, 'Server is required'),
  port: z.number().int().min(1).max(65535).default(587),
  useEncryption: z.enum(['always', 'preferred', 'never']).default('preferred'),
  username: z.string().default(''),
  password: z.string().default(''),
  from: emailAddress,
  to: z.array(emailAddress).min(1, 'At least one recipient is required'),
  cc: z.array(emailAddress).default([]),
  bcc: z.array(emailAddress).default([]),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export type NotificationSettings = WebhookSettings | DiscordSettings | EmailSettings;

export const NOTIFICATION_EVENT_FLAGS = [
  'onGrab',
  'onDownload',
  'onUpgrade',
  'onRename',
  'onSeriesAdd',
  'onSeriesDelete',
  'onEpisodeFileDelete',
  'onEpisodeFileDeleteForUpgrade',
  'onHealthIssue',
  'onHealthRestored',
] as const;
export type NotificationEventFlag = (typeof NOTIFICATION_EVENT_FLAGS)[number];

const flag = z.boolean().default(false);
const notificationBase = {
  name: z.string().trim().min(1).max(100),
  onGrab: flag,
  onDownload: flag,
  onUpgrade: flag,
  onRename: flag,
  onSeriesAdd: flag,
  onSeriesDelete: flag,
  onEpisodeFileDelete: flag,
  onEpisodeFileDeleteForUpgrade: flag,
  onHealthIssue: flag,
  onHealthRestored: flag,
  includeHealthWarnings: flag,
  tags: z.array(z.number().int()).default([]),
};

export const notificationInputSchema = z.discriminatedUnion('implementation', [
  z.object({ ...notificationBase, implementation: z.literal('Webhook'), settings: webhookSettingsSchema }),
  z.object({ ...notificationBase, implementation: z.literal('Discord'), settings: discordSettingsSchema }),
  z.object({ ...notificationBase, implementation: z.literal('Email'), settings: emailSettingsSchema }),
]);
export type NotificationInput = z.infer<typeof notificationInputSchema>;

export interface NotificationResource {
  id: number;
  name: string;
  implementation: NotificationImplementation;
  onGrab: boolean;
  onDownload: boolean;
  onUpgrade: boolean;
  onRename: boolean;
  onSeriesAdd: boolean;
  onSeriesDelete: boolean;
  onEpisodeFileDelete: boolean;
  onEpisodeFileDeleteForUpgrade: boolean;
  onHealthIssue: boolean;
  onHealthRestored: boolean;
  includeHealthWarnings: boolean;
  tags: number[];
  /** Secrets are masked as '********' in responses. */
  settings: Record<string, unknown>;
}

// ---- Health and disk space ----

export type HealthType = 'ok' | 'notice' | 'warning' | 'error';

export interface HealthResource {
  source: string;
  type: HealthType;
  message: string;
  wikiUrl?: string;
}

export interface DiskSpaceResource {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

// ---- Logs ----

export const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof logLevels)[number];

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  logger: string;
  message: string;
  exception?: string;
}

export interface LogFileResource {
  filename: string;
  lastWriteTime: string;
  size: number;
}

// ---- Backups and updates ----

export type BackupType = 'manual' | 'scheduled' | 'update';

export interface BackupResource {
  id: number;
  name: string;
  /** Relative download path: the backup folder ('manual' | 'scheduled' | 'update') plus the name. */
  path: string;
  type: BackupType;
  size: number;
  time: string;
}

export interface UpdateResource {
  version: string;
  branch: string;
  releaseDate: string;
  fileName: string;
  url: string;
  installed: boolean;
  installable: boolean;
  latest: boolean;
  changes: { new: string[]; fixed: string[] };
}
