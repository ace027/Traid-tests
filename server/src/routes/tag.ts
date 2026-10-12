import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { tagInputSchema, validationError, type Tag } from '@sonarr/shared';
import { schema } from '../db/index.js';

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  const find = (id: number) => app.db.select().from(schema.tags).where(eq(schema.tags.id, id)).get();
  const byLabel = (label: string) => app.db.select().from(schema.tags).where(eq(schema.tags.label, label)).get();
  const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);
  const all = (): Tag[] => app.db.select().from(schema.tags).orderBy(schema.tags.label).all();

  app.get('/api/v3/tag', async () => all());

  app.get('/api/v3/tag/detail', async () =>
    all().map((t) => ({
      ...t,
      seriesIds: [],
      notificationIds: [],
      indexerIds: [],
      downloadClientIds: [],
      importListIds: [],
      delayProfileIds: [],
      releaseProfileIds: [],
    })),
  );

  app.get<{ Params: { id: string } }>('/api/v3/tag/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return row;
  });

  app.post('/api/v3/tag', async (req, reply) => {
    const { label } = tagInputSchema.parse(req.body);
    if (byLabel(label)) throw validationError('label', 'Tag already exists');
    const row = app.db.insert(schema.tags).values({ label }).returning().get();
    app.events.publish('tag', 'created', row);
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>('/api/v3/tag/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const { label } = tagInputSchema.parse(req.body);
    if (!find(id)) return reply.code(404).send({ message: 'NotFound' });
    const dup = byLabel(label);
    if (dup && dup.id !== id) throw validationError('label', 'Tag already exists');
    const row = app.db.update(schema.tags).set({ label }).where(eq(schema.tags.id, id)).returning().get();
    app.events.publish('tag', 'updated', row);
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/v3/tag/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    app.db.delete(schema.tags).where(eq(schema.tags.id, row.id)).run();
    app.events.publish('tag', 'deleted', row);
    return reply.code(200).send({});
  });
}
