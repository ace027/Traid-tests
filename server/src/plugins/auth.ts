import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function registerAuth(app: FastifyInstance, getApiKey: () => string): void {
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const protectedPath =
      path === '/api' || path.startsWith('/api/') || path === '/feed' || path.startsWith('/feed/');
    if (!protectedPath) return;
    const header = request.headers['x-api-key'];
    const query = (request.query as Record<string, unknown> | undefined)?.apikey;
    const raw = Array.isArray(header) ? header[0] : header;
    const provided = raw ?? (typeof query === 'string' ? query : undefined);
    if (typeof provided !== 'string' || !safeEqual(provided, getApiKey())) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
  });
}
