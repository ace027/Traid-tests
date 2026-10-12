import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hostConfigSchema, uiConfigSchema, validationError, type HostConfig } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { getHostConfig } from '../app.js';
import { getUiConfig } from '../services/seed.js';

const hostUpdateSchema = hostConfigSchema.partial();
const uiUpdateSchema = uiConfigSchema.partial();

export async function configRoutes(app: FastifyInstance): Promise<void> {
  const saveHost = (host: HostConfig) =>
    app.db.update(schema.config).set({ value: JSON.stringify(host) }).where(eq(schema.config.key, 'host')).run();

  app.get('/api/v3/config/host', async () => getHostConfig(app.db));

  app.put('/api/v3/config/host', async (req) => {
    const body = hostUpdateSchema.parse(req.body);
    if (body.urlBase !== undefined && body.urlBase !== '' && !body.urlBase.startsWith('/')) {
      throw validationError('urlBase', "URL base must be empty or start with '/'");
    }
    const current = getHostConfig(app.db);
    // The API key and id are never changed through PUT.
    const next: HostConfig = { ...current, ...body, id: 1, apiKey: current.apiKey };
    saveHost(next);
    app.events.publish('hostconfig', 'updated', { ...next, apiKey: undefined });
    return next;
  });

  app.post('/api/v3/config/host/apikey/reset', async () => {
    const next: HostConfig = { ...getHostConfig(app.db), apiKey: randomBytes(16).toString('hex') };
    saveHost(next);
    app.events.publish('hostconfig', 'updated', { ...next, apiKey: undefined });
    return next;
  });

  app.get('/api/v3/config/ui', async () => getUiConfig(app.db));

  app.put('/api/v3/config/ui', async (req) => {
    const body = uiUpdateSchema.parse(req.body);
    const next = { ...getUiConfig(app.db), ...body, id: 1 as const };
    app.db
      .insert(schema.config)
      .values({ key: 'ui', value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: schema.config.key, set: { value: JSON.stringify(next) } })
      .run();
    app.events.publish('uiconfig', 'updated', next);
    return next;
  });
}
