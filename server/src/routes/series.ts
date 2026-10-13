import type { FastifyInstance } from 'fastify';
import { addSeriesInputSchema, updateSeriesInputSchema, validationError } from '@sonarr/shared';
import { MetadataError } from '../services/metadata/types.js';
import { addSeries, deleteSeries, getSeries, listSeries, updateSeries } from '../services/series.js';

export async function seriesRoutes(app: FastifyInstance): Promise<void> {
  const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

  app.get<{ Querystring: { term?: string } }>('/api/v3/series/lookup', async (req, reply) => {
    const term = (req.query.term ?? '').trim();
    if (!term) throw validationError('term', 'Search term is required');
    try {
      return await app.metadata.search(term);
    } catch (e) {
      if (e instanceof MetadataError) return reply.code(503).send({ message: e.message });
      throw e;
    }
  });

  app.get('/api/v3/series', async () => listSeries(app.db));

  app.get<{ Params: { id: string } }>('/api/v3/series/:id', async (req, reply) => {
    const s = getSeries(app.db, parseId(req.params.id));
    if (!s) return reply.code(404).send({ message: 'NotFound' });
    return s;
  });

  app.post('/api/v3/series', async (req, reply) => {
    const input = addSeriesInputSchema.parse(req.body);
    return reply.code(201).send(await addSeries(app, input));
  });

  app.put<{ Params: { id: string } }>('/api/v3/series/:id', async (req, reply) => {
    const input = updateSeriesInputSchema.parse(req.body);
    const s = updateSeries(app, parseId(req.params.id), input);
    if (!s) return reply.code(404).send({ message: 'NotFound' });
    return s;
  });

  app.delete<{ Params: { id: string }; Querystring: { deleteFiles?: string } }>('/api/v3/series/:id', async (req, reply) => {
    const ok = deleteSeries(app, parseId(req.params.id), req.query.deleteFiles === 'true');
    if (!ok) return reply.code(404).send({ message: 'NotFound' });
    return reply.code(200).send({});
  });
}
