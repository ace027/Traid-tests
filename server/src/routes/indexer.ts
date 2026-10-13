import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  indexerInputSchema,
  validationError,
  type IndexerImplementation,
  type IndexerInput,
  type IndexerResource,
} from '@sonarr/shared';
import { schema } from '../db/index.js';
import {
  createIndexerClient,
  getIndexerStatus,
  recordFailure,
  recordSuccess,
} from '../indexers/registry.js';
import { defaultCategories, parseIndexerSettings, protocolFor, redactSecret, type IndexerRow } from '../indexers/types.js';

const MASK = '********';

export async function indexerRoutes(app: FastifyInstance): Promise<void> {
  const find = (id: number) => app.db.select().from(schema.indexers).where(eq(schema.indexers.id, id)).get();
  const byName = (name: string) => app.db.select().from(schema.indexers).where(eq(schema.indexers.name, name)).get();
  const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

  const toResource = (row: IndexerRow): IndexerResource => ({
    id: row.id,
    name: row.name,
    implementation: capitalise(row.implementation),
    protocol: protocolFor(row.implementation),
    enableRss: row.enableRss,
    enableAutomaticSearch: row.enableAutomaticSearch,
    enableInteractiveSearch: row.enableInteractiveSearch,
    priority: row.priority,
    tags: JSON.parse(row.tags) as number[],
    settings: { ...parseIndexerSettings(row), apiKey: MASK },
  });

  function checkTags(tags: number[]): void {
    const existing = new Set(app.db.select({ id: schema.tags.id }).from(schema.tags).all().map((t) => t.id));
    for (const id of tags) if (!existing.has(id)) throw validationError('tags', `Tag ${id} does not exist`);
  }

  /** Normalises input into column values; a masked apiKey falls back to `storedKey`. */
  function toColumns(input: IndexerInput, storedKey: string | undefined) {
    const apiKey = input.settings.apiKey === MASK ? (storedKey ?? '') : input.settings.apiKey;
    const settings = {
      ...input.settings,
      apiKey,
      categories: input.settings.categories ?? defaultCategories(input.implementation),
    };
    return {
      name: input.name,
      implementation: input.implementation.toLowerCase(),
      enableRss: input.enableRss,
      enableAutomaticSearch: input.enableAutomaticSearch,
      enableInteractiveSearch: input.enableInteractiveSearch,
      priority: input.priority,
      tags: JSON.stringify([...new Set(input.tags)]),
      settings: JSON.stringify(settings),
    };
  }

  const publish = (action: 'created' | 'updated' | 'deleted', row: IndexerRow) =>
    app.events.publish('indexer', action, toResource(row) as unknown as Record<string, unknown>);

  app.get('/api/v3/indexer', async () => app.db.select().from(schema.indexers).orderBy(schema.indexers.name).all().map(toResource));

  app.get('/api/v3/indexer/schema', async () => {
    const template = (implementation: IndexerImplementation, categories: number[], minimumSeeders: number) => ({
      implementation,
      implementationName: implementation,
      protocol: protocolFor(implementation),
      name: '',
      enableRss: true,
      enableAutomaticSearch: true,
      enableInteractiveSearch: true,
      priority: 25,
      tags: [] as number[],
      settings: {
        baseUrl: '',
        apiPath: '/api',
        apiKey: '',
        categories,
        animeCategories: [5070],
        minimumSeeders,
        seedRatio: null,
        seedTime: null,
      },
    });
    return [template('Newznab', [5030, 5040], 1), template('Torznab', [5000], 1)];
  });

  app.get('/api/v3/indexerstatus', async () =>
    getIndexerStatus().map((s) => ({
      indexerId: s.indexerId,
      disabledTill: s.disabledTill,
      mostRecentFailure: s.mostRecentFailure,
    })),
  );

  async function runTest(row: IndexerRow): Promise<string | null> {
    const secret = parseIndexerSettings(row).apiKey;
    try {
      await createIndexerClient(row).test();
      return null;
    } catch (e) {
      return redactSecret((e as Error).message || 'Test failed', secret);
    }
  }

  app.post('/api/v3/indexer/test', async (req, reply) => {
    const body = (req.body ?? {}) as { id?: unknown };
    const input = indexerInputSchema.parse(req.body);
    const id = typeof body.id === 'number' ? body.id : 0;
    const stored = id ? find(id) : undefined;
    const cols = toColumns(input, stored ? parseIndexerSettings(stored).apiKey : undefined);
    const row: IndexerRow = { id, ...cols, added: new Date().toISOString() };
    const failure = await runTest(row);
    if (failure) return reply.code(400).send({ message: failure });
    return {};
  });

  app.post('/api/v3/indexer/testall', async () => {
    const results: { id: number; isValid: boolean; validationFailures: { propertyName: string; errorMessage: string }[] }[] = [];
    for (const row of app.db.select().from(schema.indexers).orderBy(schema.indexers.id).all()) {
      const failure = await runTest(row);
      if (failure) recordFailure(row.id, failure);
      else recordSuccess(row.id);
      results.push({
        id: row.id,
        isValid: !failure,
        validationFailures: failure ? [{ propertyName: '', errorMessage: failure }] : [],
      });
    }
    return results;
  });

  app.get<{ Params: { id: string } }>('/api/v3/indexer/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toResource(row);
  });

  app.post('/api/v3/indexer', async (req, reply) => {
    const input = indexerInputSchema.parse(req.body);
    if (byName(input.name)) throw validationError('name', 'Name must be unique');
    checkTags(input.tags);
    const row = app.db
      .insert(schema.indexers)
      .values({ ...toColumns(input, undefined), added: new Date().toISOString() })
      .returning()
      .get();
    publish('created', row);
    return reply.code(201).send(toResource(row));
  });

  app.put<{ Params: { id: string } }>('/api/v3/indexer/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const input = indexerInputSchema.parse(req.body);
    const existing = find(id);
    if (!existing) return reply.code(404).send({ message: 'NotFound' });
    const dup = byName(input.name);
    if (dup && dup.id !== id) throw validationError('name', 'Name must be unique');
    checkTags(input.tags);
    const row = app.db
      .update(schema.indexers)
      .set(toColumns(input, parseIndexerSettings(existing).apiKey))
      .where(eq(schema.indexers.id, id))
      .returning()
      .get();
    publish('updated', row);
    return toResource(row);
  });

  app.delete<{ Params: { id: string } }>('/api/v3/indexer/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    app.db.delete(schema.indexers).where(eq(schema.indexers.id, row.id)).run();
    recordSuccess(row.id);
    publish('deleted', row);
    return reply.code(200).send({});
  });
}

function capitalise(impl: string): IndexerImplementation {
  return (impl.toLowerCase() === 'torznab' ? 'Torznab' : 'Newznab') as IndexerImplementation;
}
