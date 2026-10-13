/**
 * Server for the Playwright smoke tests: the real app and built UI with fake metadata, indexer and
 * download client, a temp data dir, media root and downloads dir. Test-only endpoints (/e2e-info,
 * /e2e-hook) are registered here and nowhere else.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../app.js';
import { setDownloadClientFactory } from '../downloadClients/registry.js';
import type { DownloadClient, DownloadClientItem, ReleaseToAdd } from '../downloadClients/types.js';
import { setIndexerClientFactory } from '../indexers/registry.js';
import type { IndexerClient, ReleaseInfo, SearchCriteria } from '../indexers/types.js';
import { FakeMetadataProvider } from '../test/fakeMetadata.js';

const PORT = Number(process.env.E2E_PORT ?? 8990);
const AUX_PORT = Number(process.env.E2E_AUX_PORT ?? 8991);
const HOST = '127.0.0.1';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-e2e-'));
const dataDir = path.join(root, 'data');
const mediaRoot = path.join(root, 'media');
const downloadsDir = path.join(root, 'downloads');
for (const d of [dataDir, mediaRoot, downloadsDir]) fs.mkdirSync(d, { recursive: true });

const dotted = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '.');
const pad = (n: number) => String(n).padStart(2, '0');

/** One deterministic approved release per search, named after the searched series. */
function releaseFor(criteria: SearchCriteria): ReleaseInfo[] {
  const name = dotted(criteria.series.title);
  let title: string;
  if (criteria.type === 'season') title = `${name}.S${pad(criteria.seasonNumber)}.1080p.WEB-DL-E2E`;
  else if (criteria.type === 'episode') title = `${name}.S${pad(criteria.seasonNumber)}E${pad(criteria.episodeNumbers[0] ?? 1)}.1080p.WEB-DL-E2E`;
  else return [];
  return [
    {
      guid: `e2e-${title}`,
      title,
      size: 1_500_000_000,
      publishDate: new Date().toISOString(),
      downloadUrl: `http://indexer.e2e/download/${title}`,
      indexerId: 1,
      indexer: 'E2E Indexer',
      indexerPriority: 25,
      protocol: 'usenet',
      categories: [5040],
    },
  ];
}

const fakeIndexer: IndexerClient = {
  async test() {},
  async fetchRss() {
    return [];
  },
  async search(criteria) {
    return releaseFor(criteria);
  },
};

/** Downloads complete after the second RefreshMonitoredDownloads command. */
let refreshes = 0;
// Every file gets a unique size: the importer treats a same-sized file in the library as already imported.
let fileCounter = 0;
const grabbed: { downloadId: string; title: string; dir: string }[] = [];

const fakeClient: DownloadClient = {
  async test() {},
  async addRelease(release: ReleaseToAdd) {
    const downloadId = `e2e-${grabbed.length + 1}`;
    const dir = path.join(downloadsDir, release.title);
    fs.mkdirSync(dir, { recursive: true });
    const season = /\.S(\d+)\./.exec(release.title);
    const episodes = season ? [1, 2] : [Number(/E(\d+)/.exec(release.title)?.[1] ?? 1)];
    for (const e of episodes) {
      const base = season ? release.title.replace(/\.S(\d+)\./, `.S$1E${pad(e)}.`) : release.title;
      fs.writeFileSync(path.join(dir, `${base}.mkv`), Buffer.alloc(4096 + ++fileCounter, e));
    }
    refreshes = 0; // each new grab starts its own two-refresh countdown
    grabbed.push({ downloadId, title: release.title, dir });
    return downloadId;
  },
  async getItems(): Promise<DownloadClientItem[]> {
    const done = refreshes >= 2;
    return grabbed.map((g) => ({
      downloadId: g.downloadId,
      title: g.title,
      category: 'tv',
      totalSize: 1_500_000_000,
      remainingSize: done ? 0 : 750_000_000,
      remainingTimeSeconds: done ? 0 : 60,
      status: done ? 'completed' : 'downloading',
      outputPath: g.dir,
      canBeRemoved: done,
      canMoveFiles: done,
    }));
  },
  async removeItem(downloadId) {
    const i = grabbed.findIndex((g) => g.downloadId === downloadId);
    if (i >= 0) grabbed.splice(i, 1);
  },
};

setIndexerClientFactory(() => fakeIndexer);
setDownloadClientFactory(() => fakeClient);

const app = await buildApp({
  dataDir,
  logger: Boolean(process.env.E2E_LOG),
  metadataProvider: new FakeMetadataProvider(),
  scheduler: false,
});

// The app is already built and ready here, so it takes no more routes or hooks. Test-only
// endpoints live on a second tiny HTTP server instead.
app.events.subscribe((event) => {
  const name = (event.resource as { name?: string } | undefined)?.name;
  if (event.name === 'command' && event.action === 'created' && name === 'RefreshMonitoredDownloads') refreshes++;
});

const hooks: unknown[] = [];
const aux = http.createServer((req, res) => {
  const send = (body: unknown) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const url = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && url === '/e2e-info') return send({ rootFolder: mediaRoot, downloadsDir, dataDir });
  if (url === '/e2e-hook' && req.method === 'GET') return send(hooks);
  if (url === '/e2e-hook' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        hooks.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        hooks.push(null);
      }
      send({ ok: true });
    });
    return;
  }
  res.statusCode = 404;
  send({ message: 'NotFound' });
});

try {
  await app.listen({ host: HOST, port: PORT });
  await new Promise<void>((resolve, reject) => {
    aux.once('error', reject);
    aux.listen(AUX_PORT, HOST, resolve);
  });
  console.log(`E2E server listening on http://${HOST}:${PORT}, test endpoints on :${AUX_PORT} (data in ${root})`);
} catch (err) {
  console.error(`E2E server failed to start on port ${PORT} or ${AUX_PORT} (already in use?)`, err);
  process.exit(1);
}

const stop = async () => {
  aux.close();
  await app.close().catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
