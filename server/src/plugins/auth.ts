import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isLocalRequest, parseCookies, SESSION_COOKIE, type AuthService } from '../services/auth.js';

export type AuthVia = 'apikey' | 'session' | 'external' | 'local';

export interface RequestAuth {
  /** How the request was authorized, or null when it was not. */
  via: AuthVia | null;
  /** The caller's session token when it presented a valid one. */
  sessionToken?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth;
  }
}

/** Routes anyone may call. Everything under /api and /feed is protected unless listed here. */
const PUBLIC_ROUTES = new Set(['/ping', '/initialize.json', '/login', '/logout', '/initialize/setup']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
const isProtectedPath = (path: string) => isUnder(path, '/api') || isUnder(path, '/feed');

function decodedPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  try {
    return decodeURIComponent(path).toLowerCase();
  } catch {
    return path.toLowerCase();
  }
}

/** The query-string key is only accepted where a header cannot be sent (EventSource, feed readers). */
const allowsQueryKey = (route: string | undefined) => route === '/api/v3/events' || (route?.startsWith('/feed/') ?? false);

const firstHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Works out how (and whether) a request is authorized, in order: X-Api-Key header, apikey query
 * (only when allowed), session cookie, then the 'external' and local-address bypasses. The
 * bypasses stay off while first-run setup is pending.
 */
export function resolveAuth(auth: AuthService, request: FastifyRequest, opts: { allowQueryKey?: boolean } = {}): RequestAuth {
  const header = firstHeader(request.headers['x-api-key']);
  if (header !== undefined) return { via: auth.isValidApiKey(header) ? 'apikey' : null };
  if (opts.allowQueryKey) {
    const query = (request.query as Record<string, unknown> | undefined)?.apikey;
    if (typeof query === 'string') return { via: auth.isValidApiKey(query) ? 'apikey' : null };
  }
  const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
  if (token && auth.validateSession(token)) return { via: 'session', sessionToken: token };
  if (auth.setupRequired()) return { via: null };
  const settings = auth.settings();
  if (settings.method === 'external') return { via: 'external' };
  if (settings.required === 'disabledForLocalAddresses' && isLocalRequest(request.socket.remoteAddress, request.headers)) {
    return { via: 'local' };
  }
  return { via: null };
}

/**
 * Requests not authorized by an API key ride on ambient credentials (cookie, proxy, network), so
 * state-changing ones must prove they came from script: JSON content type or X-Requested-With.
 * Neither can be sent cross-origin without a CORS preflight, which this server never grants.
 */
export function passesCsrfCheck(request: FastifyRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  if (request.auth.via === 'apikey' || request.auth.via === null) return true;
  const type = firstHeader(request.headers['content-type'])?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/json' || firstHeader(request.headers['x-requested-with']) !== undefined;
}

/** Allowlist auth: public routes pass, /api and /feed need a credential, everything else is public. */
export function registerAuth(app: FastifyInstance, auth: AuthService): void {
  app.decorateRequest('auth', null as unknown as RequestAuth);
  app.addHook('onRequest', async (request, reply) => {
    request.auth = { via: null };
    // Judge by the matched route pattern and the decoded raw path, so encodings cannot slip past.
    const route = request.routeOptions.url;
    if (route !== undefined && PUBLIC_ROUTES.has(route)) return;
    const isProtected = (route !== undefined && isProtectedPath(route)) || isProtectedPath(decodedPath(request.url));
    if (!isProtected) return;

    request.auth = resolveAuth(auth, request, { allowQueryKey: allowsQueryKey(route) });
    if (request.auth.via === null) return reply.code(401).send({ message: 'Unauthorized' });
    if (!passesCsrfCheck(request)) return reply.code(403).send({ message: 'Forbidden' });
  });
}
