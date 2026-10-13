import fs from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { AuthenticationMethod, ScheduledTaskResource, SystemStatus } from '@sonarr/shared';
import { toScheduledTaskResource } from '../services/scheduler.js';

export interface SystemRouteOptions {
  dataDir: string;
  version: string;
  startTime: string;
  getInstanceName: () => string;
  getUrlBase: () => string;
  getAuthMethod: () => AuthenticationMethod;
}

export function readVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return pkg.version;
}

export async function systemRoutes(app: FastifyInstance, opts: SystemRouteOptions): Promise<void> {
  app.get('/api/v3/system/status', async (): Promise<SystemStatus> => {
    const row = app.sqlite.prepare('select sqlite_version() as v').get() as { v: string };
    return {
      appName: 'Sonarr',
      instanceName: opts.getInstanceName(),
      version: opts.version,
      buildTime: opts.startTime,
      isDebug: process.env.NODE_ENV !== 'production',
      isProduction: process.env.NODE_ENV === 'production',
      startupPath: process.cwd(),
      appData: opts.dataDir,
      osName: os.type().toLowerCase(),
      runtimeVersion: process.versions.node,
      databaseType: 'sqlite',
      databaseVersion: row.v,
      authentication: opts.getAuthMethod(),
      urlBase: opts.getUrlBase(),
      startTime: opts.startTime,
    };
  });

  app.get('/api/v3/system/task', async (): Promise<ScheduledTaskResource[]> =>
    app.scheduler.listTasks().map(toScheduledTaskResource),
  );

  app.get<{ Params: { name: string } }>('/api/v3/system/task/:name', async (req, reply) => {
    const row = app.scheduler.getTask(req.params.name);
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toScheduledTaskResource(row);
  });
}
