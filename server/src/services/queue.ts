import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QUALITIES, type Paged, type Protocol, type QualityModel, type QueueResource, type TrackedDownloadState, type TrackedDownloadStatus } from '@sonarr/shared';
import { clientFor, type DownloadClientRow } from '../downloadClients/registry.js';
import type { DownloadClientItem } from '../downloadClients/types.js';
import { schema } from '../db/index.js';
import { parseTitle } from '../parser/index.js';
import { pagingSchema } from '../routes/history.js';
import { addToBlocklist } from './blocklist.js';
import { findGrabbedByDownloadId, type HistoryRow } from './history.js';

export const QUEUE_CACHE_MS = 5000;

interface Match {
  seriesId: number;
  episodeIds: number[];
  quality: QualityModel;
  indexer?: string;
  rows: HistoryRow[];
}

interface Tracked {
  id: number;
  key: string;
  clientId: number;
  clientName: string;
  protocol: Protocol;
  item: DownloadClientItem;
  match: Match | null;
  seriesTitle: string;
  added: number;
  resource: QueueResource;
}

export interface ClientHealth {
  clientId: number;
  name: string;
  message: string;
}

export interface QueueStatusResource {
  totalCount: number;
  count: number;
  unknownCount: number;
  errors: boolean;
  warnings: boolean;
}

export class QueueNotFoundError extends Error {}

const UNKNOWN_QUALITY: QualityModel = {
  quality: QUALITIES[0]!,
  revision: { version: 1, real: 0, isRepack: false },
};

