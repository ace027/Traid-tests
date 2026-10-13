import type { IndexerClient, ReleaseInfo, SearchCriteria } from '../indexers/types.js';

export type FakeCall =
  | { method: 'test' }
  | { method: 'fetchRss' }
  | { method: 'search'; criteria: SearchCriteria };

export class FakeIndexerClient implements IndexerClient {
  calls: FakeCall[] = [];
  /** When set, every call rejects with it. */
  error?: Error;

  constructor(public releases: ReleaseInfo[] = []) {}

  async test(): Promise<void> {
    this.calls.push({ method: 'test' });
    if (this.error) throw this.error;
  }

  async fetchRss(): Promise<ReleaseInfo[]> {
    this.calls.push({ method: 'fetchRss' });
    if (this.error) throw this.error;
    return this.releases;
  }

  async search(criteria: SearchCriteria): Promise<ReleaseInfo[]> {
    this.calls.push({ method: 'search', criteria });
    if (this.error) throw this.error;
    return this.releases;
  }
}

let counter = 0;

export function makeRelease(partial: Partial<ReleaseInfo> = {}): ReleaseInfo {
  counter += 1;
  return {
    guid: `guid-${counter}`,
    title: `Show.Name.S01E01.1080p.WEB-DL-GRP${counter}`,
    size: 1_500_000_000,
    publishDate: new Date().toISOString(),
    downloadUrl: `http://indexer.test/download/${counter}`,
    indexerId: 1,
    indexer: 'Fake',
    indexerPriority: 25,
    protocol: 'usenet',
    categories: [5040],
    ...partial,
  };
}
