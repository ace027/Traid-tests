import { downloadClientSettingsSchema, type DownloadClientImplementation, type DownloadClientSettings, type Protocol } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';
import { NzbgetClient } from './nzbget.js';
import { QbittorrentClient } from './qbittorrent.js';
import { SabnzbdClient } from './sabnzbd.js';
import { TransmissionClient } from './transmission.js';
import { DownloadClientError, type DownloadClient } from './types.js';

export type DownloadClientRow = typeof schema.downloadClients.$inferSelect;

/** What a factory needs to build a client; rows from the database convert via clientConfigFromRow. */
export interface ClientConfig {
  id?: number;
  name?: string;
  implementation: string;
  settings: DownloadClientSettings;
}

export type DownloadClientFactory = (config: ClientConfig) => DownloadClient;

const IMPLEMENTATION_PROTOCOL: Record<DownloadClientImplementation, Protocol> = {
  SABnzbd: 'usenet',
  NZBGet: 'usenet',
  QBittorrent: 'torrent',
  Transmission: 'torrent',
};

export function normalizeImplementation(value: string): DownloadClientImplementation {
  const found = (Object.keys(IMPLEMENTATION_PROTOCOL) as DownloadClientImplementation[]).find(
    (k) => k.toLowerCase() === value.toLowerCase(),
  );
  if (!found) throw new DownloadClientError(`Unknown download client implementation '${value}'`);
  return found;
}

export function protocolFor(implementation: string): Protocol {
  return IMPLEMENTATION_PROTOCOL[normalizeImplementation(implementation)];
}

export function clientConfigFromRow(row: DownloadClientRow): ClientConfig {
  return {
    id: row.id,
    name: row.name,
    implementation: row.implementation,
    settings: downloadClientSettingsSchema.parse(JSON.parse(row.settings)),
  };
}

const defaultFactory: DownloadClientFactory = ({ implementation, settings }) => {
  switch (normalizeImplementation(implementation)) {
    case 'SABnzbd':
      return new SabnzbdClient(settings);
    case 'NZBGet':
      return new NzbgetClient(settings);
    case 'QBittorrent':
      return new QbittorrentClient(settings);
    case 'Transmission':
      return new TransmissionClient(settings);
  }
};

let factory: DownloadClientFactory = defaultFactory;
const cache = new Map<string, DownloadClient>();

/** Replaces the client factory (tests and plan 03-04 use a FakeDownloadClient); null restores the default. */
export function setDownloadClientFactory(fn: DownloadClientFactory | null): void {
  factory = fn ?? defaultFactory;
  cache.clear();
}

export function createClient(config: ClientConfig | DownloadClientRow): DownloadClient {
  const cfg = 'protocol' in config ? clientConfigFromRow(config) : config;
  return factory(cfg);
}

/** Like createClient but reuses the instance per client id and settings so sessions (cookies, tokens) survive. */
export function clientFor(row: DownloadClientRow): DownloadClient {
  const key = `${row.id}:${row.implementation}:${row.settings}`;
  let client = cache.get(key);
  if (!client) {
    for (const k of cache.keys()) if (k.startsWith(`${row.id}:`)) cache.delete(k);
    client = createClient(row);
    cache.set(key, client);
  }
  return client;
}

const rotation = new Map<string, number>();

export function resetClientRotation(): void {
  rotation.clear();
}

/**
 * Picks the enabled client for a protocol: clients sharing a tag with the series win, otherwise untagged
 * clients are used. The lowest priority value wins; equal priorities rotate round-robin.
 */
export function pickClient(db: Db, protocol: Protocol, seriesTags: number[]): DownloadClientRow | null {
  const rows = db
    .select()
    .from(schema.downloadClients)
    .all()
    .filter((r) => r.enable && r.protocol === protocol);
  const tagsOf = (r: DownloadClientRow) => JSON.parse(r.tags) as number[];
  const tagged = rows.filter((r) => tagsOf(r).some((t) => seriesTags.includes(t)));
  const candidates = tagged.length > 0 ? tagged : rows.filter((r) => tagsOf(r).length === 0);
  if (candidates.length === 0) return null;
  const best = Math.min(...candidates.map((r) => r.priority));
  const tied = candidates.filter((r) => r.priority === best).sort((a, b) => a.id - b.id);
  if (tied.length === 1) return tied[0]!;
  const key = `${protocol}:${tied.map((r) => r.id).join(',')}`;
  const n = rotation.get(key) ?? 0;
  rotation.set(key, n + 1);
  return tied[n % tied.length]!;
}
