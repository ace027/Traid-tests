import type { DownloadClientSettings } from '@sonarr/shared';
import {
  DownloadClientError,
  MIB,
  buildBaseUrl,
  httpError,
  readJson,
  request,
  type ClientDeps,
  type DownloadClient,
  type DownloadClientItem,
  type FetchFn,
  type ReleaseToAdd,
} from './types.js';

interface SabResponse {
  status?: boolean;
  error?: string;
  [key: string]: unknown;
}

interface QueueSlot {
  nzo_id: string;
  filename: string;
  cat?: string;
  status: string;
  mb?: string;
  mbleft?: string;
  timeleft?: string;
}

interface HistorySlot {
  nzo_id: string;
  name: string;
  category?: string;
  status: string;
  bytes?: number;
  storage?: string;
  fail_message?: string;
}

function parseTimeLeft(v: string | undefined): number | undefined {
  if (!/^\d+(?::\d+){1,2}$/.test(v ?? '')) return undefined;
  const parts = (v as string).split(':').map(Number);
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return parts[0]! * 60 + parts[1]!;
}

export class SabnzbdClient implements DownloadClient {
  private readonly fetch: FetchFn;

  constructor(
    private readonly settings: DownloadClientSettings,
    deps: ClientDeps = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
  }

  private async api<T extends SabResponse>(params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams({ ...params, output: 'json', apikey: this.settings.apiKey });
    const res = await request(this.fetch, `${buildBaseUrl(this.settings)}/api?${query.toString()}`);
    if (!res.ok) throw httpError(res);
    const body = await readJson<T>(res);
    if (body.status === false || (typeof body.error === 'string' && body.error)) {
      const msg = String(body.error ?? 'request failed');
      if (/api key|credential|password|username/i.test(msg)) {
        throw new DownloadClientError('Authentication failed: check the API key or credentials');
      }
      throw new DownloadClientError(`SABnzbd error: ${msg.replace(this.settings.apiKey || '\u0000', '***')}`);
    }
    return body;
  }

  async test(): Promise<void> {
    await this.api({ mode: 'version' });
    const cat = this.settings.category;
    if (cat) {
      const cfg = await this.api<SabResponse & { config?: { categories?: { name: string }[] } }>({ mode: 'get_config' });
      const names = (cfg.config?.categories ?? []).map((c) => c.name.toLowerCase());
      if (!names.includes(cat.toLowerCase())) {
        throw new DownloadClientError(`Category '${cat}' does not exist in SABnzbd`);
      }
    }
  }

  async addRelease(release: ReleaseToAdd): Promise<string> {
    const params: Record<string, string> = { mode: 'addurl', name: release.downloadUrl, nzbname: release.title };
    if (this.settings.category) params.cat = this.settings.category;
    const res = await this.api<SabResponse & { nzo_ids?: string[] }>(params);
    const id = res.nzo_ids?.[0];
    if (!id) throw new DownloadClientError('SABnzbd did not return a download id');
    return id;
  }

  private inCategory(cat: string | undefined): boolean {
    const want = this.settings.category;
    return !want || (cat ?? '').toLowerCase() === want.toLowerCase();
  }

  async getItems(): Promise<DownloadClientItem[]> {
    const [queue, history] = await Promise.all([
      this.api<SabResponse & { queue?: { slots?: QueueSlot[] } }>({ mode: 'queue' }),
      this.api<SabResponse & { history?: { slots?: HistorySlot[] } }>({ mode: 'history', limit: '200' }),
    ]);
    const items: DownloadClientItem[] = [];
    for (const s of queue.queue?.slots ?? []) {
      if (!this.inCategory(s.cat)) continue;
      const total = Math.round(Number(s.mb ?? 0) * MIB);
      const left = Math.round(Number(s.mbleft ?? 0) * MIB);
      const status = s.status === 'Paused' ? 'paused' : s.status === 'Downloading' ? 'downloading' : 'queued';
      const item: DownloadClientItem = {
        downloadId: s.nzo_id,
        title: s.filename,
        totalSize: total,
        remainingSize: left,
        status,
        canBeRemoved: false,
        canMoveFiles: false,
      };
      if (s.cat) item.category = s.cat;
      const t = status === 'downloading' ? parseTimeLeft(s.timeleft) : undefined;
      if (t !== undefined) item.remainingTimeSeconds = t;
      items.push(item);
    }
    for (const s of history.history?.slots ?? []) {
      if (!this.inCategory(s.category)) continue;
      const item: DownloadClientItem = {
        downloadId: s.nzo_id,
        title: s.name,
        totalSize: s.bytes ?? 0,
        remainingSize: 0,
        status: 'downloading',
        canBeRemoved: false,
        canMoveFiles: false,
      };
      if (s.category) item.category = s.category;
      if (s.status === 'Completed') {
        item.status = 'completed';
        item.canBeRemoved = true;
        item.canMoveFiles = true;
        if (s.storage) item.outputPath = s.storage;
      } else if (s.status === 'Failed') {
        item.status = 'failed';
        item.canBeRemoved = true;
        item.message = s.fail_message || 'Download failed';
      } else {
        item.remainingSize = 0;
        item.message = s.status;
      }
      items.push(item);
    }
    return items;
  }

  async removeItem(downloadId: string, deleteData: boolean): Promise<void> {
    const del_files = deleteData ? '1' : '0';
    await this.api({ mode: 'queue', name: 'delete', value: downloadId, del_files });
    await this.api({ mode: 'history', name: 'delete', value: downloadId, del_files });
  }
}
