import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  downloadClientConfigSchema,
  mediaManagementConfigSchema,
  namingConfigSchema,
  type NamingConfig,
} from '@sonarr/shared';
import { validateNaming, getNamingExamples } from '../naming/naming.js';
import {
  getDownloadClientConfig,
  getMediaManagementConfig,
  getNamingConfig,
  saveDownloadClientConfig,
  saveMediaManagementConfig,
  saveNamingConfig,
} from '../services/mediaConfig.js';

const mediaManagementUpdate = mediaManagementConfigSchema.partial();
const namingUpdate = namingConfigSchema.partial();
const downloadClientUpdate = downloadClientConfigSchema.partial();

/** Drops keys that are undefined so a partial update never overwrites a value with undefined. */
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function assertValidNaming(naming: NamingConfig): void {
  const result = validateNaming(naming);
  if (!result.valid) {
    throw new ZodError(
      result.errors.map((e) => ({ code: 'custom' as const, path: [e.propertyName], message: e.errorMessage, input: undefined })),
    );
  }
}

export async function mediaConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/config/mediamanagement', async () => getMediaManagementConfig(app.db));
  app.put('/api/v3/config/mediamanagement', async (req) => {
    const body = mediaManagementUpdate.parse(req.body);
    const saved = saveMediaManagementConfig(app.db, { ...getMediaManagementConfig(app.db), ...defined(body) });
    app.events.publish('config', 'updated', { name: 'mediamanagement' });
    return saved;
  });

  app.get('/api/v3/config/naming', async () => getNamingConfig(app.db));
  app.put('/api/v3/config/naming', async (req) => {
    const body = namingUpdate.parse(req.body);
    const next = namingConfigSchema.parse({ ...getNamingConfig(app.db), ...defined(body) });
    assertValidNaming(next);
    const saved = saveNamingConfig(app.db, next);
    app.events.publish('config', 'updated', { name: 'naming' });
    return saved;
  });
  // Previews formats (including unsaved ones passed as query parameters) against fixed sample data.
  app.get('/api/v3/config/naming/examples', async (req) => {
    const query = namingUpdate.parse(req.query);
    const naming = namingConfigSchema.parse({ ...getNamingConfig(app.db), ...defined(query) });
    return getNamingExamples(naming);
  });

  app.get('/api/v3/config/downloadclient', async () => getDownloadClientConfig(app.db));
  app.put('/api/v3/config/downloadclient', async (req) => {
    const body = downloadClientUpdate.parse(req.body);
    const saved = saveDownloadClientConfig(app.db, { ...getDownloadClientConfig(app.db), ...defined(body) });
    app.events.publish('config', 'updated', { name: 'downloadclient' });
    return saved;
  });
}
