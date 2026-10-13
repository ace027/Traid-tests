import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { BackupResource, BackupType } from '@sonarr/shared';
import { readVersion } from '../routes/system.js';
import { readZip, writeZip, ZipError } from './zip.js';

export const BACKUP_TYPES: BackupType[] = ['manual', 'scheduled', 'update'];
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** Error with an HTTP status the global error handler passes through. */
export class BackupError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const backupsRoot = (app: Pick<FastifyInstance, 'dataDir'>) => path.join(app.dataDir, 'Backups');

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d: Date): string {
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}_${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

export function createBackup(app: FastifyInstance, type: 'manual' | 'scheduled', now: Date = new Date()): BackupResource {
  const version = readVersion();
  const tmpDir = path.join(app.dataDir, 'tmp');
  const destDir = path.join(backupsRoot(app), type);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });
  const tmpDb = path.join(tmpDir, `backup-${process.pid}-${Date.now()}.db`);
  const name = `sonarr_backup_v${version}_${stamp(now)}.zip`;
  const dest = path.join(destDir, name);
  const partial = `${dest}.tmp`; // not listed (no .zip suffix) until complete
  try {
    app.sqlite.prepare('VACUUM INTO ?').run(tmpDb);
    writeZip(partial, [
      { name: 'sonarr.db', data: fs.readFileSync(tmpDb) },
      { name: 'version.txt', data: Buffer.from(`${version}\n`) },
    ]);
    fs.renameSync(partial, dest);
  } finally {
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(partial, { force: true });
  }
  const resource = listBackups(app).find((b) => b.name === name && b.type === type);
  if (!resource) throw new BackupError('Backup was not created', 500);
  return resource;
}

/** Newest first. Ids are positions in the name-ascending order, so they are stable between calls. */
export function listBackups(app: Pick<FastifyInstance, 'dataDir'>): BackupResource[] {
  const found: { name: string; type: BackupType; size: number; time: string }[] = [];
  for (const type of BACKUP_TYPES) {
    const dir = path.join(backupsRoot(app), type);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // folder missing
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.zip')) continue;
      try {
        const st = fs.statSync(path.join(dir, name));
        if (st.isFile()) found.push({ name, type, size: st.size, time: st.mtime.toISOString() });
      } catch {
        // removed while listing
      }
    }
  }
  const asc = found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.type < b.type ? -1 : 1));
  const withIds = asc.map((b, i) => ({ id: i + 1, name: b.name, path: `${b.type}/${b.name}`, type: b.type, size: b.size, time: b.time }));
  return withIds.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : b.id - a.id));
}

/** Resolves a backup name against the listing only; user input is never joined into a path. */
export function backupPath(app: Pick<FastifyInstance, 'dataDir'>, name: string): string | undefined {
  const b = listBackups(app).find((x) => x.name === name);
  return b ? path.join(backupsRoot(app), b.type, b.name) : undefined;
}

export function deleteBackup(app: Pick<FastifyInstance, 'dataDir'>, name: string): boolean {
  const file = backupPath(app, name);
  if (!file) return false;
  fs.rmSync(file, { force: true });
  return true;
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

/** Returns why the database is not a Sonarr database this build can run, or undefined when it is fine. */
function checkSchema(db: Database.Database): string | undefined {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  for (const t of ['config', 'series', 'schema_migrations']) {
    if (!tables.has(t)) return 'not a Sonarr database';
  }
  const known = new Set(fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')));
  const applied = (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version);
  if (applied.some((v) => !known.has(v))) return 'database was created by a newer version';
  return undefined;
}

/**
 * Validates a backup (zip buffer or the name of a listed backup) and stages its database at
 * dataDir/restore/sonarr.db. openDb applies it on the next start.
 */
export function stageRestore(app: Pick<FastifyInstance, 'dataDir'>, source: Buffer | string): void {
  let zip: Buffer;
  if (typeof source === 'string') {
    const file = backupPath(app, source);
    if (!file) throw new BackupError('Backup not found', 404);
    zip = fs.readFileSync(file);
  } else {
    zip = source;
  }
  let db: Buffer | undefined;
  try {
    db = readZip(zip).find((e) => e.name === 'sonarr.db')?.data;
  } catch (e) {
    if (e instanceof ZipError) throw new BackupError(`Invalid backup: ${e.message}`);
    throw e;
  }
  if (!db) throw new BackupError('Invalid backup: sonarr.db is missing');
  if (db.length < 16 || !db.subarray(0, 16).equals(SQLITE_MAGIC)) throw new BackupError('Invalid backup: not a SQLite database');

  const dir = path.join(app.dataDir, 'restore');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'sonarr.db.tmp');
  fs.writeFileSync(tmp, db);
  let ok = false;
  let schemaProblem: string | undefined;
  try {
    const check = new Database(tmp, { readonly: true });
    try {
      const rows = check.pragma('integrity_check') as { integrity_check: string }[];
      ok = rows.length === 1 && rows[0]!.integrity_check === 'ok';
      if (ok) schemaProblem = checkSchema(check);
    } finally {
      check.close();
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    fs.rmSync(tmp, { force: true });
    throw new BackupError('Invalid backup: database failed the integrity check');
  }
  if (schemaProblem) {
    fs.rmSync(tmp, { force: true });
    throw new BackupError(`Invalid backup: ${schemaProblem}`);
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${tmp}${ext}`, { force: true });
  fs.renameSync(tmp, path.join(dir, 'sonarr.db'));
}

export function registerBackupCommand(app: FastifyInstance): void {
  app.commands.register('Backup', async (ctx) => {
    const type = ctx.body.type === 'manual' ? 'manual' : 'scheduled';
    const b = createBackup(app, type);
    ctx.updateMessage(`Created ${b.name}`);
    app.events.publish('backup', 'created', b as unknown as Record<string, unknown>);
  });
  // onListen only fires for a real server (index.ts), so buildApp-based tests keep the 4 default tasks.
  app.addHook('onListen', async () => {
    app.scheduler.ensureTask('Backup', 'Backup', 10080);
  });
}
