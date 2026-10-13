import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, getHostConfig } from '../app.js';
import { renderIndex } from './staticUi.js';

const HTML = '<!doctype html><html><head><title>T</title><script src="/assets/a.js"></script></head><body><div id="root"></div></body></html>';

let tmp: string;
let dist: string;
let app: FastifyInstance | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-static-'));
  dist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), HTML);
  fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'console.log(1)');
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const html = { accept: 'text/html' };

async function start(webDist: string) {
  app = await buildApp({ dataDir: path.join(tmp, 'data'), scheduler: false, webDist });
  return app;
}

describe('static UI', () => {
  it('serves hashed assets with a long cache lifetime', async () => {
    const a = await start(dist);
    const res = await a.inject({ url: '/assets/a.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1)');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('serves index.html with a base href on the root and on deep links', async () => {
    const a = await start(dist);
    for (const url of ['/', '/series/abc', '/system/logs/files']) {
      const res = await a.inject({ url, headers: html });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('<base href="/" />');
    }
  });

  it('does not serve index.html for non-HTML requests or missing files', async () => {
    const a = await start(dist);
    expect((await a.inject({ url: '/assets/missing.js' })).statusCode).toBe(404);
    expect((await a.inject({ url: '/series/abc', headers: { accept: 'application/json' } })).statusCode).toBe(404);
  });

  it('keeps JSON 404s and auth for /api and /feed', async () => {
    const a = await start(dist);
    const key = getHostConfig(a.db).apiKey;
    const authed = await a.inject({ url: '/api/v3/unknown', headers: { ...html, 'x-api-key': key } });
    expect(authed.statusCode).toBe(404);
    expect(authed.json()).toEqual({ message: 'NotFound' });
    expect((await a.inject({ url: '/api/v3/unknown', headers: html })).statusCode).toBe(401);
    const feed = await a.inject({ url: '/feed/x', headers: { ...html, 'x-api-key': key } });
    expect(feed.statusCode).toBe(404);
    expect(feed.json()).toEqual({ message: 'NotFound' });
  });

  it('injects the url base below a url base', async () => {
    // The URL base is read at build time, so set it and rebuild.
    const dir = path.join(tmp, 'data');
    const first = await buildApp({ dataDir: dir, scheduler: false, webDist: dist });
    first.updateHostConfig((h) => ({ ...h, urlBase: '/tv' }));
    await first.close();
    app = await buildApp({ dataDir: dir, scheduler: false, webDist: dist });
    const res = await app.inject({ url: '/tv/series/abc', headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<base href="/tv/" />');
    expect(res.body).toContain('src="/tv/assets/a.js"');
    expect((await app.inject({ url: '/tv/assets/a.js' })).statusCode).toBe(200);
  });

  it('skips static serving when the dist folder is missing', async () => {
    const a = await start(path.join(tmp, 'nope'));
    expect((await a.inject({ url: '/', headers: html })).statusCode).toBe(404);
    expect((await a.inject({ url: '/assets/a.js' })).statusCode).toBe(404);
    expect((await a.inject({ url: '/ping' })).statusCode).toBe(200);
  });

  it('renderIndex only prefixes root-absolute urls', () => {
    const out = renderIndex('<head><link href="//cdn/x.css"><script src="/a.js"></script><a href="rel">', '/b');
    expect(out).toContain('href="//cdn/x.css"');
    expect(out).toContain('src="/b/a.js"');
    expect(out).toContain('href="rel"');
  });
});
