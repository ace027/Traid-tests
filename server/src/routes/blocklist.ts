import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BlocklistResource, Paged } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { toBlocklistResource } from '../services/blocklist.js';
import { pagingSchema } from './history.js';

const sortColumns = {
  date: schema.blocklist.date,
  id: schema.blocklist.id,
  sourceTitle: schema.blocklist.sourceTitle,
  indexer: schema.blocklist.indexer,
  seriesId: schema.blocklist.seriesId,
} as const;

const querySchema = pagingSchema.extend({
  sortKey: z.enum(['date', 'id', 'sourceTitle', 'indexer', 'seriesId']).default('date'),
});

const bulkSchema = z.object({ ids: z.array(z.number().int()).min(1).max(1000) });

export async function blocklistRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/blocklist', async (req): Promise<Paged<BlocklistResource>> => {
    const q = querySchema.parse(req.query);
    const total = app.db.select({ n: sql<number>`count(*)` }).from(schema.blocklist).get()?.n ?? 0;
    const dir = q.sortDirection === 'ascending' ? asc : desc;
    const rows = app.db
      .select()
      .from(schema.blocklist)
      .orderBy(dir(sortColumns[q.sortKey]), dir(schema.blocklist.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    return {
      page: q.page,
      pageSize: q.pageSize,
      sortKey: q.sortKey,
      sortDirection: q.sortDirection,
      totalRecords: total,
      records: rows.map(toBlocklistResource),
    };
  });

  app.delete('/api/v3/blocklist/bulk', async (req) => {
    const { ids } = bulkSchema.parse(req.body);
    const rows = app.db.delete(schema.blocklist).where(inArray(schema.blocklist.id, ids)).returning().all();
    for (const row of rows) {
      app.events.publish('blocklist', 'deleted', toBlocklistResource(row) as unknown as Record<string, unknown>);
    }
    return {};
  });

  app.delete<{ Params: { id: string } }>('/api/v3/blocklist/:id', async (req, reply) => {
    const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : -1;
    const row = app.db.delete(schema.blocklist).where(eq(schema.blocklist.id, id)).returning().get();
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    app.events.publish('blocklist', 'deleted', toBlocklistResource(row) as unknown as Record<string, unknown>);
    return {};
  });
}
