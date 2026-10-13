import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray, lt, and, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema } from '../db/index.js';
import { backupsRoot } from './backup.js';
import { getMediaManagementConfig } from './mediaConfig.js';

const DAY = 24 * 3600 * 1000;
const COMMAND_RETENTION_DAYS = 7;
const SCHEDULED_BACKUP_RETENTION_DAYS = 28;
const VACUUM_INTERVAL_DAYS = 7;
const CONFIG_KEY = 'housekeeping';

/** Deletes files older than cutoff under dir, then empty sub-folders. Returns whether dir is now empty. */
function pruneDir(dir: string, cutoff: number, isRoot: boolean): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let remaining = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        if (!pruneDir(full, cutoff, false)) remaining++;
      } else if (fs.statSync(full).mtimeMs < cutoff) {
        fs.rmSync(full, { force: true });
      } else {
        remaining++;
      }
    } catch {
      remaining++;
    }
  }
  if (remaining === 0 && !isRoot) {
    try {
      fs.rmdirSync(dir);
      return true;
    } catch {
      return false;
    }
  }
  return remaining === 0;
}

export interface HousekeepingResult {
  commands: number;
  recycleBin: boolean;
  backups: number;
  sessions: number;
  vacuumed: boolean;
}

export function runHousekeeping(app: FastifyInstance, now: Date = new Date()): HousekeepingResult {
  const { db, sqlite } = app;
  const nowMs = now.getTime();

  const oldCommands = db
    .delete(schema.commands)
    .where(
      and(
        isNotNull(schema.commands.endedAt),
        inArray(schema.commands.status, ['completed', 'failed', 'aborted']),
        lt(schema.commands.endedAt, new Date(nowMs - COMMAND_RETENTION_DAYS * DAY).toISOString()),
      ),
    )
    .returning({ id: schema.commands.id })
    .all().length;

  let recycleBin = false;
  const media = getMediaManagementConfig(db);
  if (media.recycleBin && media.recycleBinCleanupDays > 0 && fs.existsSync(media.recycleBin)) {
    pruneDir(media.recycleBin, nowMs - media.recycleBinCleanupDays * DAY, true);
    recycleBin = true;
  }

  let backups = 0;
  const scheduledDir = path.join(backupsRoot(app), 'scheduled');
  if (fs.existsSync(scheduledDir)) {
    for (const name of fs.readdirSync(scheduledDir)) {
      const file = path.join(scheduledDir, name);
      try {
        const st = fs.statSync(file);
        if (st.isFile() && name.toLowerCase().endsWith('.zip') && st.mtimeMs < nowMs - SCHEDULED_BACKUP_RETENTION_DAYS * DAY) {
          fs.rmSync(file, { force: true });
          backups++;
        }
      } catch {
        // gone already
      }
    }
  }

  const sessions = db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, nowMs)).returning({ id: schema.sessions.id }).all().length;

  sqlite.pragma('optimize');
  let lastVacuum = 0;
  const row = db.select().from(schema.config).where(eq(schema.config.key, CONFIG_KEY)).get();
  if (row) {
    try {
      lastVacuum = Number((JSON.parse(row.value) as { lastVacuum?: number }).lastVacuum ?? 0) || 0;
    } catch {
      lastVacuum = 0;
    }
  }
  let vacuumed = false;
  if (nowMs - lastVacuum >= VACUUM_INTERVAL_DAYS * DAY) {
    sqlite.exec('VACUUM');
    vacuumed = true;
    const value = JSON.stringify({ lastVacuum: nowMs });
    db.insert(schema.config)
      .values({ key: CONFIG_KEY, value })
      .onConflictDoUpdate({ target: schema.config.key, set: { value } })
      .run();
  }
  return { commands: oldCommands, recycleBin, backups, sessions, vacuumed };
}

export function registerHousekeeping(app: FastifyInstance): void {
  // CommandQueue.register replaces a handler of the same name, so this overrides the no-op from buildApp.
  // No updateMessage: the command emits exactly created/started/completed events.
  app.commands.register('Housekeeping', async () => {
    runHousekeeping(app);
  });
}