function formatTimeLeft(seconds: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${p(seconds / 3600)}:${p((seconds / 60) % 60)}:${p(seconds % 60)}`;
}

export class QueueService {
  private readonly ids = new Map<string, number>();
  private readonly firstSeen = new Map<number, number>();
  private readonly ignored = new Set<string>();
  private readonly itemsByClient = new Map<number, { row: DownloadClientRow; items: DownloadClientItem[] }>();
  private readonly healthByClient = new Map<number, ClientHealth>();
  private tracked: Tracked[] = [];
  private nextId = 1;
  private lastRefresh = 0;
  private signature = '[]';
  private inflight: Promise<void> | null = null;

  constructor(private readonly app: FastifyInstance) {}

  health(): ClientHealth[] {
    return [...this.healthByClient.values()];
  }

  /** Polls every enabled client. Failing clients keep their previous items and yield a health message. */
  refresh(): Promise<void> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async ensureFresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (Date.now() - this.lastRefresh > QUEUE_CACHE_MS) await this.refresh();
  }

  private async doRefresh(): Promise<void> {
    const rows = this.app.db
      .select()
      .from(schema.downloadClients)
      .all()
      .filter((r) => r.enable);
    const results = await Promise.allSettled(rows.map(async (row) => clientFor(row).getItems()));
    const enabled = new Set(rows.map((r) => r.id));
    for (const id of [...this.itemsByClient.keys()]) if (!enabled.has(id)) this.itemsByClient.delete(id);
    for (const id of [...this.healthByClient.keys()]) if (!enabled.has(id)) this.healthByClient.delete(id);
    results.forEach((result, i) => {
      const row = rows[i]!;
      if (result.status === 'fulfilled') {
        this.itemsByClient.set(row.id, { row, items: result.value });
        this.healthByClient.delete(row.id);
      } else {
        const reason = result.reason as Error;
        const message = `Unable to communicate with ${row.name}: ${reason?.message ?? 'unknown error'}`;
        this.healthByClient.set(row.id, { clientId: row.id, name: row.name, message });
        this.app.log.warn(message);
        const prev = this.itemsByClient.get(row.id);
        if (prev) this.itemsByClient.set(row.id, { row, items: prev.items });
      }
    });
    this.lastRefresh = Date.now();
    this.tracked = this.build();
    const live = new Set<string>();
    for (const { row, items } of this.itemsByClient.values()) for (const item of items) live.add(`${row.id}:${item.downloadId}`);
    for (const [key, id] of [...this.ids]) {
      if (live.has(key)) continue;
      this.ids.delete(key);
      this.firstSeen.delete(id);
    }
    for (const key of [...this.ignored]) if (!live.has(key)) this.ignored.delete(key);
    const signature = JSON.stringify(
      this.tracked.map((t) => [t.id, t.item.status, t.item.remainingSize, t.resource.trackedDownloadState]),
    );
    if (signature !== this.signature) {
      this.signature = signature;
      this.app.events.publish('queue', 'updated');
    }
  }

  private idFor(key: string): number {
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(key, id);
      this.firstSeen.set(id, Date.now());
    }
    return id;
  }

  private matchFor(downloadId: string): Match | null {
    let rows: HistoryRow[] = [];
    for (const candidate of new Set([downloadId, downloadId.toLowerCase(), downloadId.toUpperCase()])) {
      rows = findGrabbedByDownloadId(this.app.db, candidate);
      if (rows.length > 0) break;
    }
    if (rows.length === 0) return null;
    const first = rows[0]!;
    const match: Match = {
      seriesId: first.seriesId,
      episodeIds: rows.filter((r) => r.episodeId !== null).map((r) => r.episodeId as number),
      quality: JSON.parse(first.quality) as QualityModel,
      rows,
    };
    const indexer = (JSON.parse(first.data) as Record<string, string>).indexer;
    if (indexer) match.indexer = indexer;
    return match;
  }

  private build(): Tracked[] {
    const out: Tracked[] = [];
    const matches: { row: DownloadClientRow; item: DownloadClientItem; match: Match | null }[] = [];
    for (const { row, items } of this.itemsByClient.values()) {
      for (const item of items) {
        if (this.ignored.has(`${row.id}:${item.downloadId}`)) continue;
        matches.push({ row, item, match: this.matchFor(item.downloadId) });
      }
    }
    const seriesIds = [...new Set(matches.flatMap((m) => (m.match ? [m.match.seriesId] : [])))];
    const titles = new Map<number, string>();
    if (seriesIds.length > 0) {
      for (const s of this.app.db.select({ id: schema.series.id, title: schema.series.title }).from(schema.series).where(inArray(schema.series.id, seriesIds)).all()) {
        titles.set(s.id, s.title);
      }
    }
    const episodeIds = [...new Set(matches.flatMap((m) => m.match?.episodeIds ?? []))];
    const seasons = new Map<number, number>();
    if (episodeIds.length > 0) {
      for (const e of this.app.db.select({ id: schema.episodes.id, season: schema.episodes.seasonNumber }).from(schema.episodes).where(inArray(schema.episodes.id, episodeIds)).all()) {
        seasons.set(e.id, e.season);
      }
    }
    for (const { row, item, match } of matches) {
      const key = `${row.id}:${item.downloadId}`;
      const id = this.idFor(key);
      const protocol = row.protocol as Protocol;
      const failed = item.status === 'failed';
      const state: TrackedDownloadState = failed ? 'failedPending' : item.status === 'completed' ? 'importPending' : 'downloading';
      const status: TrackedDownloadStatus = failed ? 'error' : item.status === 'warning' || !match ? 'warning' : 'ok';
      const statusMessages: QueueResource['statusMessages'] = [];
      if (!match) statusMessages.push({ title: item.title, messages: ['Unknown series: the download is not linked to a grabbed release'] });
      if (item.message && item.status === 'warning') statusMessages.push({ title: item.title, messages: [item.message] });
      const quality = match?.quality ?? parseTitle(item.title)?.quality ?? UNKNOWN_QUALITY;
      const resource: QueueResource = {
        id,
        episodeIds: match?.episodeIds ?? [],
        title: item.title,
        size: item.totalSize,
        sizeleft: item.remainingSize,
        status: item.status,
        trackedDownloadStatus: status,
        trackedDownloadState: state,
        statusMessages,
        downloadId: item.downloadId,
        protocol,
        downloadClient: row.name,
        quality,
      };
      if (match) {
        resource.seriesId = match.seriesId;
        const season = seasons.get(match.episodeIds[0] ?? -1);
        if (season !== undefined) resource.seasonNumber = season;
        if (match.indexer) resource.indexer = match.indexer;
      }
      if (item.remainingTimeSeconds !== undefined) {
        resource.timeleft = formatTimeLeft(item.remainingTimeSeconds);
        resource.estimatedCompletionTime = new Date(Date.now() + item.remainingTimeSeconds * 1000).toISOString();
      }
      if (failed) resource.errorMessage = item.message ?? 'Download failed';
      if (item.outputPath) resource.outputPath = item.outputPath;
      out.push({
        id,
        key,
        clientId: row.id,
        clientName: row.name,
        protocol,
        item,
        match,
        seriesTitle: match ? (titles.get(match.seriesId) ?? '') : '',
        added: this.firstSeen.get(id) ?? 0,
        resource,
      });
    }
    return out;
  }

  async list(opts: {
    page?: number;
    pageSize?: number;
    sortKey?: 'timeleft' | 'title' | 'series' | 'progress' | 'added';
    sortDirection?: 'ascending' | 'descending';
    includeUnknownSeriesItems?: boolean;
  } = {}): Promise<Paged<QueueResource>> {
    await this.ensureFresh();
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const sortKey = opts.sortKey ?? 'timeleft';
    const sortDirection = opts.sortDirection ?? 'ascending';
    const visible = this.tracked.filter((t) => opts.includeUnknownSeriesItems || t.match);
    const progress = (t: Tracked) => (t.item.totalSize > 0 ? (t.item.totalSize - t.item.remainingSize) / t.item.totalSize : 0);
    const value = (t: Tracked): number | string =>
      sortKey === 'title'
        ? t.item.title.toLowerCase()
        : sortKey === 'series'
          ? t.seriesTitle.toLowerCase()
          : sortKey === 'progress'
            ? progress(t)
            : sortKey === 'added'
              ? t.added
              : (t.item.remainingTimeSeconds ?? Number.MAX_SAFE_INTEGER);
    const dir = sortDirection === 'ascending' ? 1 : -1;
    const sorted = [...visible].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : a.id - b.id) * dir;
    });
    return {
      page,
      pageSize,
      sortKey,
      sortDirection,
      totalRecords: sorted.length,
      records: sorted.slice((page - 1) * pageSize, page * pageSize).map((t) => t.resource),
    };
  }

  async details(filter: { seriesId?: number; episodeIds?: number[] }): Promise<QueueResource[]> {
    await this.ensureFresh();
    return this.tracked
      .filter((t) => t.match)
      .filter((t) => filter.seriesId === undefined || t.match!.seriesId === filter.seriesId)
      .filter((t) => !filter.episodeIds?.length || t.match!.episodeIds.some((e) => filter.episodeIds!.includes(e)))
      .map((t) => t.resource);
  }

  async status(): Promise<QueueStatusResource> {
    await this.ensureFresh();
    const unknown = this.tracked.filter((t) => !t.match);
    return {
      totalCount: this.tracked.length,
      count: this.tracked.length - unknown.length,
      unknownCount: unknown.length,
      errors: this.tracked.some((t) => t.resource.trackedDownloadStatus === 'error'),
      warnings: this.tracked.some((t) => t.resource.trackedDownloadStatus === 'warning'),
    };
  }

  /** Removes tracked downloads; throws QueueNotFoundError (before doing anything) when an id is unknown. */
  async remove(ids: number[], opts: { removeFromClient: boolean; blocklist: boolean }): Promise<void> {
    await this.ensureFresh();
    const targets = ids.map((id) => {
      const t = this.tracked.find((x) => x.id === id);
      if (!t) throw new QueueNotFoundError(`Queue item ${id} not found`);
      return t;
    });
    for (const t of targets) {
      if (opts.removeFromClient) {
        const row = this.app.db.select().from(schema.downloadClients).where(eq(schema.downloadClients.id, t.clientId)).get();
        if (row) await clientFor(row).removeItem(t.item.downloadId, true);
      } else {
        this.ignored.add(t.key);
      }
      if (opts.blocklist && t.match) {
        const grabbed = t.match.rows[0]!;
        const data = JSON.parse(grabbed.data) as Record<string, string>;
        addToBlocklist(this.app, {
          seriesId: t.match.seriesId,
          episodeIds: t.match.episodeIds,
          sourceTitle: grabbed.sourceTitle,
          quality: t.match.quality,
          protocol: t.protocol,
          indexer: t.match.indexer ?? null,
          size: t.item.totalSize,
          publishedDate: data.publishedDate ?? null,
          message: 'Removed from the queue',
          torrentInfoHash: t.protocol === 'torrent' ? t.item.downloadId : (data.torrentInfoHash ?? null),
        });
      }
      this.tracked = this.tracked.filter((x) => x.id !== t.id);
      const entry = this.itemsByClient.get(t.clientId);
      if (entry) entry.items = entry.items.filter((i) => i.downloadId !== t.item.downloadId);
      this.app.events.publish('queue', 'deleted', { id: t.id } as unknown as Record<string, unknown>);
    }
    this.signature = JSON.stringify(
      this.tracked.map((t) => [t.id, t.item.status, t.item.remainingSize, t.resource.trackedDownloadState]),
    );
  }
}

const services = new WeakMap<object, QueueService>();

/** Attaches the queue service and the RefreshMonitoredDownloads command. Idempotent per app. */
export function registerQueue(app: FastifyInstance): QueueService {
  const existing = services.get(app.events);
  if (existing) return existing;
  const service = new QueueService(app);
  services.set(app.events, service);
  app.commands.register('RefreshMonitoredDownloads', async ({ updateMessage }) => {
    await service.refresh();
    const problems = service.health();
    updateMessage(problems.length > 0 ? problems.map((p) => p.message).join('; ') : 'Download clients refreshed');
  });
  return service;
}

export function getQueue(app: FastifyInstance): QueueService {
  return registerQueue(app);
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const listQuery = pagingSchema.extend({
  sortKey: z.enum(['timeleft', 'title', 'series', 'progress', 'added']).default('timeleft'),
  sortDirection: z.enum(['ascending', 'descending']).default('ascending'),
  includeUnknownSeriesItems: bool.default(false),
});

const detailsQuery = z.object({
  seriesId: z.coerce.number().int().optional(),
  episodeIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v])
            .flatMap((s) => s.split(','))
            .filter((s) => s !== '')
            .map(Number),
    )
    .pipe(z.array(z.number().int()).optional()),
});

const removeQuery = z.object({
  removeFromClient: bool.default(true),
  blocklist: bool.default(false),
});

const bulkBody = z.object({
  ids: z.array(z.number().int()).min(1).max(1000),
  removeFromClient: z.boolean().default(true),
  blocklist: z.boolean().default(false),
});

export function registerQueueRoutes(app: FastifyInstance): void {
  const queue = registerQueue(app);

  const run = async (ids: number[], opts: { removeFromClient: boolean; blocklist: boolean }, reply: { code(n: number): { send(b: unknown): unknown } }) => {
    try {
      await queue.remove(ids, opts);
    } catch (err) {
      if (err instanceof QueueNotFoundError) return reply.code(404).send({ message: 'NotFound' });
      const message = err instanceof Error ? err.message : 'Failed to remove the download';
      return reply.code(400).send({ message });
    }
    return reply.code(200).send({});
  };

  app.get('/api/v3/queue', async (req) => queue.list(listQuery.parse(req.query)));

  app.get('/api/v3/queue/details', async (req) => {
    const q = detailsQuery.parse(req.query);
    const filter: { seriesId?: number; episodeIds?: number[] } = {};
    if (q.seriesId !== undefined) filter.seriesId = q.seriesId;
    if (q.episodeIds) filter.episodeIds = q.episodeIds;
    return queue.details(filter);
  });

  app.get('/api/v3/queue/status', async () => queue.status());

  app.delete('/api/v3/queue/bulk', async (req, reply) => {
    const { ids, ...opts } = bulkBody.parse(req.body);
    return run(ids, opts, reply);
  });

  app.delete<{ Params: { id: string } }>('/api/v3/queue/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(404).send({ message: 'NotFound' });
    return run([id], removeQuery.parse(req.query), reply);
  });
}
