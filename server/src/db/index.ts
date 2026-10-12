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

export function openDb(dataDir: string): DbHandle {
  const dir = resolveDataDir(dataDir);
  const sqlite = new Database(path.join(dir, 'sonarr.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export { schema };
