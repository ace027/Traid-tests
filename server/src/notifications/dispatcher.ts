import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  discordSettingsSchema,
  emailSettingsSchema,
  webhookSettingsSchema,
  type DiscordSettings,
  type EmailSettings,
  type HealthResource,
  type WebhookSettings,
} from '@sonarr/shared';
import { schema } from '../db/index.js';
import type { HealthChange } from '../services/health.js';
import { findGrabbedByDownloadId } from '../services/history.js';
import { getHostConfig } from '../services/hostConfig.js';
import { redact } from '../services/logs.js';
import { DiscordProvider } from './discord.js';
import { EmailProvider } from './email.js';
import {
  type MessageEpisode,
  type MessageSeries,
  type NotificationMessage,
  type NotificationProvider,
  type ProviderContext,
  type ProviderDeps,
} from './types.js';
import { WebhookProvider } from './webhook.js';

export type NotificationRow = typeof schema.notifications.$inferSelect;
export type ProviderFactory = (row: NotificationRow, ctx: ProviderContext) => NotificationProvider;

export const MAX_CONCURRENT_SENDS = 4;
/** Renames of one series within this window are sent as a single notification. */
export const RENAME_WINDOW_MS = 1000;
/** An upgrade delete marks its episodes for this long so the following import is flagged as an upgrade. */
const UPGRADE_MARK_TTL_MS = 10 * 60 * 1000;
const MASK = '********';

export type StoredSettings = WebhookSettings | DiscordSettings | EmailSettings;

export function parseStoredSettings(row: Pick<NotificationRow, 'implementation' | 'settings'>): StoredSettings {
  const raw: unknown = JSON.parse(row.settings);
  switch (row.implementation) {
    case 'webhook':
      return webhookSettingsSchema.parse(raw);
    case 'discord':
      return discordSettingsSchema.parse(raw);
    case 'email':
      return emailSettingsSchema.parse(raw);
    default:
      throw new Error(`Unknown notification implementation "${row.implementation}"`);
  }
}

let providerFactory: ProviderFactory | undefined;
let providerDeps: ProviderDeps = {};

/** Replaces how providers are built (tests); undefined restores the real providers. */
export function setNotificationProviderFactory(fn: ProviderFactory | undefined): void {
  providerFactory = fn;
}

/** Overrides fetch/sendMail/timeouts of the real providers (tests). */
export function setNotificationProviderDeps(deps: ProviderDeps | undefined): void {
  providerDeps = deps ?? {};
}

export function createProvider(row: NotificationRow, ctx: ProviderContext): NotificationProvider {
  if (providerFactory) return providerFactory(row, ctx);
  const settings = parseStoredSettings(row);
  switch (row.implementation) {
    case 'webhook':
      return new WebhookProvider(settings as WebhookSettings, ctx, providerDeps);
    case 'discord':
      return new DiscordProvider(settings as DiscordSettings, ctx, providerDeps);
    default:
      return new EmailProvider(settings as EmailSettings, providerDeps);
  }
}

/** Secret substrings of stored settings (passwords, webhook URLs, URL credentials and query strings). */
export function secretsOf(settings: StoredSettings | Record<string, unknown>): string[] {
  const s = settings as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['password', 'webHookUrl', 'url'] as const) {
    const v = s[key];
    if (typeof v !== 'string' || v === '') continue;
    if (key === 'password') out.push(v);
    else {
      out.push(v);
      try {
        const u = new URL(v);
        if (u.password) out.push(u.password, decodeURIComponent(u.password));
        if (u.username) out.push(u.username);
        if (u.search.length > 1) out.push(u.search.slice(1));
        if (key === 'webHookUrl') out.push(...u.pathname.split('/').filter((p) => p.length >= 16));
      } catch {
        // not a URL; the whole value is already a secret
      }
    }
  }
  return out;
}

/** Removes stored secrets and well-known token shapes from free text. */
export function scrub(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 3) out = out.split(secret).join(MASK);
  return redact(out);
}

function selects(row: NotificationRow, message: NotificationMessage): boolean {
  switch (message.eventType) {
    case 'Grab':
      return row.onGrab;
    case 'Download':
      return row.onDownload && (!message.isUpgrade || row.onUpgrade);
    case 'Rename':
      return row.onRename;
    case 'EpisodeFileDelete':
      return message.deleteReason === 'upgrade' ? row.onEpisodeFileDeleteForUpgrade : row.onEpisodeFileDelete;
    case 'SeriesAdd':
      return row.onSeriesAdd;
    case 'SeriesDelete':
      return row.onSeriesDelete;
    case 'Health':
      return row.onHealthIssue && (message.health?.level === 'error' || row.includeHealthWarnings);
    case 'HealthRestored':
      return row.onHealthRestored && (message.health?.level === 'error' || row.includeHealthWarnings);
    default:
      return false;
  }
}

