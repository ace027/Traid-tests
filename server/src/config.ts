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

export interface ListenOptions {
  host: string;
  port: number;
}

/** SONARR_PORT wins only when it is a valid port; '*' binds every IPv4 interface. */
export function resolveListenOptions(
  host: { bindAddress: string; port: number },
  env: NodeJS.ProcessEnv = process.env,
): ListenOptions {
  const raw = env.SONARR_PORT?.trim() ?? '';
  const envPort = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const port = Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : host.port;
  const address = host.bindAddress.trim();
  return { host: address === '*' || address === '' ? '0.0.0.0' : address, port };
}
