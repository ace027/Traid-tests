import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { HostConfig } from '@sonarr/shared';
import { resolveDataDir } from './config.js';
import { openDb, schema, type Db } from './db/index.js';
import { registerAuth } from './plugins/auth.js';
import { commandRoutes } from './routes/command.js';
import { configRoutes } from './routes/config.js';
import { eventRoutes } from './routes/events.js';
import { qualityRoutes } from './routes/quality.js';
import { rootFolderRoutes } from './routes/rootfolder.js';
import { readVersion, systemRoutes } from './routes/system.js';
import { tagRoutes } from './routes/tag.js';
import { CommandQueue } from './services/commands.js';
import { EventBus } from './services/events.js';
import { seed } from './services/seed.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    sqlite: import('better-sqlite3').Database;
    dataDir: string;
    events: EventBus;
    commands: CommandQueue;
  }
}

export interface BuildAppOptions {
  dataDir: string;
  logger?: boolean;
}

export function ensureHostConfig(db: Db): HostConfig {
  const row = db.select().from(schema.config).where(eq(schema.config.key, 'host')).get();
  if (row) return JSON.parse(row.value) as HostConfig;
  const host: HostConfig = {
    id: 1,
    bindAddress: '*',
    port: 8989,
    urlBase: '',
    instanceName: 'Sonarr',
    apiKey: randomBytes(16).toString('hex'),
    logLevel: 'info',
    launchBrowser: false,
  };
  db.insert(schema.config).values({ key: 'host', value: JSON.stringify(host) }).run();
  return host;
}

export function getHostConfig(db: Db): HostConfig {
  return ensureHostConfig(db);
}

export async function buildApp({ dataDir, logger = false }: BuildAppOptions): Promise<FastifyInstance> {
  const dir = resolveDataDir(dataDir);
  const startTime = new Date().toISOString();
  const app = Fastify({ logger });
  const { sqlite, db } = openDb(dir);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.decorate('dataDir', dir);
  ensureHostConfig(db);
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

  registerAuth(app, () => getHostConfig(db).apiKey);

  app.get('/ping', async () => ({ status: 'OK' }));
  // The bootstrap endpoint is unauthenticated, so the API key is only disclosed to
  // loopback clients (the local UI). Remote callers get the public fields only.
  const isLoopback = (ip: string) =>
    ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.') || ip.startsWith('127.');
  app.get('/initialize.json', async (request) => {
    const host = getHostConfig(db);
    return {
      apiKey: isLoopback(request.ip) ? host.apiKey : '',
      urlBase: host.urlBase,
      instanceName: host.instanceName,
      version: readVersion(),
    };
  });

  await app.register(systemRoutes, {
    dataDir: dir,
    version: readVersion(),
    startTime,
    getInstanceName: () => getHostConfig(db).instanceName,
    getUrlBase: () => getHostConfig(db).urlBase,
  });

  await app.register(rootFolderRoutes);
  await app.register(tagRoutes);
  await app.register(qualityRoutes);
  await app.register(configRoutes);
  await app.register(commandRoutes);
  await app.register(eventRoutes);

  commands.start();
  await app.ready();
  return app;
}
