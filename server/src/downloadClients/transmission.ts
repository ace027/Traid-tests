import type { DownloadClientSettings } from '@sonarr/shared';
import { infoHashFromMagnet } from './bencode.js';
import {
  DownloadClientError,
  basicAuth,
  httpError,
  joinPath,
  originOf,
  readJson,
  request,
  type ClientDeps,
  type DownloadClient,
  type DownloadClientItem,
  type FetchFn,
  type ReleaseToAdd,
} from './types.js';

interface TransmissionTorrent {
  hashString: string;
  name: string;
  totalSize: number;
  leftUntilDone: number;
  eta: number;
  status: number;
  error?: number;
  errorString?: string;
  downloadDir?: string;
  labels?: string[];
  isFinished?: boolean;
}

interface RpcResponse<T> {
  result: string;
  arguments: T;
}

const FIELDS = [
  'hashString',
  'name',
  'totalSize',
  'leftUntilDone',
  'eta',
  'status',
  'error',
  'errorString',
  'downloadDir',
  'labels',
  'isFinished',
];

export function mapTransmissionStatus(t: Pick<TransmissionTorrent, 'status' | 'leftUntilDone' | 'error'>): DownloadClientItem['status'] {
  if (t.error === 3) return 'failed';
  switch (t.status) {
    case 0:
      return t.leftUntilDone === 0 ? 'completed' : 'paused';
    case 1:
    case 2:
      return 'queued';
    case 3:
    case 4:
      return 'downloading';
    case 5:
    case 6:
      return 'completed';
    default:
      return 'queued';
  }
}

export class TransmissionClient implements DownloadClient {
  private readonly fetch: FetchFn;
  private sessionId: string | undefined;

  constructor(
    private readonly settings: DownloadClientSettings,
    deps: ClientDeps = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
  }

  private get rpcUrl(): string {
    const base = this.settings.urlBase.trim().replace(/^\/+|\/+$/g, '');
    return `${originOf(this.settings)}/${base || 'transmission'}/rpc`;
  }

  private async rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = { 'content-type': 'application/json', ...basicAuth(this.settings) };
      if (this.sessionId) headers['X-Transmission-Session-Id'] = this.sessionId;
      const res = await request(this.fetch, this.rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, arguments: args }),
      });
      if (res.status === 409) {
        const id = res.headers.get('x-transmission-session-id');
        if (!id) throw new DownloadClientError('Transmission did not provide a session id');
        this.sessionId = id;
        continue;
      }
      if (!res.ok) throw httpError(res);
      const body = await readJson<RpcResponse<T>>(res);
      if (body.result !== 'success') throw new DownloadClientError(`Transmission error: ${body.result}`);
      return body.arguments;
    }
    throw new DownloadClientError('Transmission rejected the session id');
  }

  async test(): Promise<void> {
    await this.rpc('session-get');
  }

  async addRelease(release: ReleaseToAdd, torrentFile?: Uint8Array): Promise<string> {
    const args: Record<string, unknown> = {};
    if (release.magnetUrl) args.filename = release.magnetUrl;
    else if (torrentFile) args.metainfo = Buffer.from(torrentFile).toString('base64');
    else throw new DownloadClientError('A torrent file is required when there is no magnet link');
    if (this.settings.category) args.labels = [this.settings.category];
    const res = await this.rpc<{
      'torrent-added'?: { hashString: string };
      'torrent-duplicate'?: { hashString: string };
    }>('torrent-add', args);
    const hash = res['torrent-added']?.hashString ?? res['torrent-duplicate']?.hashString ?? (release.magnetUrl ? infoHashFromMagnet(release.magnetUrl) : undefined);
    if (!hash) throw new DownloadClientError('Transmission did not return a torrent hash');
    return hash.toLowerCase();
  }

  async getItems(): Promise<DownloadClientItem[]> {
    const res = await this.rpc<{ torrents: TransmissionTorrent[] }>('torrent-get', { fields: FIELDS });
    const cat = this.settings.category.toLowerCase();
    return res.torrents
      .filter((t) => !cat || (t.labels ?? []).some((l) => l.toLowerCase() === cat))
      .map((t) => {
        const status = mapTransmissionStatus(t);
        const done = status === 'completed';
        const item: DownloadClientItem = {
          downloadId: t.hashString.toLowerCase(),
          title: t.name,
          totalSize: t.totalSize,
          remainingSize: t.leftUntilDone,
          status,
          canBeRemoved: done && (t.status === 0 || t.isFinished === true),
          canMoveFiles: done && (t.status === 0 || t.isFinished === true),
        };
        if (this.settings.category) item.category = this.settings.category;
        if (t.eta >= 0 && status === 'downloading') item.remainingTimeSeconds = t.eta;
        if (t.downloadDir) item.outputPath = joinPath(t.downloadDir, t.name);
        if (t.errorString) item.message = t.errorString;
        else if (status === 'failed') item.message = 'Transmission reports an error';
        return item;
      });
  }

  async removeItem(downloadId: string, deleteData: boolean): Promise<void> {
    await this.rpc('torrent-remove', { ids: [downloadId], 'delete-local-data': deleteData });
  }
}
