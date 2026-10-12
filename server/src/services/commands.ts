import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { Command } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';
import type { EventBus } from './events.js';

export interface CommandContext {
  body: Record<string, unknown>;
  updateMessage(message: string): void;
}
export type CommandHandler = (ctx: CommandContext) => Promise<void>;
type Row = typeof schema.commands.$inferSelect;
type Trigger = Command['trigger'];

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function formatDuration(ms: number): string {
  const p = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
  return `${p(ms / 3600000)}:${p((ms / 60000) % 60)}:${p((ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
}

export function toApiCommand(row: Row): Command {
  const duration =
    row.startedAt && row.endedAt ? formatDuration(Date.parse(row.endedAt) - Date.parse(row.startedAt)) : null;
  return {
    id: row.id,
    name: row.name,
    body: { ...(JSON.parse(row.body) as Record<string, unknown>), name: row.name },
    status: row.status as Command['status'],
    priority: row.priority,
    trigger: row.trigger as Trigger,
    message: row.message,
    queued: row.queuedAt,
    started: row.startedAt,
    ended: row.endedAt,
    duration,
  };
}

export class CommandQueue {
  private handlers = new Map<string, CommandHandler>();
  private runningNames = new Set<string>();
  private active = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private db: Db,
    private events: EventBus,
  ) {
    this.db
      .update(schema.commands)
      .set({ status: 'failed', message: 'Interrupted by restart', endedAt: new Date().toISOString() })
      .where(eq(schema.commands.status, 'started'))
      .run();
  }

  register(name: string, handler: CommandHandler): void {
    this.handlers.set(name, handler);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** Begin processing rows left queued from a previous run. Call after handlers are registered. */
  start(): void {
    this.kick();
  }

  get(id: number): Row | undefined {
    return this.db.select().from(schema.commands).where(eq(schema.commands.id, id)).get();
  }

  list(): Row[] {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    return this.db
      .select()
      .from(schema.commands)
      .where(
        or(inArray(schema.commands.status, ['queued', 'started']), gte(schema.commands.queuedAt, since)),
      )
      .orderBy(desc(schema.commands.id))
      .all();
  }

  enqueue(name: string, body: Record<string, unknown> = {}, trigger: Trigger = 'manual'): Command {
    const bodyJson = stable(body);
    const dup = this.db
      .select()
      .from(schema.commands)
      .where(and(eq(schema.commands.name, name), eq(schema.commands.status, 'queued')))
      .all()
      .find((r) => stable(JSON.parse(r.body)) === bodyJson);
    if (dup) return toApiCommand(dup);
    const row = this.db
      .insert(schema.commands)
      .values({ name, body: JSON.stringify(body), status: 'queued', trigger, queuedAt: new Date().toISOString() })
      .returning()
      .get();
    const cmd = toApiCommand(row);
    this.events.publish('command', 'created', cmd as unknown as Record<string, unknown>);
    this.kick();
    return cmd;
  }

  /** Abort a queued command. Returns false if it is not queued. */
  abort(id: number): boolean {
    const row = this.db
      .update(schema.commands)
      .set({ status: 'aborted', endedAt: new Date().toISOString() })
      .where(and(eq(schema.commands.id, id), eq(schema.commands.status, 'queued')))
      .returning()
      .get();
    if (!row) return false;
    this.events.publish('command', 'updated', toApiCommand(row) as unknown as Record<string, unknown>);
    return true;
  }

  async waitForIdle(): Promise<void> {
    while (this.active.size > 0) await Promise.allSettled([...this.active]);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.waitForIdle();
  }

  private update(id: number, values: Partial<Row>): Row | undefined {
    const row = this.db.update(schema.commands).set(values).where(eq(schema.commands.id, id)).returning().get();
    if (row) this.events.publish('command', 'updated', toApiCommand(row) as unknown as Record<string, unknown>);
    return row;
  }

  private kick(): void {
    if (this.closed) return;
    const queued = this.db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.status, 'queued'))
      .orderBy(schema.commands.id)
      .all();
    for (const row of queued) {
      if (this.runningNames.has(row.name)) continue;
      const handler = this.handlers.get(row.name);
      if (!handler) {
        this.update(row.id, { status: 'failed', message: 'Unknown command', endedAt: new Date().toISOString() });
        continue;
      }
      this.runningNames.add(row.name);
      const p: Promise<void> = this.run(row, handler).finally(() => {
        this.active.delete(p);
        this.runningNames.delete(row.name);
        this.kick();
      });
      this.active.add(p);
    }
  }

  private async run(row: Row, handler: CommandHandler): Promise<void> {
    this.update(row.id, { status: 'started', startedAt: new Date().toISOString() });
    try {
      await handler({
        body: JSON.parse(row.body) as Record<string, unknown>,
        updateMessage: (message) => {
          this.update(row.id, { message });
        },
      });
      this.update(row.id, { status: 'completed', endedAt: new Date().toISOString() });
    } catch (err) {
      this.update(row.id, {
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
        endedAt: new Date().toISOString(),
      });
    }
  }
}
