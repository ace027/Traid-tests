import type { DownloadClientSettings, Protocol } from '@sonarr/shared';

export type DownloadItemStatus = 'queued' | 'paused' | 'downloading' | 'completed' | 'failed' | 'warning';

export interface DownloadClientItem {
  downloadId: string;
  title: string;
  category?: string;
  totalSize: number;
  remainingSize: number;
  remainingTimeSeconds?: number;
  status: DownloadItemStatus;
  message?: string;
  outputPath?: string;
  canBeRemoved: boolean;
  canMoveFiles: boolean;
}

export interface ReleaseToAdd {
  title: string;
  downloadUrl: string;
  magnetUrl?: string;
  protocol: Protocol;
}

export interface DownloadClient {
  test(): Promise<void>;
  /** Adds the release and returns the client-side download id (usenet id or torrent info hash). */
  addRelease(release: ReleaseToAdd, torrentFile?: Uint8Array): Promise<string>;
  getItems(): Promise<DownloadClientItem[]>;
  removeItem(downloadId: string, deleteData: boolean): Promise<void>;
}

/** Messages of this error never contain credentials or request URLs. */
export class DownloadClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadClientError';
  }
}

export type FetchFn = typeof fetch;
export interface ClientDeps {
  fetch?: FetchFn;
}

export const REQUEST_TIMEOUT_MS = 15_000;

export function originOf(s: DownloadClientSettings): string {
  return `${s.useSsl ? 'https' : 'http'}://${s.host}:${s.port}`;
}

/** Origin plus the url base without a trailing slash. */
export function buildBaseUrl(s: DownloadClientSettings): string {
  const base = s.urlBase.trim().replace(/^\/+|\/+$/g, '');
  return base ? `${originOf(s)}/${base}` : originOf(s);
}

export function basicAuth(s: DownloadClientSettings): Record<string, string> {
  if (!s.username) return {};
  return { Authorization: `Basic ${Buffer.from(`${s.username}:${s.password}`).toString('base64')}` };
}

/** fetch with a timeout; failures become DownloadClientError without the URL (it may hold an API key). */
export async function request(fetchFn: FetchFn, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string }; code?: string };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new DownloadClientError('Request to the download client timed out');
    }
    const code = e.cause?.code ?? e.code;
    throw new DownloadClientError(`Unable to connect to the download client${code ? ` (${code})` : ''}`);
  }
}

export function httpError(res: Response): DownloadClientError {
  if (res.status === 401 || res.status === 403) {
    return new DownloadClientError('Authentication failed: check the username, password or API key');
  }
  return new DownloadClientError(`The download client responded with HTTP ${res.status}`);
}

export async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new DownloadClientError('The download client returned an invalid response');
  }
}

export const MIB = 1024 * 1024;

/** Joins a directory and file name using the separator the directory already uses. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
