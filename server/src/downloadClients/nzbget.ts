import type { DownloadClientSettings } from '@sonarr/shared';
import {
  DownloadClientError,
  MIB,
  basicAuth,
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

interface Group {
  NZBID: number;
  NZBName: string;
  Category?: string;
  FileSizeMB?: number;
  RemainingSizeMB?: number;
  PausedSizeMB?: number;
  Status: string;
}

interface HistoryEntry {
  NZBID: number;
  Name: string;
  Category?: string;
  FileSizeMB?: number;
  Status?: string;
  ParStatus?: string;
  ScriptStatus?: string;
  DeleteStatus?: string;
  DestDir?: string;
  FinalDir?: string;
}

const failure = (v: string | undefined) => (v ?? '').toUpperCase().startsWith('FAILURE');

export class NzbgetClient implements DownloadClient {
  private readonly fetch: FetchFn;

  constructor(
    private readonly settings: DownloadClientSettings,
    deps: ClientDeps = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
  }

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const res = await request(this.fetch, `${buildBaseUrl(this.settings)}/jsonrpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...basicAuth(this.settings) },
      body: JSON.stringify({ method, params, id: 1 }),
    });
    if (!res.ok) throw httpError(res);
    const body = await readJson<{ result?: T; error?: { message?: string } }>(res);
    if (body.error) throw new DownloadClientError(`NZBGet error: ${body.error.message ?? 'request failed'}`);
    return body.result as T;
  }

  async test(): Promise<void> {
    await this.rpc<string>('version');
  }

  async addRelease(release: ReleaseToAdd): Promise<string> {
    const id = await this.rpc<number>('append', [
      `${release.title}.nzb`,
      release.downloadUrl,
      this.settings.category,
      0,
      false,
      false,
      '',
      0,
      'SCORE',
      [],
    ]);
    if (!(id > 0)) throw new DownloadClientError('NZBGet rejected the download');
    return String(id);
  }

  private inCategory(cat: string | undefined): boolean {
    const want = this.settings.category;
    return !want || (cat ?? '').toLowerCase() === want.toLowerCase();
  }

  async getItems(): Promise<DownloadClientItem[]> {
    const [groups, history, status] = await Promise.all([
      this.rpc<Group[]>('listgroups', [0]),
      this.rpc<HistoryEntry[]>('history', [false]),
      this.rpc<{ DownloadRate?: number }>('status'),
    ]);
    const rate = status?.DownloadRate ?? 0;
    const items: DownloadClientItem[] = [];
    for (const g of groups ?? []) {
      if (!this.inCategory(g.Category)) continue;
      const left = Math.round((g.RemainingSizeMB ?? 0) * MIB);
      const st = g.Status.toUpperCase();
      const status: DownloadClientItem['status'] =
        st === 'PAUSED' ? 'paused' : st === 'QUEUED' || st === 'PP_QUEUED' ? 'queued' : 'downloading';
      const item: DownloadClientItem = {
        downloadId: String(g.NZBID),
        title: g.NZBName,
        totalSize: Math.round((g.FileSizeMB ?? 0) * MIB),
        remainingSize: left,
        status,
        canBeRemoved: false,
        canMoveFiles: false,
      };
      if (g.Category) item.category = g.Category;
      if (status === 'downloading' && rate > 0 && left > 0) item.remainingTimeSeconds = Math.ceil(left / rate);
      items.push(item);
    }
    for (const h of history ?? []) {
      if (!this.inCategory(h.Category)) continue;
      const item: DownloadClientItem = {
        downloadId: String(h.NZBID),
        title: h.Name,
        totalSize: Math.round((h.FileSizeMB ?? 0) * MIB),
        remainingSize: 0,
        status: 'downloading',
        canBeRemoved: false,
        canMoveFiles: false,
      };
      if (h.Category) item.category = h.Category;
      const del = (h.DeleteStatus ?? 'NONE').toUpperCase();
      if (failure(h.Status) || failure(h.ParStatus) || failure(h.ScriptStatus) || failure(h.DeleteStatus) || ['HEALTH', 'BAD', 'MANUAL', 'DUPE'].includes(del)) {
        item.status = 'failed';
        item.canBeRemoved = true;
        item.message = [h.Status, h.ParStatus, h.ScriptStatus, h.DeleteStatus]
          .filter((s) => s && s.toUpperCase() !== 'NONE' && s.toUpperCase() !== 'SUCCESS')
          .join(', ') || 'Download failed';
      } else if ((h.Status ?? '').toUpperCase().startsWith('SUCCESS') || [h.ParStatus, h.ScriptStatus].some((s) => (s ?? '').toUpperCase() === 'SUCCESS')) {
        item.status = 'completed';
        item.canBeRemoved = true;
        item.canMoveFiles = true;
        const dir = h.FinalDir || h.DestDir;
        if (dir) item.outputPath = dir;
      } else if ((h.Status ?? '').toUpperCase().startsWith('WARNING')) {
        item.status = 'warning';
        item.message = h.Status as string;
      }
      items.push(item);
    }
    return items;
  }

  async removeItem(downloadId: string, deleteData: boolean): Promise<void> {
    const id = Number(downloadId);
    if (!Number.isInteger(id)) throw new DownloadClientError('Invalid NZBGet download id');
    const removed = await this.rpc<boolean>('editqueue', [deleteData ? 'GroupFinalDelete' : 'GroupDelete', '', [id]]);
    if (removed) return;
    await this.rpc<boolean>('editqueue', [deleteData ? 'HistoryFinalDelete' : 'HistoryDelete', '', [id]]);
  }
}
