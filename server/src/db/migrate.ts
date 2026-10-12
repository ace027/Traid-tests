import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies unapplied migrations in name order; returns the versions applied now. */
export function migrate(sqlite: Database.Database, dir: string = migrationsDir): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT)',
  );
  const applied = new Set(
    (sqlite.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (r) => r.version,
    ),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const done: string[] = [];
  const record = sqlite.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      record.run(version, new Date().toISOString());
    })();
    done.push(version);
  }
  return done;
}
