import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, getHostConfig } from '../app.js';
import type { MetadataProvider } from '../services/metadata/types.js';
import { FakeMetadataProvider } from './fakeMetadata.js';

export interface TestApp {
  app: FastifyInstance;
  apiKey: string;
  dataDir: string;
  metadata: MetadataProvider;
  cleanup: () => Promise<void>;
}

export async function createTestApp(opts: { metadataProvider?: MetadataProvider } = {}): Promise<TestApp> {
  const metadata = opts.metadataProvider ?? new FakeMetadataProvider();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-test-'));
  const app = await buildApp({ dataDir, metadataProvider: metadata });
  return {
    app,
    apiKey: getHostConfig(app.db).apiKey,
    dataDir,
    metadata,
    cleanup: async () => {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
