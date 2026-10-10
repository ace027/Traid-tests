import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './server';

const port = Number(process.env.PORT) || 8787;
const distDir = resolve(process.cwd(), 'dist');
const staticDir = existsSync(resolve(distDir, 'index.html')) ? distDir : undefined;

const server = await startServer({ port, staticDir });
console.log(
  staticDir
    ? `Realm Rush listening on http://localhost:${server.port} (client + ws://localhost:${server.port}/ws)`
    : `Realm Rush server listening on ws://localhost:${server.port}`,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
