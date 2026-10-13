import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validationError } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { toApiEpisode } from '../services/episodes.js';

const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);
const MAX_IDS = 5000;

const updateEpisodeSchema = z.object({ monitored: z.boolean() });
const monitorSchema = z.object({
  episodeIds: z.array(z.number().int().positive()).max(MAX_IDS),
  monitored: z.boolean(),
});

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function episodeRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get<{ Querystring: { seriesId?: string; seasonNumber?: string; episodeIds?: string } }>(
    '/api/v3/episode',
    async (req) => {
      const { seriesId, seasonNumber, episodeIds } = req.query;
      if (episodeIds !== undefined) {
        const ids = episodeIds.split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length > MAX_IDS || ids.some((s) => !/^\d+$/.test(s))) {
          throw validationError('episodeIds', 'episodeIds must be a comma separated list of ids');
        }
        const rows = chunks(ids.map(Number), 500).flatMap((c) =>
          db.select().from(schema.episodes).where(inArray(schema.episodes.id, c)).all(),
        );
        rows.sort((a, b) => a.seriesId - b.seriesId || a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
        return rows.map(toApiEpisode);
      }
      if (seriesId === undefined || !/^\d+$/.test(seriesId)) {
        throw validationError('seriesId', 'seriesId is required');
      }
      const conds = [eq(schema.episodes.seriesId, Number(seriesId))];
      if (seasonNumber !== undefined) {
        if (!/^-?\d+$/.test(seasonNumber)) throw validationError('seasonNumber', 'seasonNumber must be an integer');
        conds.push(eq(schema.episodes.seasonNumber, Number(seasonNumber)));
      }
      return db
        .select()
        .from(schema.episodes)
        .where(and(...conds))
        .orderBy(asc(schema.episodes.seasonNumber), asc(schema.episodes.episodeNumber))
        .all()
        .map(toApiEpisode);
    },
  );

  app.put('/api/v3/episode/monitor', async (req) => {
    const { episodeIds, monitored } = monitorSchema.parse(req.body);
    const ids = [...new Set(episodeIds)];
    const updated = db.transaction((tx) => {
      for (const c of chunks(ids, 500)) {
        tx.update(schema.episodes).set({ monitored }).where(inArray(schema.episodes.id, c)).run();
      }
      return chunks(ids, 500).flatMap((c) => tx.select().from(schema.episodes).where(inArray(schema.episodes.id, c)).all());
    });
    if (updated.length) {
      app.events.publish('episode', 'updated', {
        episodeIds: updated.map((e) => e.id),
        seriesIds: [...new Set(updated.map((e) => e.seriesId))],
        monitored,
      });
    }
    return updated.map(toApiEpisode);
  });

  app.get<{ Params: { id: string } }>('/api/v3/episode/:id', async (req, reply) => {
    const row = db.select().from(schema.episodes).where(eq(schema.episodes.id, parseId(req.params.id))).get();
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toApiEpisode(row);
  });

  app.put<{ Params: { id: string } }>('/api/v3/episode/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const { monitored } = updateEpisodeSchema.parse(req.body);
    const row = db.update(schema.episodes).set({ monitored }).where(eq(schema.episodes.id, id)).returning().get();
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    const api = toApiEpisode(row);
    app.events.publish('episode', 'updated', api as unknown as Record<string, unknown>);
    return api;
  });
}
