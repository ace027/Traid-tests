import fs from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  dataDir: string;
  port: number;
}

export function resolveDataDir(dir?: string): string {
  const resolved = path.resolve(dir ?? process.env.SONARR_DATA ?? './data');
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.SONARR_PORT);
  return {
    dataDir: resolveDataDir(env.SONARR_DATA),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8989,
  };
}
