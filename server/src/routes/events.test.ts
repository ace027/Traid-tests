import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../services/events.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

describe('EventBus', () => {
  it('assigns increasing ids and timestamps', () => {
    const bus = new EventBus();
    const a = bus.publish('tag', 'created', { id: 1 });
    const b = bus.publish('tag', 'deleted');
    expect(b.id).toBe(a.id + 1);
    expect(a.resource).toEqual({ id: 1 });
    expect(Number.isNaN(Date.parse(a.at))).toBe(false);
  });

  it('caps the ring buffer at 500 and supports since()', () => {
    const bus = new EventBus();
    for (let i = 0; i < 600; i++) bus.publish('x', 'sync');
    const all = bus.since(0);
    expect(all).toHaveLength(500);
    expect(all[0]!.id).toBe(101);
    expect(bus.since(595).map((e) => e.id)).toEqual([596, 597, 598, 599, 600]);
    expect(bus.since(600)).toEqual([]);
  });

  it('unsubscribes and isolates throwing listeners', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const off = bus.subscribe((e) => seen.push(e.id));
    bus.publish('x', 'sync');
    off();
    bus.publish('x', 'sync');
    expect(seen).toEqual([1]);
    expect(bus.listenerCount).toBe(1);
  });
});

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

async function readUntil(res: Response, pred: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    if (pred(text)) break;
  }
  reader.releaseLock();
  return text;
}

describe('GET /api/v3/events', () => {
  it('requires auth', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ url: '/api/v3/events' })).statusCode).toBe(401);
  });

  it('streams events, resumes with Last-Event-ID and cleans up on close', async () => {
    t = await createTestApp();
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const headers = { 'x-api-key': t.apiKey };
    const ctl = new AbortController();
    const stream = await fetch(`${base}/api/v3/events`, { headers, signal: ctl.signal });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(stream.headers.get('cache-control')).toBe('no-cache');
    // wait for the subscription to be registered
    for (let i = 0; i < 50 && t.app.events.listenerCount === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(t.app.events.listenerCount).toBe(1);

    await fetch(`${base}/api/v3/tag`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'one' }) });
    const text = await readUntil(stream, (s) => s.includes('data:'));
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '))!;
    const ev = JSON.parse(dataLine.slice(6));
    expect(ev).toMatchObject({ name: 'tag', action: 'created' });
    expect(text).toContain(`id: ${ev.id}`);

    await fetch(`${base}/api/v3/tag`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'two' }) });
    const ctl2 = new AbortController();
    const resumed = await fetch(`${base}/api/v3/events`, { headers: { ...headers, 'last-event-id': String(ev.id) }, signal: ctl2.signal });
    const text2 = await readUntil(resumed, (s) => s.includes('data:'));
    const events2 = text2.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    expect(events2).toHaveLength(1);
    expect(events2[0].resource.label).toBe('two');
    expect(events2[0].id).toBeGreaterThan(ev.id);

    ctl.abort();
    ctl2.abort();
    for (let i = 0; i < 100 && t.app.events.listenerCount > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(t.app.events.listenerCount).toBe(0);
  });

  it('accepts the apikey query param and publishes update/delete events', async () => {
    t = await createTestApp();
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const tag = (await t.app.inject({ method: 'POST', url: '/api/v3/tag', headers: { 'x-api-key': t.apiKey }, payload: { label: 'q' } })).json();
    await t.app.inject({ method: 'DELETE', url: `/api/v3/tag/${tag.id}`, headers: { 'x-api-key': t.apiKey } });
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/v3/events?apikey=${t.apiKey}&lastEventId=0`, { signal: ctl.signal });
    const text = await readUntil(res, (s) => s.includes('"deleted"'));
    expect(text).toContain('"created"');
    expect(text).toContain('"deleted"');
    ctl.abort();
  });
});
