import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { historyEventTypes, type HistoryResource, type Paged } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { toHistoryResource } from '../services/history.js';

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
  sortDirection: z.enum(['ascending', 'descending']).default('descending'),
});

const sortColumns = {
  date: schema.history.date,
  id: schema.history.id,
  sourceTitle: schema.history.sourceTitle,
  eventType: schema.history.eventType,
  seriesId: schema.history.seriesId,
} as const;

const querySchema = pagingSchema.extend({
  sortKey: z.enum(['date', 'id', 'sourceTitle', 'eventType', 'seriesId']).default('date'),
  eventType: z.enum(historyEventTypes).optional(),
  seriesId: z.coerce.number().int().optional(),
  episodeId: z.coerce.number().int().optional(),
});

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/history', async (req): Promise<Paged<HistoryResource>> => {
    const q = querySchema.parse(req.query);
    const conds: SQL[] = [];
    if (q.eventType) conds.push(eq(schema.history.eventType, q.eventType));
    if (q.seriesId !== undefined) conds.push(eq(schema.history.seriesId, q.seriesId));
    if (q.episodeId !== undefined) conds.push(eq(schema.history.episodeId, q.episodeId));
    const where = conds.length ? and(...conds) : undefined;
    const total = app.db.select({ n: sql<number>`count(*)` }).from(schema.history).where(where).get()?.n ?? 0;
    const dir = q.sortDirection === 'ascending' ? asc : desc;
    const rows = app.db
      .select()
      .from(schema.history)
      .where(where)
      .orderBy(dir(sortColumns[q.sortKey]), dir(schema.history.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    return {
      page: q.page,
      pageSize: q.pageSize,
      sortKey: q.sortKey,
      sortDirection: q.sortDirection,
      totalRecords: total,
      records: rows.map(toHistoryResource),
    };
  });

  app.get('/api/v3/history/series', async (req): Promise<HistoryResource[]> => {
    const q = z.object({ seriesId: z.coerce.number().int() }).parse(req.query);
    return app.db
      .select()
      .from(schema.history)
      .where(eq(schema.history.seriesId, q.seriesId))
      .orderBy(desc(schema.history.date), desc(schema.history.id))
      .all()
      .map(toHistoryResource);
  });
}
