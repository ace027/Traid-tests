import type { FastifyInstance } from 'fastify';
import type { ServerEvent } from '@sonarr/shared';

const HEARTBEAT_MS = 15_000;

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  const open = new Set<() => void>();

  app.addHook('preClose', async () => {
    for (const end of [...open]) end();
  });

  app.get('/api/v3/events', (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const header = request.headers['last-event-id'];
    const rawLast = (Array.isArray(header) ? header[0] : header) ?? (typeof q.lastEventId === 'string' ? q.lastEventId : '');
    const lastId = /^\d+$/.test(rawLast) ? Number(rawLast) : 0;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');

    const send = (e: ServerEvent) => {
      if (!res.writableEnded) res.write(`id: ${e.id}\nevent: message\ndata: ${JSON.stringify(e)}\n\n`);
    };
    // Subscribe before replay so nothing is missed; skip ids already replayed.
    let high = lastId;
    for (const e of app.events.since(lastId)) {
      send(e);
      high = e.id;
    }
    const unsubscribe = app.events.subscribe((e) => {
      if (e.id > high) {
        high = e.id;
        send(e);
      }
    });
    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(timer);
      unsubscribe();
      open.delete(end);
    };
    const end = () => {
      cleanup();
      if (!res.writableEnded) res.end();
    };
    open.add(end);
    request.raw.on('close', cleanup);
    res.on('close', cleanup);
  });
}
