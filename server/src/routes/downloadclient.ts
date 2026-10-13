import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  downloadClientInputSchema,
  downloadClientSettingsSchema,
  validationError,
  type DownloadClientImplementation,
  type DownloadClientInput,
  type DownloadClientResource,
  type DownloadClientSettings,
} from '@sonarr/shared';
import { schema } from '../db/index.js';
import {
  clientConfigFromRow,
  createClient,
  normalizeImplementation,
  protocolFor,
  type DownloadClientRow,
} from '../downloadClients/registry.js';
import { registerQueueRoutes } from '../services/queue.js';

const MASK = '********';

const idSchema = z.coerce.number().int();

const testBodySchema = downloadClientInputSchema.extend({ id: z.number().int().optional() });

function mask(settings: DownloadClientSettings): DownloadClientSettings {
  return {
    ...settings,
    password: settings.password ? MASK : '',
    apiKey: settings.apiKey ? MASK : '',
  };
}

function toResource(row: DownloadClientRow, masked = true): DownloadClientResource {
  const settings = clientConfigFromRow(row).settings;
  const implementation = normalizeImplementation(row.implementation);
  return {
    id: row.id,
    name: row.name,
    implementation,
    protocol: protocolFor(implementation),
    enable: row.enable,
    priority: row.priority,
    removeCompletedDownloads: row.removeCompletedDownloads,
    removeFailedDownloads: row.removeFailedDownloads,
    tags: JSON.parse(row.tags) as number[],
    settings: masked ? mask(settings) : settings,
  };
}

const TEMPLATES: { implementation: DownloadClientImplementation; settings: Partial<DownloadClientSettings> }[] = [
  { implementation: 'SABnzbd', settings: { port: 8080, category: 'tv' } },
  { implementation: 'NZBGet', settings: { port: 6789, username: 'nzbget', category: 'tv' } },
  { implementation: 'QBittorrent', settings: { port: 8080, category: 'tv-sonarr' } },
  { implementation: 'Transmission', settings: { port: 9091, urlBase: '/transmission/', category: 'tv-sonarr' } },
];

/** Keeps stored secrets where the client sent the mask back. */
function unmask(settings: DownloadClientSettings, stored?: DownloadClientSettings): DownloadClientSettings {
  return {
    ...settings,
    password: settings.password === MASK ? (stored?.password ?? '') : settings.password,
    apiKey: settings.apiKey === MASK ? (stored?.apiKey ?? '') : settings.apiKey,
  };
}

export async function downloadClientRoutes(app: FastifyInstance): Promise<void> {
  const find = (id: number) => app.db.select().from(schema.downloadClients).where(eq(schema.downloadClients.id, id)).get();
  const parseId = (raw: string): number => {
    const r = idSchema.safeParse(raw);
    return r.success ? r.data : -1;
  };

  function checkInput(input: DownloadClientInput, selfId?: number): void {
    const dup = app.db.select().from(schema.downloadClients).where(eq(schema.downloadClients.name, input.name)).get();
    if (dup && dup.id !== selfId) throw validationError('name', 'Name must be unique');
    if (input.tags.length > 0) {
      const known = new Set(app.db.select({ id: schema.tags.id }).from(schema.tags).all().map((t) => t.id));
      const missing = input.tags.filter((t) => !known.has(t));
      if (missing.length > 0) throw validationError('tags', `Tag ${missing[0]} does not exist`);
    }
  }

  const values = (input: DownloadClientInput, settings: DownloadClientSettings) => ({
    name: input.name,
    implementation: input.implementation.toLowerCase(),
    protocol: protocolFor(input.implementation),
    enable: input.enable,
    priority: input.priority,
    removeCompletedDownloads: input.removeCompletedDownloads,
    removeFailedDownloads: input.removeFailedDownloads,
    settings: JSON.stringify(settings),
    tags: JSON.stringify([...new Set(input.tags)]),
  });

  async function runTest(input: DownloadClientInput, id?: number): Promise<void> {
    const stored = id !== undefined ? find(id) : undefined;
    const settings = unmask(input.settings, stored ? clientConfigFromRow(stored).settings : undefined);
    await createClient({ implementation: input.implementation, settings }).test();
  }

  app.get('/api/v3/downloadclient', async () =>
    app.db
      .select()
      .from(schema.downloadClients)
      .orderBy(schema.downloadClients.id)
      .all()
      .map((r) => toResource(r)),
  );

  app.get('/api/v3/downloadclient/schema', async () =>
    TEMPLATES.map((t) => ({
      name: '',
      implementation: t.implementation,
      protocol: protocolFor(t.implementation),
      enable: true,
      priority: 1,
      removeCompletedDownloads: true,
      removeFailedDownloads: true,
      tags: [] as number[],
      settings: { ...downloadClientSettingsSchema.parse({ host: 'localhost', port: 1 }), host: '', ...t.settings },
    })),
  );

  app.get<{ Params: { id: string } }>('/api/v3/downloadclient/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toResource(row);
  });

  app.post('/api/v3/downloadclient', async (req, reply) => {
    const input = downloadClientInputSchema.parse(req.body);
    checkInput(input);
    const row = app.db.insert(schema.downloadClients).values(values(input, input.settings)).returning().get();
    const resource = toResource(row);
    app.events.publish('downloadclient', 'created', resource as unknown as Record<string, unknown>);
    return reply.code(201).send(resource);
  });

  app.put<{ Params: { id: string } }>('/api/v3/downloadclient/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const input = downloadClientInputSchema.parse(req.body);
    const existing = find(id);
    if (!existing) return reply.code(404).send({ message: 'NotFound' });
    checkInput(input, id);
    const settings = unmask(input.settings, clientConfigFromRow(existing).settings);
    const row = app.db
      .update(schema.downloadClients)
      .set(values(input, settings))
      .where(eq(schema.downloadClients.id, id))
      .returning()
      .get();
    const resource = toResource(row);
    app.events.publish('downloadclient', 'updated', resource as unknown as Record<string, unknown>);
    return resource;
  });

  app.delete<{ Params: { id: string } }>('/api/v3/downloadclient/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    app.db.delete(schema.downloadClients).where(eq(schema.downloadClients.id, row.id)).run();
    app.events.publish('downloadclient', 'deleted', toResource(row) as unknown as Record<string, unknown>);
    return reply.code(200).send({});
  });

  app.post('/api/v3/downloadclient/test', async (req) => {
    const { id, ...input } = testBodySchema.parse(req.body);
    try {
      await runTest(input, id);
    } catch (err) {
      throw validationError('', err instanceof Error ? err.message : 'Test failed');
    }
    return {};
  });

  app.post('/api/v3/downloadclient/testall', async (_req, reply) => {
    const rows = app.db.select().from(schema.downloadClients).orderBy(schema.downloadClients.id).all();
    const results = await Promise.all(
      rows.map(async (row) => {
        try {
          await createClient(row).test();
          return { id: row.id, isValid: true, validationFailures: [] as { propertyName: string; errorMessage: string }[] };
        } catch (err) {
          return {
            id: row.id,
            isValid: false,
            validationFailures: [{ propertyName: '', errorMessage: err instanceof Error ? err.message : 'Test failed' }],
          };
        }
      }),
    );
    return reply.code(200).send(results);
  });

  registerQueueRoutes(app);
}
