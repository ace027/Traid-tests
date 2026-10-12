import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, getHostConfig } from '../app.js';

export interface TestApp {
  app: FastifyInstance;
  apiKey: string;
  dataDir: string;
  cleanup: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-test-'));
  const app = await buildApp({ dataDir });
  return {
    app,
    apiKey: getHostConfig(app.db).apiKey,
    dataDir,
    cleanup: async () => {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
