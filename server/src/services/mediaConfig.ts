import { eq } from 'drizzle-orm';
import {
  downloadClientConfigSchema,
  mediaManagementConfigSchema,
  namingConfigSchema,
  type DownloadClientConfig,
  type MediaManagementConfig,
  type NamingConfig,
} from '@sonarr/shared';
import type { z } from 'zod';
import { schema, type Db } from '../db/index.js';

function load<S extends z.ZodType>(db: Db, key: string, s: S): z.infer<S> {
  const row = db.select().from(schema.config).where(eq(schema.config.key, key)).get();
  if (row) {
    try {
      const parsed = s.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data;
    } catch {
      // corrupt row: fall back to defaults
    }
  }
  return s.parse({});
}

function save<S extends z.ZodType>(db: Db, key: string, s: S, value: unknown): z.infer<S> {
  const next = s.parse(value);
  const json = JSON.stringify(next);
  db.insert(schema.config)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: schema.config.key, set: { value: json } })
    .run();
  return next;
}

export const getMediaManagementConfig = (db: Db): MediaManagementConfig => load(db, 'mediamanagement', mediaManagementConfigSchema);
export const saveMediaManagementConfig = (db: Db, v: unknown): MediaManagementConfig => save(db, 'mediamanagement', mediaManagementConfigSchema, v);
export const getNamingConfig = (db: Db): NamingConfig => load(db, 'naming', namingConfigSchema);
export const saveNamingConfig = (db: Db, v: unknown): NamingConfig => save(db, 'naming', namingConfigSchema, v);
export const getDownloadClientConfig = (db: Db): DownloadClientConfig => load(db, 'downloadclientconfig', downloadClientConfigSchema);
export const saveDownloadClientConfig = (db: Db, v: unknown): DownloadClientConfig => save(db, 'downloadclientconfig', downloadClientConfigSchema, v);
