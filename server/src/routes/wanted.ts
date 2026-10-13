import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Paged, WantedRecord } from '@sonarr/shared';
import { listCutoffUnmet, listMissing } from '../services/wanted.js';
import { pagingSchema } from './history.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const querySchema = pagingSchema.extend({
  sortKey: z.enum(['airDateUtc', 'series.sortTitle', 'episodeTitle']).default('airDateUtc'),
  monitored: bool.default(true),
  includeSeries: bool.default(true),
});

export async function wantedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/wanted/missing', async (req): Promise<Paged<WantedRecord>> => listMissing(app, querySchema.parse(req.query)));
  app.get('/api/v3/wanted/cutoff', async (req): Promise<Paged<WantedRecord>> => listCutoffUnmet(app, querySchema.parse(req.query)));
}
