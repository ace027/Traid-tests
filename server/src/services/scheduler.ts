import { and, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ScheduledTaskResource } from '@sonarr/shared';
import { schema } from '../db/index.js';

type TaskRow = typeof schema.scheduledTasks.$inferSelect;

export const TICK_INTERVAL_MS = 30_000;

export const DEFAULT_TASKS: { name: string; commandName: string; intervalMinutes: number }[] = [
  { name: 'RssSync', commandName: 'RssSync', intervalMinutes: 15 },
  { name: 'RefreshMonitoredDownloads', commandName: 'RefreshMonitoredDownloads', intervalMinutes: 1 },
  { name: 'RefreshSeries', commandName: 'RefreshSeries', intervalMinutes: 720 },
  { name: 'Housekeeping', commandName: 'Housekeeping', intervalMinutes: 1440 },
];

export function toScheduledTaskResource(row: TaskRow): ScheduledTaskResource {
  const r: ScheduledTaskResource = {
    name: row.name,
    commandName: row.commandName,
    interval: row.intervalMinutes,
    nextExecution: row.nextExecution,
  };
  if (row.lastExecution) r.lastExecution = row.lastExecution;
  if (row.lastStartTime) r.lastStartTime = row.lastStartTime;
  return r;
}

/** Runs registered commands on fixed intervals; state lives in the scheduled_tasks table. */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  /** command id -> task name, for commands this scheduler enqueued. */
  private tracked = new Map<number, string>();
  private unsubscribe: (() => void) | undefined;
  private now: () => Date;

  constructor(
    private app: FastifyInstance,
    opts: { now?: () => Date } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /** Subscribes lazily so an idle scheduler adds no event listener. */
  private listen(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.app.events.subscribe((event) => {
      if (event.name !== 'command' || event.action !== 'updated' || !event.resource) return;
      const id = event.resource.id as number;
      const status = event.resource.status as string;
      const name = this.tracked.get(id);
      if (name === undefined) return;
      if (status !== 'completed' && status !== 'failed' && status !== 'aborted') return;
      this.tracked.delete(id);
      this.finish(name, (event.resource.ended as string | null) ?? this.now().toISOString());
    });
  }

  private get db() {
    return this.app.db;
  }

  private addMinutes(iso: string, minutes: number): string {
    return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
  }

  getTask(name: string): TaskRow | undefined {
    return this.db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.name, name)).get();
  }

  listTasks(): TaskRow[] {
    return this.db.select().from(schema.scheduledTasks).orderBy(schema.scheduledTasks.name).all();
  }

  ensureTask(name: string, commandName: string, intervalMinutes: number): void {
    const existing = this.getTask(name);
    if (existing) {
      const next = existing.lastExecution
        ? this.addMinutes(existing.lastExecution, intervalMinutes)
        : existing.nextExecution;
      this.db
        .update(schema.scheduledTasks)
        .set({ commandName, intervalMinutes, nextExecution: next })
        .where(eq(schema.scheduledTasks.name, name))
        .run();
      return;
    }
    this.db
      .insert(schema.scheduledTasks)
      .values({
        name,
        commandName,
        intervalMinutes,
        nextExecution: this.addMinutes(this.now().toISOString(), intervalMinutes),
      })
      .run();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.app.log.error(err);
      }
    }, TICK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Enqueues every due task whose command is registered and not already queued or running. */
  tick(): string[] {
    const nowIso = this.now().toISOString();
    const due = this.db
      .select()
      .from(schema.scheduledTasks)
      .where(lte(schema.scheduledTasks.nextExecution, nowIso))
      .all();
    const started: string[] = [];
    for (const task of due) {
      if (this.enqueueTask(task, nowIso)) started.push(task.name);
    }
    return started;
  }

  /** Enqueues a task immediately regardless of its due time. Returns false if unknown or not runnable. */
  runNow(name: string): boolean {
    const task = this.getTask(name);
    if (!task) return false;
    return this.enqueueTask(task, this.now().toISOString());
  }

  private enqueueTask(task: TaskRow, nowIso: string): boolean {
    if (!this.app.commands.has(task.commandName)) return false;
    const active = this.db
      .select({ id: schema.commands.id })
      .from(schema.commands)
      .where(
        and(eq(schema.commands.name, task.commandName), inArray(schema.commands.status, ['queued', 'started'])),
      )
      .get();
    if (active) return false;
    this.db
      .update(schema.scheduledTasks)
      .set({ lastStartTime: nowIso })
      .where(eq(schema.scheduledTasks.name, task.name))
      .run();
    const cmd = this.app.commands.enqueue(task.commandName, {}, 'scheduled');
    this.listen();
    this.tracked.set(cmd.id, task.name);
    return true;
  }

  private finish(name: string, ended: string): void {
    const task = this.getTask(name);
    if (!task) return;
    this.db
      .update(schema.scheduledTasks)
      .set({ lastExecution: ended, nextExecution: this.addMinutes(ended, task.intervalMinutes) })
      .where(eq(schema.scheduledTasks.name, name))
      .run();
  }
}
