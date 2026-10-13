import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { HostConfig } from '@sonarr/shared';
import { resolveDataDir } from './config.js';
import { openDb, type Db } from './db/index.js';
import { registerAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { commandRoutes } from './routes/command.js';
import { configRoutes } from './routes/config.js';
import { eventRoutes } from './routes/events.js';
import { qualityRoutes } from './routes/quality.js';
import { rootFolderRoutes } from './routes/rootfolder.js';
import { seriesRoutes } from './routes/series.js';
import { readVersion, systemRoutes } from './routes/system.js';
import { tagRoutes } from './routes/tag.js';
import { AuthService } from './services/auth.js';
import { CommandQueue } from './services/commands.js';
import { EventBus } from './services/events.js';
import { ensureHostConfig, getHostConfig, saveHostConfig } from './services/hostConfig.js';
import type { MetadataProvider } from './services/metadata/types.js';
import { TvMazeProvider } from './services/metadata/tvmaze.js';
import { seed } from './services/seed.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    sqlite: import('better-sqlite3').Database;
    dataDir: string;
    events: EventBus;
    commands: CommandQueue;
    auth: AuthService;
    metadata: MetadataProvider;
    /** Applies an update to the host config, persists it, refreshes the auth cache and publishes an event. */
    updateHostConfig: (update: (host: HostConfig) => HostConfig) => HostConfig;
  }
}

export interface BuildAppOptions {
  dataDir: string;
  logger?: boolean;
  metadataProvider?: MetadataProvider;
}

export { ensureHostConfig, getHostConfig };

/** Requests outside the URL base are rewritten here; no route serves it, so they 404. */
export const OUTSIDE_URL_BASE = '/__outside_url_base__';

/**
 * Strips a normalized URL base from a request URL: '/base' and '/base/' map to '/', '/base?x' to
 * '/?x' and '/base/a?b' to '/a?b'. Anything else (including '/basement') maps to OUTSIDE_URL_BASE.
 */
export function stripUrlBase(url: string, base: string): string {
  if (!base) return url;
  if (url !== base && !url.startsWith(`${base}/`) && !url.startsWith(`${base}?`)) return OUTSIDE_URL_BASE;
  const rest = url.slice(base.length);
  if (rest === '') return '/';
  return rest.startsWith('?') ? `/${rest}` : rest;
}

/** Hides the API key in logged URLs. */
export function redactUrl(url: string): string;
export function redactUrl(url: unknown): unknown;
export function redactUrl(url: unknown): unknown {
  return typeof url === 'string' ? url.replace(/([?&]apikey=)[^&#]*/gi, '$1***') : url;
}

const isPing = (url: string) => url === '/ping' || url.startsWith('/ping?');

export async function buildApp({ dataDir, logger = false, metadataProvider }: BuildAppOptions): Promise<FastifyInstance> {
  const dir = resolveDataDir(dataDir);
  const startTime = new Date().toISOString();
  const { sqlite, db } = openDb(dir);
  // The URL base is read once at build time; changing it needs a restart.
  const urlBase = ensureHostConfig(db).urlBase;
  const app = Fastify({
    logger: logger
      ? {
          serializers: {
            req: (req) => ({
              method: req.method,
              url: redactUrl(String(req.url)),
              host: req.host,
              remoteAddress: req.ip,
              remotePort: req.socket?.remotePort,
            }),
            url: (url: unknown) => redactUrl(url),
            originalUrl: (url: unknown) => redactUrl(url),
          },
        }
      : false,
    rewriteUrl: (req) => {
      const url = req.url ?? '/';
      // /ping is served at the root as well as under the base (health checks).
      return urlBase && isPing(url) ? url : stripUrlBase(url, urlBase);
    },
  });
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.decorate('dataDir', dir);
  app.decorate('metadata', metadataProvider ?? new TvMazeProvider());
  seed(db);

  const events = new EventBus();
  const commands = new CommandQueue(db, events);
  commands.register('Housekeeping', async () => {});
  app.decorate('events', events);
  app.decorate('commands', commands);
  app.addHook('onClose', async () => {
    await commands.close();
    sqlite.close();
  });

  const auth = new AuthService(db);
  app.decorate('auth', auth);
  app.decorate('updateHostConfig', (update: (host: HostConfig) => HostConfig): HostConfig => {
    const next: HostConfig = { ...update(getHostConfig(db)), id: 1, password: '' };
    saveHostConfig(db, next);
    auth.invalidate();
    events.publish('hostconfig', 'updated', { ...next, apiKey: undefined, password: undefined });
    return next;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: 'Validation failed',
        errors: error.issues.map((i) => ({
          propertyName: i.path.join('.'),
          errorMessage: i.message,
        })),
      });
    }
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({ message: status >= 500 ? 'Internal Server Error' : err.message });
  });
  // Same body as the routes' own 404s; never echoes the (possibly rewritten) path.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ message: 'NotFound' }));

  registerAuth(app, auth);

  app.get('/ping', async () => ({ status: 'OK' }));

  await app.register(authRoutes, {
    auth,
    version: readVersion(),
    getInstanceName: () => getHostConfig(db).instanceName,
  });

  await app.register(systemRoutes, {
    dataDir: dir,
    version: readVersion(),
    startTime,
    getInstanceName: () => getHostConfig(db).instanceName,
    getUrlBase: () => getHostConfig(db).urlBase,
    getAuthMethod: () => auth.settings().method,
  });

  await app.register(rootFolderRoutes);
  await app.register(tagRoutes);
  await app.register(seriesRoutes);
  await app.register(qualityRoutes);
  await app.register(configRoutes);
  await app.register(commandRoutes);
  await app.register(eventRoutes);

  commands.start();
  await app.ready();
  return app;
}
