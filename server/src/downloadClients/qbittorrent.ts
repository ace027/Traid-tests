import type { DownloadClientSettings } from '@sonarr/shared';
import { infoHashFromMagnet, infoHashFromTorrent } from './bencode.js';
import {
  DownloadClientError,
  buildBaseUrl,
  httpError,
  joinPath,
  readJson,
  request,
  type ClientDeps,
  type DownloadClient,
  type DownloadClientItem,
  type FetchFn,
  type ReleaseToAdd,
} from './types.js';

interface Torrent {
  hash: string;
  name: string;
  size: number;
  progress: number;
  state: string;
  eta?: number;
  save_path?: string;
  category?: string;
}

const DOWNLOADING = new Set(['downloading', 'stalledDL', 'metaDL', 'forcedMetaDL', 'forcedDL', 'moving', 'allocating']);
const PAUSED = new Set(['pausedDL', 'stoppedDL']);
const QUEUED = new Set(['queuedDL', 'checkingDL', 'checkingResumeData']);
const COMPLETED = new Set(['uploading', 'stalledUP', 'pausedUP', 'queuedUP', 'forcedUP', 'stoppedUP', 'checkingUP']);
const FAILED = new Set(['error', 'missingFiles']);
const SEEDING_DONE = new Set(['pausedUP', 'stoppedUP']);

export function mapQbittorrentState(state: string): DownloadClientItem['status'] {
  if (DOWNLOADING.has(state)) return 'downloading';
  if (PAUSED.has(state)) return 'paused';
  if (QUEUED.has(state)) return 'queued';
  if (COMPLETED.has(state)) return 'completed';
  if (FAILED.has(state)) return 'failed';
  return 'queued';
}

export class QbittorrentClient implements DownloadClient {
  private readonly fetch: FetchFn;
  private cookie: string | undefined;

  constructor(
    private readonly settings: DownloadClientSettings,
    deps: ClientDeps = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
  }

  private async login(): Promise<void> {
    this.cookie = undefined;
    const res = await request(this.fetch, `${buildBaseUrl(this.settings)}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', referer: buildBaseUrl(this.settings) },
      body: new URLSearchParams({ username: this.settings.username, password: this.settings.password }).toString(),
    });
    if (res.status === 403) throw new DownloadClientError('qBittorrent refused the login (the IP may be banned)');
    if (!res.ok) throw httpError(res);
    const text = (await res.text()).trim();
    if (text !== 'Ok.') throw new DownloadClientError('Authentication failed: check the username and password');
    const cookie = /(?:^|[,\s])([A-Za-z0-9_]*SID[A-Za-z0-9_]*=[^;,\s]+)/.exec(res.headers.get('set-cookie') ?? '');
    if (cookie) this.cookie = cookie[1];
  }

  private async call(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    if (!this.cookie && !this.loggedIn) {
      await this.login();
      this.loggedIn = true;
    }
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    const res = await request(this.fetch, `${buildBaseUrl(this.settings)}${path}`, { ...init, headers });
    if (res.status === 403 && retry) {
      await this.login();
      this.loggedIn = true;
      return this.call(path, init, false);
    }
    if (!res.ok) throw httpError(res);
    return res;
  }

  private loggedIn = false;

  async test(): Promise<void> {
    await this.login();
    this.loggedIn = true;
    await this.call('/api/v2/app/version');
  }

  async addRelease(release: ReleaseToAdd, torrentFile?: Uint8Array): Promise<string> {
    const form = new FormData();
    let hash: string | undefined;
    if (release.magnetUrl) {
      hash = infoHashFromMagnet(release.magnetUrl);
      if (!hash) throw new DownloadClientError('The magnet link has no valid info hash');
      form.set('urls', release.magnetUrl);
    } else {
      if (!torrentFile) throw new DownloadClientError('A torrent file is required when there is no magnet link');
      hash = infoHashFromTorrent(torrentFile);
      form.set('torrents', new Blob([torrentFile as unknown as ArrayBuffer], { type: 'application/x-bittorrent' }), `${hash}.torrent`);
    }
    if (this.settings.category) form.set('category', this.settings.category);
    form.set('paused', 'false');
    form.set('stopped', 'false');
    const res = await this.call('/api/v2/torrents/add', { method: 'POST', body: form });
    const text = (await res.text()).trim();
    if (text === 'Fails.') throw new DownloadClientError('qBittorrent rejected the torrent');
    return hash;
  }

  async getItems(): Promise<DownloadClientItem[]> {
    const q = this.settings.category ? `?category=${encodeURIComponent(this.settings.category)}` : '';
    const res = await this.call(`/api/v2/torrents/info${q}`);
    const torrents = await readJson<Torrent[]>(res);
    return torrents.map((t) => {
      const status = mapQbittorrentState(t.state);
      const remaining = Math.max(0, Math.round(t.size * (1 - t.progress)));
      const done = status === 'completed';
      const item: DownloadClientItem = {
        downloadId: t.hash.toLowerCase(),
        title: t.name,
        totalSize: t.size,
        remainingSize: done ? 0 : remaining,
        status,
        canBeRemoved: done && SEEDING_DONE.has(t.state),
        canMoveFiles: done && SEEDING_DONE.has(t.state),
      };
      if (t.category) item.category = t.category;
      if (t.eta !== undefined && t.eta >= 0 && t.eta < 8640000 && status === 'downloading') item.remainingTimeSeconds = t.eta;
      if (t.save_path) item.outputPath = joinPath(t.save_path, t.name);
      if (status === 'failed') item.message = t.state === 'missingFiles' ? 'Files are missing' : 'qBittorrent reports an error';
      return item;
    });
  }

  async removeItem(downloadId: string, deleteData: boolean): Promise<void> {
    await this.call('/api/v2/torrents/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: downloadId, deleteFiles: String(deleteData) }).toString(),
    });
  }
}
