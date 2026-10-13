import type { DownloadClient, DownloadClientItem, ReleaseToAdd } from '../downloadClients/types.js';
import { DownloadClientError } from '../downloadClients/types.js';

export interface AddedRelease {
  release: ReleaseToAdd;
  torrentFile?: Uint8Array;
  downloadId: string;
}

/** In-memory download client for tests: records adds and removals and serves a mutable item list. */
export class FakeDownloadClient implements DownloadClient {
  added: AddedRelease[] = [];
  removed: { downloadId: string; deleteData: boolean }[] = [];
  items: DownloadClientItem[] = [];
  /** When set, every call rejects with this message. */
  failure: string | null = null;
  testCalls = 0;
  private counter = 0;

  constructor(private readonly idPrefix = 'fake') {}

  private check(): void {
    if (this.failure) throw new DownloadClientError(this.failure);
  }

  async test(): Promise<void> {
    this.testCalls++;
    this.check();
  }

  async addRelease(release: ReleaseToAdd, torrentFile?: Uint8Array): Promise<string> {
    this.check();
    const downloadId = `${this.idPrefix}-${++this.counter}`;
    const added: AddedRelease = { release, downloadId };
    if (torrentFile) added.torrentFile = torrentFile;
    this.added.push(added);
    return downloadId;
  }

  async getItems(): Promise<DownloadClientItem[]> {
    this.check();
    return this.items.map((i) => ({ ...i }));
  }

  async removeItem(downloadId: string, deleteData: boolean): Promise<void> {
    this.check();
    this.removed.push({ downloadId, deleteData });
    this.items = this.items.filter((i) => i.downloadId !== downloadId);
  }

  /** Builds a complete item with sensible defaults. */
  static item(over: Partial<DownloadClientItem> & { downloadId: string }): DownloadClientItem {
    return {
      title: over.downloadId,
      totalSize: 1000,
      remainingSize: 500,
      status: 'downloading',
      canBeRemoved: false,
      canMoveFiles: false,
      ...over,
    };
  }
}
