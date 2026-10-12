import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { schema } from '../db/index.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

describe('commands', () => {
  it('runs Housekeeping to completion', async () => {
    t = await createTestApp();
    const res = await req('POST', '/api/v3/command', { name: 'Housekeeping' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Housekeeping', status: 'queued', trigger: 'manual' });
    await t.app.commands.waitForIdle();
    const got = (await req('GET', `/api/v3/command/${res.json().id}`)).json();
    expect(got.status).toBe('completed');
    expect(got.started).toBeTruthy();
    expect(got.ended).toBeTruthy();
    expect(got.duration).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
    expect((await req('GET', '/api/v3/command')).json()[0].id).toBe(got.id);
  });

  it('rejects unknown names and bad bodies, 404s', async () => {
    t = await createTestApp();
    const res = await req('POST', '/api/v3/command', { name: 'Nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: 'Unknown command' });
    expect((await req('POST', '/api/v3/command', {})).statusCode).toBe(400);
    expect((await req('GET', '/api/v3/command/999')).statusCode).toBe(404);
    expect((await req('DELETE', '/api/v3/command/999')).statusCode).toBe(404);
  });

  it('records failures with the handler message', async () => {
    t = await createTestApp();
    t.app.commands.register('Explode', async () => {
      throw new Error('kaboom');
    });
    const id = (await req('POST', '/api/v3/command', { name: 'Explode' })).json().id;
    await t.app.commands.waitForIdle();
    expect((await req('GET', `/api/v3/command/${id}`)).json()).toMatchObject({ status: 'failed', message: 'kaboom' });
  });

  it('de-dupes identical queued commands but not different bodies', async () => {
    t = await createTestApp();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: unknown[] = [];
    t.app.commands.register('Slow', async ({ body }) => {
      seen.push(body);
      await gate;
    });
    const first = (await req('POST', '/api/v3/command', { name: 'Slow', seriesId: 1 })).json(); // starts running
    const q1 = (await req('POST', '/api/v3/command', { name: 'Slow', seriesId: 2, a: 1, b: 2 })).json();
    const q2 = (await req('POST', '/api/v3/command', { name: 'Slow', b: 2, a: 1, seriesId: 2 })).json();
    const q3 = (await req('POST', '/api/v3/command', { name: 'Slow', seriesId: 3 })).json();
    expect(q2.id).toBe(q1.id);
    expect(q3.id).not.toBe(q1.id);
    // one at a time per name
    expect(seen).toHaveLength(1);
    // cancel a queued one; started one cannot be cancelled
    expect((await req('DELETE', `/api/v3/command/${q3.id}`)).statusCode).toBe(200);
    expect((await req('GET', `/api/v3/command/${q3.id}`)).json().status).toBe('aborted');
    expect((await req('DELETE', `/api/v3/command/${first.id}`)).statusCode).toBe(400);
    release();
    await t.app.commands.waitForIdle();
    expect(seen).toHaveLength(2);
    expect((await req('GET', `/api/v3/command/${q1.id}`)).json().status).toBe('completed');
    expect((await req('GET', `/api/v3/command/${q3.id}`)).json().status).toBe('aborted');
  });

  it('different names run concurrently', async () => {
    t = await createTestApp();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    t.app.commands.register('Gate', async () => gate);
    const g = (await req('POST', '/api/v3/command', { name: 'Gate' })).json();
    const h = (await req('POST', '/api/v3/command', { name: 'Housekeeping' })).json();
    for (let i = 0; i < 50 && (await req('GET', `/api/v3/command/${h.id}`)).json().status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await req('GET', `/api/v3/command/${h.id}`)).json().status).toBe('completed');
    expect((await req('GET', `/api/v3/command/${g.id}`)).json().status).toBe('started');
    release();
    await t.app.commands.waitForIdle();
  });

  it('publishes command events', async () => {
    t = await createTestApp();
    await req('POST', '/api/v3/command', { name: 'Housekeeping' });
    await t.app.commands.waitForIdle();
    const evs = t.app.events.since(0).filter((e) => e.name === 'command');
    expect(evs.map((e) => [e.action, (e.resource as { status: string }).status])).toEqual([
      ['created', 'queued'],
      ['updated', 'started'],
      ['updated', 'completed'],
    ]);
  });

  it('recovers from restart: started rows fail, queued rows run', async () => {
    t = await createTestApp();
    const now = new Date().toISOString();
    t.app.db.insert(schema.commands).values({ name: 'Housekeeping', body: '{}', status: 'started', trigger: 'manual', queuedAt: now, startedAt: now }).run();
    t.app.db.insert(schema.commands).values({ name: 'Housekeeping', body: '{"x":1}', status: 'queued', trigger: 'manual', queuedAt: now }).run();
    await t.app.close();
    const app2 = await buildApp({ dataDir: t.dataDir });
    await app2.commands.waitForIdle();
    const rows = app2.db.select().from(schema.commands).orderBy(schema.commands.id).all();
    expect(rows[0]).toMatchObject({ status: 'failed', message: 'Interrupted by restart' });
    expect(rows[0]!.endedAt).toBeTruthy();
    expect(rows[1]).toMatchObject({ status: 'completed' });
    await app2.close();
    t = { ...t, cleanup: async () => fs.rmSync(t!.dataDir, { recursive: true, force: true }) };
  });
});
