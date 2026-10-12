import fs from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { SystemStatus } from '@sonarr/shared';

export interface SystemRouteOptions {
  dataDir: string;
  version: string;
  startTime: string;
  getInstanceName: () => string;
  getUrlBase: () => string;
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
      authentication: 'none',
      urlBase: opts.getUrlBase(),
      startTime: opts.startTime,
    };
  });
}
