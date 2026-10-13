import type { FastifyInstance } from 'fastify';
import type { Protocol } from '@sonarr/shared';
import type { DownloadDecision } from '../decision/types.js';
import { clientFor, pickClient } from '../downloadClients/registry.js';
import type { ReleaseToAdd } from '../downloadClients/types.js';
import { recordGrabbed } from './history.js';
import { getQueue } from './queue.js';

export const TORRENT_FETCH_TIMEOUT_MS = 30_000;
export const TORRENT_MAX_BYTES = 10 * 1024 * 1024;

/** Grab failures; the message is safe to show to users (no URLs or keys). */
export class GrabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrabError';
  }
}

export type FetchFn = typeof fetch;
const defaultFetch: FetchFn = (...args) => globalThis.fetch(...args);
let fetchFn: FetchFn = defaultFetch;

/** Replaces the fetch used to download .torrent files (tests); undefined restores the default. */
export function setGrabFetch(fn: FetchFn | undefined): void {
  fetchFn = fn ?? defaultFetch;
}

const SECRET_PARAMS = new Set(['apikey', 'api', 'api_key']);

/** Removes apikey/api query parameters so indexer keys never leave the server. */
export function stripApiKey(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.replace(/([?&])(apikey|api|api_key)=[^&#]*&?/gi, '$1').replace(/[?&]$/, '');
  }
  if (u.protocol === 'magnet:') return url;
  for (const key of [...u.searchParams.keys()]) if (SECRET_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  return u.toString();
}

async function fetchTorrentFile(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(TORRENT_FETCH_TIMEOUT_MS), redirect: 'follow' });
  } catch (err) {
    const name = (err as { name?: string }).name;
    throw new GrabError(name === 'TimeoutError' || name === 'AbortError' ? 'Downloading the torrent file timed out' : 'Unable to download the torrent file');
  }
  if (!res.ok) throw new GrabError(`Downloading the torrent file failed with HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > TORRENT_MAX_BYTES) throw new GrabError('The torrent file is too large');
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > TORRENT_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new GrabError('The torrent file is too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface GrabResult {
  downloadId: string;
  clientName: string;
}

/**
 * Sends a release to the download client chosen by protocol and series tags and records a grabbed history
 * row per episode. Rejected decisions are only grabbed when the caller explicitly asks (interactive).
 */
export async function grabRelease(
  app: FastifyInstance,
  decision: DownloadDecision,
  opts: { interactive: boolean },
): Promise<GrabResult> {
  const { release, parsed, series, episodes } = decision.remoteEpisode;
  if (!series || !parsed || episodes.length === 0) {
    throw new GrabError('Unable to grab a release that is not matched to a series and episodes');
  }
  if (!opts.interactive && !decision.approved) throw new GrabError('Release was rejected');

  const protocol: Protocol = release.protocol;
  const row = pickClient(app.db, protocol, JSON.parse(series.tags) as number[]);
  if (!row) throw new GrabError(`No download client is available for ${protocol}`);

  const magnet = release.magnetUrl ?? (release.downloadUrl.startsWith('magnet:') ? release.downloadUrl : undefined);
  const toAdd: ReleaseToAdd = { title: release.title, downloadUrl: release.downloadUrl, protocol };
  if (magnet) toAdd.magnetUrl = magnet;
  const torrentFile = protocol === 'torrent' && !magnet ? await fetchTorrentFile(release.downloadUrl) : undefined;

  let downloadId: string;
  try {
    downloadId = await clientFor(row).addRelease(toAdd, torrentFile);
  } catch (err) {
    throw new GrabError(`Unable to add the release to ${row.name}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const data: Record<string, string> = {
    indexer: release.indexer,
    downloadClient: row.name,
    size: String(release.size),
    guid: release.guid,
    protocol,
    downloadUrl: stripApiKey(release.downloadUrl),
    publishedDate: release.publishDate,
  };
  if (parsed.releaseGroup) data.releaseGroup = parsed.releaseGroup;
  if (release.infoHash) data.torrentInfoHash = release.infoHash.toLowerCase();
  recordGrabbed(app, {
    seriesId: series.id,
    episodeIds: episodes.map((e) => e.id),
    sourceTitle: release.title,
    quality: parsed.quality,
    downloadId,
    data,
  });
  app.log.info({ title: release.title, client: row.name, interactive: opts.interactive }, 'Release grabbed');

  try {
    await getQueue(app).refresh();
  } catch (err) {
    app.log.warn(`Queue refresh after grab failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  app.events.publish('queue', 'updated');
  return { downloadId, clientName: row.name };
}
