import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { HOST_CONFIG_DEFAULTS, hostConfigSchema, type HostConfig } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';

const HOST_KEY = 'host';
/** The password hash lives under its own key so it never travels with the host config. */
const PASSWORD_KEY = 'password';

export const generateApiKey = () => randomBytes(16).toString('hex');

function readKey(db: Db, key: string): string | undefined {
  return db.select().from(schema.config).where(eq(schema.config.key, key)).get()?.value;
}

function writeKey(db: Db, key: string, value: string): void {
  db.insert(schema.config)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.config.key, set: { value } })
    .run();
}

/**
 * Reads the stored host config, validating every field with the zod schema. Invalid or
 * missing fields fall back to their defaults; a missing or empty API key is regenerated.
 * The repaired config is persisted. `password` is always ''.
 */
export function ensureHostConfig(db: Db): HostConfig {
  const raw = readKey(db, HOST_KEY);
  let stored: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
    } catch {
      stored = {};
    }
  }

  const shape = hostConfigSchema.shape;
  const out: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries({ ...HOST_CONFIG_DEFAULTS, apiKey: '' })) {
    const field = shape[key as keyof typeof shape];
    const result = field.safeParse(stored[key]);
    out[key] = result.success ? result.data : fallback;
  }
  if (typeof out.apiKey !== 'string' || !out.apiKey) out.apiKey = generateApiKey();
  out.password = '';
  const host = hostConfigSchema.parse(out);

  const serialized = serializeHost(host);
  if (serialized !== raw) writeKey(db, HOST_KEY, serialized);
  return host;
}

export function getHostConfig(db: Db): HostConfig {
  return ensureHostConfig(db);
}

function serializeHost(host: HostConfig): string {
  const { password: _password, ...rest } = host;
  return JSON.stringify(rest);
}

/** Persists the host config. The password field is never written here. */
export function saveHostConfig(db: Db, host: HostConfig): void {
  writeKey(db, HOST_KEY, serializeHost(host));
}

/** The stored `scrypt$N$salt$hash` string, or null when no password has been set. */
export function getPasswordHash(db: Db): string | null {
  const value = readKey(db, PASSWORD_KEY);
  return value ? value : null;
}

export function setPasswordHash(db: Db, hash: string): void {
  writeKey(db, PASSWORD_KEY, hash);
}