interface SeriesInfo {
  message: MessageSeries;
  tags: number[];
}

type SeriesRow = typeof schema.series.$inferSelect;

function posterOf(imagesJson: string): string | undefined {
  try {
    const images = JSON.parse(imagesJson) as { coverType: string; url: string; remoteUrl: string }[];
    const poster = images.find((i) => i.coverType === 'poster');
    return poster?.remoteUrl || poster?.url || undefined;
  } catch {
    return undefined;
  }
}

function infoFromRow(row: Pick<SeriesRow, 'id' | 'title' | 'path' | 'tvdbId' | 'tvmazeId' | 'seriesType' | 'images' | 'tags'>): SeriesInfo {
  const message: MessageSeries = {
    id: row.id,
    title: row.title,
    path: row.path,
    tvdbId: row.tvdbId ?? 0,
    tvMazeId: row.tvmazeId,
    type: row.seriesType,
  };
  const poster = posterOf(row.images);
  if (poster) message.posterUrl = poster;
  return { message, tags: JSON.parse(row.tags) as number[] };
}

interface HistoryEntry {
  id?: number;
  seriesId: number;
  episodeId?: number;
  sourceTitle: string;
  quality: { quality?: { name?: string } };
  eventType: string;
  downloadId?: string;
  data: Record<string, string>;
}

interface Batch {
  entry: HistoryEntry;
  episodeIds: number[];
}

const activators = new WeakMap<object, () => void>();

/**
 * Starts listening for events (idempotent). The dispatcher stays passive while no notification exists, so
 * an app without notifications carries no extra event listener.
 */
export function activateNotificationDispatcher(app: FastifyInstance): void {
  activators.get(app)?.();
}

/**
 * Turns domain events (history rows, series changes, health changes) into notifications. Sends run in the
 * background, at most four at a time; failures are logged (secrets redacted) and surface as a health warning.
 */
