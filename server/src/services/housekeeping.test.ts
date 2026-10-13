import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { createBackup, listBackups } from './backup.js';
import { runHousekeeping } from './housekeeping.js';
import { saveMediaManagementConfig } from './mediaConfig.js';

let t: TestApp | undefined;
const tmps: string[] = [];
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2025-06-15T12:00:00Z');
const age = (file: string, days: number) => {
  const d = new Date(NOW.getTime() - days * DAY);
  fs.utimesSync(file, d, d);
};
const addCommand = (app: TestApp['app'], status: string, daysAgo: number) => {
  const at = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
  return app.db
    .insert(schema.commands)
    .values({ name: 'X', body: '{}', status, trigger: 'manual', queuedAt: at, endedAt: status === 'queued' ? null : at })
    .returning()
    .get().id;
};

describe('housekeeping', () => {
  it('removes old finished commands and keeps recent and active ones', async () => {
    t = await createTestApp();
    const old = addCommand(t.app, 'completed', 8);
    const oldFailed = addCommand(t.app, 'failed', 30);
    const recent = addCommand(t.app, 'completed', 2);
    const queued = addCommand(t.app, 'queued', 20);
    const r = runHousekeeping(t.app, NOW);
    expect(r.commands).toBe(2);
    const ids = t.app.db.select().from(schema.commands).all().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([recent, queued]));
    expect(ids).not.toContain(old);
    expect(ids).not.toContain(oldFailed);
  });

  it('prunes recycle bin files by age and removes empty folders', async () => {
    t = await createTestApp();
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
    tmps.push(bin);
    fs.mkdirSync(path.join(bin, 'Show', 'S1'), { recursive: true });
    fs.mkdirSync(path.join(bin, 'Fresh'), { recursive: true });
    const oldFile = path.join(bin, 'Show', 'S1', 'old.mkv');
    const newFile = path.join(bin, 'Fresh', 'new.mkv');
    fs.writeFileSync(oldFile, 'x');
    fs.writeFileSync(newFile, 'x');
    age(oldFile, 10);
    age(newFile, 3);
    saveMediaManagementConfig(t.app.db, { recycleBin: bin, recycleBinCleanupDays: 7 });
    runHousekeeping(t.app, NOW);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(path.join(bin, 'Show'))).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
    expect(fs.existsSync(bin)).toBe(true);
  });

  it('keeps everything when cleanup days is 0 and tolerates a missing recycle bin', async () => {
    t = await createTestApp();
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
    tmps.push(bin);
    const f = path.join(bin, 'a.mkv');
    fs.writeFileSync(f, 'x');
    age(f, 400);
    saveMediaManagementConfig(t.app.db, { recycleBin: bin, recycleBinCleanupDays: 0 });
    runHousekeeping(t.app, NOW);
    expect(fs.existsSync(f)).toBe(true);
    saveMediaManagementConfig(t.app.db, { recycleBin: path.join(bin, 'missing'), recycleBinCleanupDays: 7 });
    expect(() => runHousekeeping(t!.app, NOW)).not.toThrow();
  });

  it('prunes old scheduled backups only', async () => {
    t = await createTestApp();
    const sOld = createBackup(t.app, 'scheduled', new Date(2025, 0, 1, 1, 0, 0));
    const sNew = createBackup(t.app, 'scheduled', new Date(2025, 0, 2, 1, 0, 0));
    const mOld = createBackup(t.app, 'manual', new Date(2025, 0, 3, 1, 0, 0));
    const file = (b: { type: string; name: string }) => path.join(t!.dataDir, 'Backups', b.type, b.name);
    age(file(sOld), 40);
    age(file(sNew), 5);
    age(file(mOld), 400);
    const r = runHousekeeping(t.app, NOW);
    expect(r.backups).toBe(1);
    expect(listBackups(t.app).map((b) => b.name).sort()).toEqual([sNew.name, mOld.name].sort());
  });

  it('prunes expired sessions', async () => {
    t = await createTestApp();
    const ins = (h: string, exp: number) =>
      t!.app.db.insert(schema.sessions).values({ tokenHash: h, createdAt: 0, expiresAt: exp, lastSeenAt: 0 }).run();
    ins('old', NOW.getTime() - 1000);
    ins('live', NOW.getTime() + DAY);
    expect(runHousekeeping(t.app, NOW).sessions).toBe(1);
    expect(t.app.db.select().from(schema.sessions).all().map((s) => s.tokenHash)).toEqual(['live']);
  });

  it('vacuums at most weekly', async () => {
    t = await createTestApp();
    expect(runHousekeeping(t.app, NOW).vacuumed).toBe(true);
    expect(runHousekeeping(t.app, new Date(NOW.getTime() + DAY)).vacuumed).toBe(false);
    expect(runHousekeeping(t.app, new Date(NOW.getTime() + 8 * DAY)).vacuumed).toBe(true);
    expect(t.app.db.select().from(schema.config).where(eq(schema.config.key, 'housekeeping')).get()).toBeTruthy();
  });

  it('runs as the Housekeeping command', async () => {
    t = await createTestApp();
    const oldId = addCommand(t.app, 'completed', 30);
    const cmd = t.app.commands.enqueue('Housekeeping');
    await vi_waitDone(t.app, cmd.id);
    expect(t.app.commands.get(oldId)).toBeUndefined();
    expect(t.app.commands.get(cmd.id)?.status).toBe('completed');
  });
});

async function vi_waitDone(app: TestApp['app'], id: number) {
  for (let i = 0; i < 100; i++) {
    if (app.commands.get(id)?.status === 'completed') return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('command did not complete');
}
