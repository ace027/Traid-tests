import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { HistoryEventType, QueueResource, TrackedDownloadState, TrackedDownloadStatus } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';
import { clientFor } from '../downloadClients/registry.js';
import { getImportDecisions, ImportSourceError } from '../import/decisions.js';
import { importDecisions } from '../import/importer.js';
import type { TransferMode } from '../import/types.js';
import { addToBlocklist } from './blocklist.js';
import { recordEvent, type HistoryRow } from './history.js';
import { getDownloadClientConfig, getMediaManagementConfig } from './mediaConfig.js';
import type { TrackedDownload } from './queue.js';

export interface HandlingOutcome {
  state: TrackedDownloadState;
  status?: TrackedDownloadStatus;
  statusMessages?: QueueResource['statusMessages'];
  /** The item was removed from the download client. */
  removed?: boolean;
}

/** History rows of one event type for a download id (download ids are matched case-insensitively). */
export function downloadEvents(db: Db, downloadId: string, eventType: HistoryEventType): HistoryRow[] {
  for (const id of new Set([downloadId, downloadId.toLowerCase(), downloadId.toUpperCase()])) {
    const rows = db
      .select()
      .from(schema.history)
      .where(and(eq(schema.history.downloadId, id), eq(schema.history.eventType, eventType)))
      .all();
    if (rows.length > 0) return rows;
  }
  return [];
}

/** True when every episode of the grab has a downloadFolderImported event for this download. */
export function isFullyImported(db: Db, downloadId: string, episodeIds: readonly number[]): boolean {
  const rows = downloadEvents(db, downloadId, 'downloadFolderImported');
  if (rows.length === 0) return false;
  const done = new Set(rows.map((r) => r.episodeId));
  return episodeIds.every((id) => done.has(id));
}

/** Usenet downloads the client lets us move are moved; everything else is hardlinked (when enabled) or copied. */
export function transferModeFor(db: Db, t: Pick<TrackedDownload, 'protocol' | 'item'>): TransferMode {
  if (t.protocol === 'usenet' && t.item.canMoveFiles) return 'move';
  return getMediaManagementConfig(db).copyUsingHardlinks ? 'hardlink' : 'copy';
}

const grabbedDownloadId = (t: TrackedDownload) => t.match?.rows[0]?.downloadId ?? t.item.downloadId;

async function removeFromClient(app: FastifyInstance, t: TrackedDownload, why: 'completed' | 'failed'): Promise<boolean> {
  const row = app.db.select().from(schema.downloadClients).where(eq(schema.downloadClients.id, t.clientId)).get();
  if (!row) return false;
  const wanted = why === 'completed' ? row.removeCompletedDownloads && t.item.canBeRemoved : row.removeFailedDownloads;
  if (!wanted) return false;
  try {
    await clientFor(row).removeItem(t.item.downloadId, true);
    return true;
  } catch (err) {
    app.log.warn({ err, downloadId: t.item.downloadId }, `Unable to remove the ${why} download from ${row.name}`);
    return false;
  }
}

const warning = (title: string, message: string): HandlingOutcome => ({
  state: 'importPending',
  status: 'warning',
  statusMessages: [{ title, messages: [message] }],
});

/**
 * Imports a completed download from its output path. Success (every grabbed episode imported) -> imported, and
 * the item is removed from the client when the client's removeCompletedDownloads is on and the client allows it
 * (torrents still seeding do not). Otherwise the item stays importPending with a warning per rejected file.
 */
export async function processCompleted(app: FastifyInstance, t: TrackedDownload): Promise<HandlingOutcome> {
  if (!t.match) return { state: 'importPending' };
  const outputPath = t.item.outputPath;
  if (!outputPath) return warning(t.item.title, 'The download client did not report an output path');
  const downloadId = grabbedDownloadId(t);

  let decisions;
  try {
    decisions = await getImportDecisions(app, outputPath, { downloadId });
  } catch (err) {
    if (err instanceof ImportSourceError) return warning(t.item.title, err.message);
    throw err;
  }
  if (decisions.length === 0) return warning(t.item.title, `No files found are eligible for import in ${outputPath}`);

  const results = await importDecisions(app, decisions, { mode: transferModeFor(app.db, t), downloadId, downloadClient: t.clientName });
  if (isFullyImported(app.db, downloadId, t.match.episodeIds)) {
    return { state: 'imported', removed: await removeFromClient(app, t, 'completed') };
  }
  const statusMessages = results
    .filter((r) => r.result !== 'imported')
    .map((r) => ({
      title: path.basename(r.decision.source.path),
      messages: r.result === 'rejected' && r.decision.rejections.length > 0 ? r.decision.rejections.map((x) => x.reason) : [r.message],
    }));
  if (statusMessages.length === 0) statusMessages.push({ title: t.item.title, messages: ['Not all episodes of the release were imported'] });
  return { state: 'importPending', status: 'warning', statusMessages };
}

/**
 * Handles a failed download once per download id: records downloadFailed, blocklists the release, removes the
 * item when the client's removeFailedDownloads is on and searches the episodes again when autoRedownloadFailed.
 */
export async function processFailed(app: FastifyInstance, t: TrackedDownload): Promise<HandlingOutcome> {
  if (!t.match) return { state: 'failedPending' };
  const downloadId = grabbedDownloadId(t);
  if (downloadEvents(app.db, downloadId, 'downloadFailed').length > 0) return { state: 'failed' };
  const grabbed = t.match.rows[0]!;
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(grabbed.data) as Record<string, string>;
  } catch {
    // corrupt grab data: fall back to an empty record so the failure is still recorded
  }
  const message = t.item.message ?? 'Download failed';
  recordEvent(app, 'downloadFailed', {
    seriesId: t.match.seriesId,
    episodeIds: t.match.episodeIds,
    sourceTitle: grabbed.sourceTitle,
    quality: t.match.quality,
    downloadId,
    data: { message, downloadClient: t.clientName, ...(t.match.indexer ? { indexer: t.match.indexer } : {}) },
  });
  addToBlocklist(app, {
    seriesId: t.match.seriesId,
    episodeIds: t.match.episodeIds,
    sourceTitle: grabbed.sourceTitle,
    quality: t.match.quality,
    protocol: t.protocol,
    indexer: t.match.indexer ?? null,
    size: t.item.totalSize,
    publishedDate: data.publishedDate ?? null,
    message,
    torrentInfoHash: t.protocol === 'torrent' ? t.item.downloadId : (data.torrentInfoHash ?? null),
  });
  const removed = await removeFromClient(app, t, 'failed');
  if (getDownloadClientConfig(app.db).autoRedownloadFailed && t.match.episodeIds.length > 0) {
    app.commands.enqueue('EpisodeSearch', { episodeIds: t.match.episodeIds }, 'manual');
  }
  return { state: 'failed', removed };
}
