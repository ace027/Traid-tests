import type { FastifyInstance } from 'fastify';
import { schema } from '../db/index.js';
import { createNewznabClient } from './newznab.js';
import type { IndexerClient, IndexerRow } from './types.js';

export type IndexerPurpose = 'rss' | 'automatic' | 'interactive';
export type IndexerClientFactory = (row: IndexerRow) => IndexerClient;

const defaultFactory: IndexerClientFactory = (row) =>
  createNewznabClient(row, { fetch: (...args) => globalThis.fetch(...args), now: () => new Date() });

let factory: IndexerClientFactory = defaultFactory;

/** Replaces the client factory (tests, other plans); pass undefined to restore the default. */
export function setIndexerClientFactory(fn: IndexerClientFactory | undefined): void {
  factory = fn ?? defaultFactory;
}

export function createIndexerClient(row: IndexerRow): IndexerClient {
  return factory(row);
}


const BACKOFF_MINUTES = [5, 15, 30, 60, 180, 360, 720, 1440];

interface BackoffState {
  failures: number;
  disabledTill: number;
  mostRecentFailure: number;
  message?: string;
}

const backoff = new Map<number, BackoffState>();

export function recordFailure(indexerId: number, message?: string, now: number = Date.now()): void {
  const failures = (backoff.get(indexerId)?.failures ?? 0) + 1;
  const minutes = BACKOFF_MINUTES[Math.min(failures, BACKOFF_MINUTES.length) - 1]!;
  backoff.set(indexerId, {
    failures,
    disabledTill: now + minutes * 60_000,
    mostRecentFailure: now,
    message,
  });
}

export function recordSuccess(indexerId: number): void {
  backoff.delete(indexerId);
}

export function isInBackoff(indexerId: number, now: number = Date.now()): boolean {
  const s = backoff.get(indexerId);
  return !!s && s.disabledTill > now;
}

export function resetIndexerBackoff(): void {
  backoff.clear();
}

export interface IndexerStatus {
  indexerId: number;
  disabledTill: string;
  mostRecentFailure: string;
  initialFailure: string;
  escalationLevel: number;
  message?: string;
}

export function getIndexerStatus(now: number = Date.now()): IndexerStatus[] {
  const out: IndexerStatus[] = [];
  for (const [indexerId, s] of backoff) {
    if (s.disabledTill <= now) continue;
    out.push({
      indexerId,
      disabledTill: new Date(s.disabledTill).toISOString(),
      mostRecentFailure: new Date(s.mostRecentFailure).toISOString(),
      initialFailure: new Date(s.mostRecentFailure).toISOString(),
      escalationLevel: s.failures,
      ...(s.message ? { message: s.message } : {}),
    });
  }
  return out;
}

export function getIndexerClients(
  app: FastifyInstance,
  opts: { purpose: IndexerPurpose; now?: number },
): { row: IndexerRow; client: IndexerClient }[] {
  const now = opts.now ?? Date.now();
  const enabled = (r: IndexerRow) =>
    opts.purpose === 'rss' ? r.enableRss : opts.purpose === 'automatic' ? r.enableAutomaticSearch : r.enableInteractiveSearch;
  return app.db
    .select()
    .from(schema.indexers)
    .all()
    .filter((r) => enabled(r) && !isInBackoff(r.id, now))
    .sort((a, b) => a.priority - b.priority || a.id - b.id)
    .map((row) => ({ row, client: factory(row) }));
}
