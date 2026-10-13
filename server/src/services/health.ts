import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DiskSpaceResource, HealthResource } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { getIndexerStatus } from '../indexers/registry.js';
import { getMediaManagementConfig } from './mediaConfig.js';
import { getQueue } from './queue.js';

export const LOW_SPACE_BYTES = 1024 ** 3;
/** Health is recomputed this long after the last relevant change event. */
const RECHECK_DELAY_MS = 2000;
const RECHECK_EVENTS = new Set(['indexer', 'indexerstatus', 'downloadclient', 'rootfolder', 'config', 'hostconfig']);
const WIKI = 'https://wiki.servarr.com/sonarr/system#';

export interface StatFsResult {
  bsize: number;
  blocks: number;
  bavail: number;
}
export type StatFsFn = (p: string) => Promise<StatFsResult>;

export interface HealthChange {
  added: HealthResource[];
  removed: HealthResource[];
  current: HealthResource[];
}

const issue = (source: string, type: HealthResource['type'], message: string, anchor?: string): HealthResource => ({
  source,
  type,
  message,
  wikiUrl: `${WIKI}${anchor ?? source.toLowerCase()}`,
});

const keyOf = (h: HealthResource) => `${h.source}|${h.type}|${h.message}`;
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Nearest existing ancestor of a path (an unmounted drive's folder may be gone). */
function existingAncestor(p: string): string | null {
  let cur = path.resolve(p);
  for (;;) {
    if (fs.existsSync(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export class HealthService {
  private list: HealthResource[] = [];
  private readonly listeners = new Set<(change: HealthChange) => void>();
  private readonly failures = new Set<number>();
  private inflight: Promise<HealthResource[]> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private closed = false;
  private ran = false;
  private readonly statfs: StatFsFn;
  private readonly autoRecheck: boolean;

  constructor(
    private readonly app: FastifyInstance,
    opts: { statfs?: StatFsFn; autoRecheck?: boolean } = {},
  ) {
    this.statfs = opts.statfs ?? ((p) => fs.promises.statfs(p));
    this.autoRecheck = opts.autoRecheck ?? true;
  }

  /** The last computed list; runs the first check on demand. */
  async current(): Promise<HealthResource[]> {
    if (!this.ran) await this.check();
    return [...this.list];
  }

  /** Subscribes to changes of the health list; returns an unsubscribe function. */
  onChange(fn: (change: HealthChange) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  reportNotificationFailure(id: number): void {
    this.failures.add(id);
  }

  clearNotificationFailure(id: number): void {
    this.failures.delete(id);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
  }

  private scheduleRecheck(): void {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.closed) void this.check().catch((err) => this.app.log.warn(err, 'Health check failed'));
    }, RECHECK_DELAY_MS);
    this.timer.unref();
  }

  /** Runs every check, stores the result and publishes it when it changed. Concurrent calls share one run. */
  check(): Promise<HealthResource[]> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Subscribes lazily (first check) so an app that never checks adds no event listener. */
  private listen(): void {
    if (!this.autoRecheck || this.unsubscribe || this.closed) return;
    this.unsubscribe = this.app.events.subscribe((event) => {
      if (event.name === 'health' || !RECHECK_EVENTS.has(event.name)) return;
      this.scheduleRecheck();
    });
  }

  private async run(): Promise<HealthResource[]> {
    this.listen();
    const checks: (() => HealthResource[] | Promise<HealthResource[]>)[] = [
      () => this.indexerChecks(),
      () => this.downloadClientChecks(),
      () => this.rootFolderChecks(),
      () => this.recycleBinCheck(),
      () => this.notificationCheck(),
      () => this.authCheck(),
    ];
    const next: HealthResource[] = [];
    for (const check of checks) {
      try {
        next.push(...(await check()));
      } catch (err) {
        this.app.log.warn(err, 'A health check failed to run');
      }
    }
    if (this.closed) return next;
    this.ran = true;

    const before = new Map(this.list.map((h) => [keyOf(h), h]));
    const after = new Map(next.map((h) => [keyOf(h), h]));
    const added = next.filter((h) => !before.has(keyOf(h)));
    const removed = this.list.filter((h) => !after.has(keyOf(h)));
    this.list = next;
    if (added.length || removed.length) {
      this.app.events.publish('health', 'updated', { records: next });
      for (const fn of [...this.listeners]) {
        try {
          fn({ added, removed, current: [...next] });
        } catch (err) {
          this.app.log.warn(err, 'Health listener failed');
        }
      }
    }
    return next;
  }

  private indexerChecks(): HealthResource[] {
    const rows = this.app.db.select().from(schema.indexers).all();
    const out: HealthResource[] = [];
    if (!rows.some((r) => r.enableRss)) {
      out.push(issue('IndexerRssCheck', 'warning', 'No indexers available with RSS sync enabled, Sonarr will not grab new releases automatically', 'indexers'));
    }
    if (!rows.some((r) => r.enableAutomaticSearch || r.enableInteractiveSearch)) {
      out.push(issue('IndexerSearchCheck', 'warning', 'No indexers available with Automatic Search or Interactive Search enabled, Sonarr will not provide any search results', 'indexers'));
    }
    const failing = new Set(getIndexerStatus().map((s) => s.indexerId));
    const down = rows.filter((r) => failing.has(r.id));
    if (rows.length > 0 && down.length === rows.length) {
      out.push(issue('IndexerStatusCheck', 'error', 'All indexers are unavailable due to failures', 'indexers'));
    } else if (down.length > 0) {
      out.push(issue('IndexerStatusCheck', 'warning', `Indexers unavailable due to failures: ${down.map((r) => r.name).join(', ')}`, 'indexers'));
    }
    return out;
  }

  private downloadClientChecks(): HealthResource[] {
    const out: HealthResource[] = [];
    const enabled = this.app.db.select().from(schema.downloadClients).all().filter((c) => c.enable);
    if (enabled.length === 0) {
      out.push(issue('DownloadClientCheck', 'warning', 'No download client is available', 'download-clients'));
    }
    for (const h of getQueue(this.app).health()) {
      out.push(issue('DownloadClientStatusCheck', 'warning', h.message, 'download-clients'));
    }
    return out;
  }

  private async rootFolderChecks(): Promise<HealthResource[]> {
    const out: HealthResource[] = [];
    for (const { path: folder } of this.app.db.select().from(schema.rootFolders).all()) {
      try {
        await fs.promises.access(folder, fs.constants.R_OK | fs.constants.W_OK);
      } catch (err) {
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
        out.push(
          issue(
            'RootFolderCheck',
            'error',
            missing ? `Missing root folder: ${folder}` : `Root folder is not accessible (needs read and write access): ${folder}`,
            'root-folders',
          ),
        );
        continue;
      }
      try {
        const s = await this.statfs(folder);
        const free = s.bavail * s.bsize;
        if (free < LOW_SPACE_BYTES) {
          out.push(issue('DiskSpaceCheck', 'warning', `Root folder is low on free space: ${folder} has ${gb(free)} free`, 'disk-space'));
        }
      } catch {
        // free space unknown; not a health issue by itself
      }
    }
    return out;
  }

  private recycleBinCheck(): HealthResource[] {
    const bin = getMediaManagementConfig(this.app.db).recycleBin;
    if (!bin) return [];
    let ok: boolean;
    try {
      ok = fs.statSync(bin).isDirectory();
    } catch {
      ok = false;
    }
    return ok ? [] : [issue('RecycleBinCheck', 'warning', `Recycle bin folder does not exist: ${bin}`, 'recycle-bin')];
  }

  private notificationCheck(): HealthResource[] {
    if (this.failures.size === 0) return [];
    const names = this.app.db
      .select()
      .from(schema.notifications)
      .all()
      .filter((n) => this.failures.has(n.id))
      .map((n) => n.name);
    // Failures of deleted notifications drop out.
    const known = new Set(this.app.db.select({ id: schema.notifications.id }).from(schema.notifications).all().map((n) => n.id));
    for (const id of [...this.failures]) if (!known.has(id)) this.failures.delete(id);
    if (names.length === 0) return [];
    return [issue('NotificationStatusCheck', 'warning', `Notifications unavailable due to failures: ${names.join(', ')}`, 'notifications')];
  }

  private authCheck(): HealthResource[] {
    return this.app.auth.settings().method === 'external'
      ? [issue('AuthenticationCheck', 'warning', 'Authentication is set to External: make sure a reverse proxy protects Sonarr, as it will not ask for credentials', 'authentication')]
      : [];
  }

  /** One entry per distinct mount holding a root folder or the data directory. */
  async diskSpace(): Promise<DiskSpaceResource[]> {
    const paths = [...this.app.db.select().from(schema.rootFolders).all().map((r) => r.path), this.app.dataDir];
    const seen = new Set<number>();
    const out: DiskSpaceResource[] = [];
    for (const p of paths) {
      const where = existingAncestor(p);
      if (!where) continue;
      try {
        const dev = fs.statSync(where).dev;
        if (seen.has(dev)) continue;
        const s = await this.statfs(where);
        seen.add(dev);
        out.push({ path: p, label: p, freeSpace: s.bavail * s.bsize, totalSpace: s.blocks * s.bsize });
      } catch {
        // an unreadable mount is skipped
      }
    }
    return out;
  }
}

export function registerHealth(app: FastifyInstance, opts: { statfs?: StatFsFn; autoRecheck?: boolean } = {}): HealthService {
  const service = new HealthService(app, opts);
  app.decorate('health', service);
  app.commands.register('CheckHealth', async () => {
    await service.check();
  });
  app.addHook('onClose', async () => service.close());
  return service;
}