export function registerNotificationDispatcher(app: FastifyInstance): void {
  if (activators.has(app)) return;

  let closed = false;
  const series = new Map<number, SeriesInfo>();
  const upgradeMarks = new Map<number, number>();
  const pending = new Map<string, Batch>();
  const renames = new Map<number, { batches: Batch[]; timer: NodeJS.Timeout }>();
  const queue: (() => Promise<void>)[] = [];
  let running = 0;
  let flushScheduled = false;

  const ctx = (): ProviderContext => ({ instanceName: getHostConfig(app.db).instanceName, applicationUrl: '' });

  function loadSeries(id: number): SeriesInfo | undefined {
    const row = app.db.select().from(schema.series).where(eq(schema.series.id, id)).get();
    if (!row) return series.get(id);
    const info = infoFromRow(row);
    series.set(id, info);
    return info;
  }


  function warn(text: string): void {
    try {
      app.logs.write({ level: 'warn', message: text, logger: 'Notification' });
    } catch {
      // logging must never break dispatching
    }
  }

  function pump(): void {
    while (!closed && running < MAX_CONCURRENT_SENDS && queue.length > 0) {
      const job = queue.shift()!;
      running++;
      void job().finally(() => {
        running--;
        pump();
      });
    }
  }

  function enqueue(row: NotificationRow, message: NotificationMessage): void {
    queue.push(async () => {
      let secrets: string[] = [];
      try {
        secrets = secretsOf(JSON.parse(row.settings) as Record<string, unknown>);
        await createProvider(row, ctx()).send(message);
        app.health?.clearNotificationFailure(row.id);
      } catch (err) {
        warn(`Notification "${row.name}" (${message.eventType}) failed: ${scrub(err instanceof Error ? err.message : String(err), secrets)}`);
        app.health?.reportNotificationFailure(row.id);
      }
    });
    pump();
  }

  /** Queues `message` for every notification that selected the event and matches the series tags. */
  function dispatch(message: NotificationMessage, seriesTags?: number[]): void {
    const rows = app.db.select().from(schema.notifications).orderBy(schema.notifications.id).all();
    for (const row of rows) {
      if (!selects(row, message)) continue;
      if (seriesTags !== undefined) {
        const tags = JSON.parse(row.tags) as number[];
        if (tags.length > 0 && !tags.some((t) => seriesTags.includes(t))) continue;
      }
      enqueue(row, message);
    }
  }

  function episodesOf(ids: number[]): MessageEpisode[] {
    if (ids.length === 0) return [];
    return app.db
      .select()
      .from(schema.episodes)
      .where(inArray(schema.episodes.id, ids))
      .all()
      .map((e) => {
        const ep: MessageEpisode = { id: e.id, episodeNumber: e.episodeNumber, seasonNumber: e.seasonNumber, title: e.title };
        if (e.airDate) ep.airDate = e.airDate;
        return ep;
      });
  }

  const qualityName = (e: HistoryEntry) => e.quality?.quality?.name ?? 'Unknown';

  function handleBatch(batch: Batch): void {
    const { entry, episodeIds } = batch;
    const info = loadSeries(entry.seriesId);
    if (!info) return;
    const base: NotificationMessage = { series: info.message, episodes: episodesOf(episodeIds), eventType: 'Grab' };
    const data = entry.data ?? {};
    switch (entry.eventType) {
      case 'grabbed': {
        const size = Number(data.size);
        const release: NotificationMessage['release'] = { quality: qualityName(entry), releaseTitle: entry.sourceTitle };
        if (data.indexer) release.indexer = data.indexer;
        if (Number.isFinite(size) && size > 0) release.size = size;
        if (data.releaseGroup) release.releaseGroup = data.releaseGroup;
        const msg: NotificationMessage = { ...base, eventType: 'Grab', release };
        if (data.downloadClient) msg.downloadClient = data.downloadClient;
        if (entry.downloadId) msg.downloadId = entry.downloadId;
        dispatch(msg, info.tags);
        break;
      }
      case 'downloadFolderImported': {
        const marked = episodeIds.filter((id) => {
          const at = upgradeMarks.get(id);
          return at !== undefined && Date.now() - at < UPGRADE_MARK_TTL_MS;
        });
        for (const id of episodeIds) upgradeMarks.delete(id);
        const file = data.importedPath
          ? app.db.select().from(schema.episodeFiles).where(eq(schema.episodeFiles.path, data.importedPath)).get()
          : undefined;
        const release: NotificationMessage['release'] = { quality: qualityName(entry), releaseTitle: entry.sourceTitle };
        const downloadId = entry.downloadId ?? data.downloadId;
        const grabbed = downloadId ? findGrabbedByDownloadId(app.db, downloadId)[0] : undefined;
        const indexer = grabbed ? (JSON.parse(grabbed.data) as Record<string, string>).indexer : undefined;
        if (indexer) release.indexer = indexer;
        if (file?.size) release.size = file.size;
        if (data.releaseGroup) release.releaseGroup = data.releaseGroup;
        const msg: NotificationMessage = { ...base, eventType: 'Download', release, isUpgrade: marked.length > 0 };
        if (file) msg.episodeFile = { relativePath: file.relativePath, path: file.path, quality: qualityName(entry), size: file.size };
        else if (data.importedPath) msg.episodeFile = { relativePath: data.importedPath, path: data.importedPath, quality: qualityName(entry) };
        if (data.downloadClient) msg.downloadClient = data.downloadClient;
        if (downloadId) msg.downloadId = downloadId;
        dispatch(msg, info.tags);
        break;
      }
      case 'episodeFileDeleted': {
        const msg: NotificationMessage = {
          ...base,
          eventType: 'EpisodeFileDelete',
          episodeFile: { relativePath: entry.sourceTitle, path: data.path ?? entry.sourceTitle, quality: qualityName(entry) },
        };
        if (data.reason) msg.deleteReason = data.reason;
        dispatch(msg, info.tags);
        break;
      }
    }
  }

  function flushPending(): void {
    flushScheduled = false;
    const batches = [...pending.values()];
    pending.clear();
    for (const batch of batches) {
      try {
        handleBatch(batch);
      } catch (err) {
        warn(`Unable to dispatch notification: ${scrub(err instanceof Error ? err.message : String(err))}`);
      }
    }
  }

  function flushRenames(seriesId: number): void {
    const group = renames.get(seriesId);
    renames.delete(seriesId);
    if (!group || closed) return;
    try {
      const info = loadSeries(seriesId);
      if (!info) return;
      const ids = [...new Set(group.batches.flatMap((b) => b.episodeIds))];
      const first = group.batches[0]!;
      const data = first.entry.data ?? {};
      const msg: NotificationMessage = { eventType: 'Rename', series: info.message, episodes: episodesOf(ids) };
      if (group.batches.length === 1 && data.path) {
        msg.episodeFile = { relativePath: data.relativePath ?? data.path, path: data.path, quality: qualityName(first.entry) };
      }
      dispatch(msg, info.tags);
    } catch (err) {
      warn(`Unable to dispatch notification: ${scrub(err instanceof Error ? err.message : String(err))}`);
    }
  }

  function onHistory(resource: Record<string, unknown>): void {
    const entry = resource as unknown as HistoryEntry;
    if (entry.eventType === 'episodeFileDeleted' && entry.data?.reason === 'upgrade' && entry.episodeId !== undefined) {
      upgradeMarks.set(entry.episodeId, Date.now());
    }
    if (!['grabbed', 'downloadFolderImported', 'episodeFileDeleted', 'episodeFileRenamed'].includes(entry.eventType)) return;

    if (entry.eventType === 'episodeFileRenamed') {
      let group = renames.get(entry.seriesId);
      if (!group) {
        const timer = setTimeout(() => flushRenames(entry.seriesId), RENAME_WINDOW_MS);
        timer.unref();
        group = { batches: [], timer };
        renames.set(entry.seriesId, group);
      }
      group.batches.push({ entry, episodeIds: entry.episodeId !== undefined ? [entry.episodeId] : [] });
      return;
    }

    // one history row per episode is published synchronously; group them into one notification
    const key = [entry.eventType, entry.seriesId, entry.downloadId ?? '', entry.sourceTitle, entry.data?.importedPath ?? '', entry.data?.path ?? ''].join('|');
    const batch = pending.get(key);
    if (batch) {
      if (entry.episodeId !== undefined) batch.episodeIds.push(entry.episodeId);
    } else {
      pending.set(key, { entry, episodeIds: entry.episodeId !== undefined ? [entry.episodeId] : [] });
    }
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushPending);
    }
  }

  let unsubscribeEvents: (() => void) | undefined;
  let unsubscribeHealth: (() => void) | undefined;

  function activate(): void {
    if (closed || unsubscribeEvents) return;
    for (const row of app.db.select().from(schema.series).all()) series.set(row.id, infoFromRow(row));
    unsubscribeEvents = app.events.subscribe(onEvent);
    unsubscribeHealth = app.health?.onChange(onHealthChange);
  }
  activators.set(app, activate);

  function onEvent(event: { name: string; action: string; resource?: Record<string, unknown> }): void {
    if (closed || !event.resource) return;
    try {
      if (event.name === 'history' && event.action === 'created') onHistory(event.resource);
      else if (event.name === 'series') {
        const id = (event.resource as { id?: unknown }).id;
        if (typeof id !== 'number') return;
        if (event.action === 'created') {
          const info = loadSeries(id);
          if (info) dispatch({ eventType: 'SeriesAdd', series: info.message }, info.tags);
        } else if (event.action === 'deleted') {
          const info = series.get(id) ?? { message: { id, title: `Series ${id}`, path: '', tvdbId: 0, tvMazeId: 0, type: 'standard' }, tags: [] };
          series.delete(id);
          dispatch({ eventType: 'SeriesDelete', series: info.message }, info.tags);
        } else if (event.action === 'updated') loadSeries(id);
      }
    } catch (err) {
      warn(`Unable to dispatch notification: ${scrub(err instanceof Error ? err.message : String(err))}`);
    }
  }

  const healthMessage = (type: 'Health' | 'HealthRestored', h: HealthResource): NotificationMessage => {
    const health: NotificationMessage['health'] = { level: h.type === 'error' ? 'error' : 'warning', message: h.message, type: h.source };
    if (h.wikiUrl) health.wikiUrl = h.wikiUrl;
    return { eventType: type, health };
  };

  // Failing notifications are reported by NotificationStatusCheck itself; notifying about them would only loop.
  const relevant = (h: HealthResource) => (h.type === 'error' || h.type === 'warning') && h.source !== 'NotificationStatusCheck';
  function onHealthChange(change: HealthChange): void {
    if (closed) return;
    try {
      for (const h of change.added.filter(relevant)) dispatch(healthMessage('Health', h));
      for (const h of change.removed.filter(relevant)) dispatch(healthMessage('HealthRestored', h));
    } catch (err) {
      warn(`Unable to dispatch notification: ${scrub(err instanceof Error ? err.message : String(err))}`);
    }
  }

  if (app.db.select({ id: schema.notifications.id }).from(schema.notifications).limit(1).get()) activate();

  app.addHook('onClose', async () => {
    closed = true;
    unsubscribeEvents?.();
    unsubscribeHealth?.();
    for (const g of renames.values()) clearTimeout(g.timer);
    renames.clear();
    queue.length = 0;
  });
}
