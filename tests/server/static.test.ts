import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { startServer } from '../../src/server/server';
import type { RunningServer } from '../../src/server/server';

let dir: string;
let server: RunningServer;

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), 'rr-static-'));
  dir = join(root, 'dist');
  mkdirSync(dir);
  writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
  writeFileSync(join(dir, 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'secret.json'), '{"s":1}');
  server = await startServer({ port: 0, staticDir: dir });
});

afterEach(async () => {
  await server.close();
  rmSync(join(dir, '..'), { recursive: true, force: true });
});

// node:http request so '..' segments are not normalised away by fetch
function get(path: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('static serving', () => {
  it('serves index.html at /', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.type).toContain('text/html');
    expect(r.body).toBe('<h1>hi</h1>');
  });

  it('serves js with its content type', async () => {
    const r = await get('/app.js');
    expect(r.status).toBe(200);
    expect(r.type).toContain('application/javascript');
  });

  it('404s on missing files', async () => {
    expect((await get('/nope.js')).status).toBe(404);
  });

  it('rejects path traversal', async () => {
    expect((await get('/../secret.json')).status).toBe(404);
    expect((await get('/%2e%2e/secret.json')).status).toBe(404);
    expect((await get('/..%2fsecret.json')).status).toBe(404);
    expect((await get('/%2e%2e%2fsecret.json')).status).toBe(404);
  });

  it('accepts websocket clients on /ws', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const reply = new Promise<string>((resolve) => ws.once('message', (d) => resolve(d.toString())));
    ws.send(JSON.stringify({ t: 'ping' }));
    expect(JSON.parse(await reply)).toEqual({ t: 'pong' });
    ws.close();
  });
});
