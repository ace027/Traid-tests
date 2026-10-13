import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { validationError } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { deleteEpisodeFile, toApiEpisodeFile } from '../services/episodes.js';

const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

export async function episodeFileRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get<{ Querystring: { seriesId?: string; episodeFileIds?: string } }>('/api/v3/episodefile', async (req) => {
    const { seriesId, episodeFileIds } = req.query;
    if (episodeFileIds !== undefined) {
      const ids = episodeFileIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length > 5000 || ids.some((s) => !/^\d+$/.test(s))) {
        throw validationError('episodeFileIds', 'episodeFileIds must be a comma separated list of ids');
      }
      const out: ReturnType<typeof toApiEpisodeFile>[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const c = ids.slice(i, i + 500).map(Number);
        out.push(...db.select().from(schema.episodeFiles).where(inArray(schema.episodeFiles.id, c)).all().map(toApiEpisodeFile));
      }
      return out.sort((a, b) => a.id - b.id);
    }
    if (seriesId === undefined || !/^\d+$/.test(seriesId)) throw validationError('seriesId', 'seriesId is required');
    return db
      .select()
      .from(schema.episodeFiles)
      .where(eq(schema.episodeFiles.seriesId, Number(seriesId)))
      .orderBy(asc(schema.episodeFiles.seasonNumber), asc(schema.episodeFiles.relativePath))
      .all()
      .map(toApiEpisodeFile);
  });

  app.get<{ Params: { id: string } }>('/api/v3/episodefile/:id', async (req, reply) => {
    const row = db.select().from(schema.episodeFiles).where(eq(schema.episodeFiles.id, parseId(req.params.id))).get();
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toApiEpisodeFile(row);
  });

  app.delete<{ Params: { id: string } }>('/api/v3/episodefile/:id', async (req, reply) => {
    const res = deleteEpisodeFile(app, parseId(req.params.id));
    if (!res) return reply.code(404).send({ message: 'NotFound' });
    return reply.code(200).send({});
  });
}
