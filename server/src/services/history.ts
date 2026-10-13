import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { HistoryEventType, HistoryResource, QualityModel } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';

export type HistoryRow = typeof schema.history.$inferSelect;

export interface HistoryEventInput {
  seriesId: number;
  episodeIds: number[];
  sourceTitle: string;
  quality: QualityModel;
  downloadId?: string | null;
  data?: Record<string, string>;
  date?: string;
}

export function toHistoryResource(row: HistoryRow): HistoryResource {
  const r: HistoryResource = {
    id: row.id,
    seriesId: row.seriesId,
    sourceTitle: row.sourceTitle,
    quality: JSON.parse(row.quality) as QualityModel,
    date: row.date,
    eventType: row.eventType as HistoryEventType,
    data: JSON.parse(row.data) as Record<string, string>,
  };
  if (row.episodeId !== null) r.episodeId = row.episodeId;
  if (row.downloadId) r.downloadId = row.downloadId;
  return r;
}

/** Inserts one history row per episode (a single row without episode when none are given). */
export function recordEvent(app: FastifyInstance, eventType: HistoryEventType, input: HistoryEventInput): HistoryRow[] {
  const date = input.date ?? new Date().toISOString();
  const episodeIds: (number | null)[] = input.episodeIds.length > 0 ? input.episodeIds : [null];
  const rows = app.db.transaction((tx) =>
    episodeIds.map((episodeId) =>
      tx
        .insert(schema.history)
        .values({
          seriesId: input.seriesId,
          episodeId,
          sourceTitle: input.sourceTitle,
          quality: JSON.stringify(input.quality),
          date,
          eventType,
          downloadId: input.downloadId ?? null,
          data: JSON.stringify(input.data ?? {}),
        })
        .returning()
        .get(),
    ),
  );
  for (const row of rows) {
    app.events.publish('history', 'created', toHistoryResource(row) as unknown as Record<string, unknown>);
  }
  return rows;
}

export function recordGrabbed(app: FastifyInstance, input: HistoryEventInput): HistoryRow[] {
  return recordEvent(app, 'grabbed', input);
}

export function findGrabbedByDownloadId(db: Db, downloadId: string): HistoryRow[] {
  return db
    .select()
    .from(schema.history)
    .where(eq(schema.history.downloadId, downloadId))
    .all()
    .filter((r) => r.eventType === 'grabbed');
}
