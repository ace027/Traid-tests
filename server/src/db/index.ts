import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { resolveDataDir } from '../config.js';
import { migrate } from './migrate.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  sqlite: Database.Database;
  db: Db;
}

/**
 * Applies a restore staged at dataDir/restore/sonarr.db: the current database is kept as
 * sonarr.db.pre-restore, its WAL/SHM files are dropped and the staged file takes its place.
 */
export function applyStagedRestore(dir: string): boolean {
  const staged = path.join(dir, 'restore', 'sonarr.db');
  if (!fs.existsSync(staged)) return false;
  const current = path.join(dir, 'sonarr.db');
  if (fs.existsSync(current)) fs.renameSync(current, `${current}.pre-restore`);
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${current}${ext}`, { force: true });
  fs.renameSync(staged, current);
  return true;
}

export function openDb(dataDir: string): DbHandle {
  const dir = resolveDataDir(dataDir);
  applyStagedRestore(dir);
  const sqlite = new Database(path.join(dir, 'sonarr.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export { schema };
