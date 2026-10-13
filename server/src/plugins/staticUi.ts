import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export interface StaticUiOptions {
  /** Normalized URL base ('' or '/base'); requests arrive with it already stripped. */
  urlBase: string;
  /** Directory holding the built UI. Defaults to web/dist next to the server package. */
  webDist?: string;
}

/** web/dist relative to server/src/plugins. */
export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

const isUnder = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`);

/** Injects <base href> and prefixes root-absolute asset URLs so the UI works below a URL base. */
export function renderIndex(html: string, urlBase: string): string {
  let out = html;
  if (urlBase) {
    out = out.replace(/(\s(?:src|href)=")\/(?!\/)/gi, `$1${urlBase}/`);
  }
  const base = `<base href="${urlBase}/" />`;
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n    ${base}`) : `${base}${out}`;
}

/**
 * Serves the built UI. Skipped (with an info log) when web/dist has no index.html. Unknown GET
 * requests that accept HTML outside /api and /feed get index.html (SPA fallback); everything else
 * keeps the JSON 404.
 */
export async function staticUi(app: FastifyInstance, opts: StaticUiOptions): Promise<void> {
  const root = path.resolve(opts.webDist ?? DEFAULT_WEB_DIST);
  const indexPath = path.join(root, 'index.html');
  let template: string;
  try {
    template = fs.readFileSync(indexPath, 'utf8');
  } catch {
    app.log.info(`Web UI not found at ${root}; skipping static serving. Run "npm run build" first.`);
    return;
  }
  const indexHtml = renderIndex(template, opts.urlBase);

  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    index: false,
    cacheControl: false,
    globIgnore: ['index.html'],
    setHeaders: (reply, filePath) => {
      const hashed = filePath.split(path.sep).includes('assets');
      reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  app.get('/*', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? '';
    const accept = String(request.headers.accept ?? '');
    if (isUnder(pathname, '/api') || isUnder(pathname, '/feed') || !accept.includes('text/html')) {
      return reply.code(404).send({ message: 'NotFound' });
    }
    return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml);
  });
}
