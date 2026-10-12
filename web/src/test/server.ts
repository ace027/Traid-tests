import { vi } from 'vitest';
import { resetInitializeCache } from '../lib/api';

export interface MockRequest {
  method: string;
  /** Path below /api/v3, without the query string (e.g. 'rootfolder/1'). */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
}

export type MockHandler = (req: MockRequest) => MockResponse | unknown;

/** Routes keyed by 'METHOD path', e.g. 'GET rootfolder' or 'DELETE tag/:id'. */
export type MockRoutes = Record<string, MockHandler>;

export interface MockApi {
  /** Every API request seen so far, in order. */
  calls: MockRequest[];
  /** Requests matching 'METHOD path' (as written in the route table, or the literal path). */
  callsTo: (method: string, path: string) => MockRequest[];
  restore: () => void;
}

const isResponse = (v: unknown): v is MockResponse =>
  typeof v === 'object' && v !== null && ('status' in v || 'body' in v) && Object.keys(v).every((k) => k === 'status' || k === 'body');

function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/**
 * Replaces global fetch with an in-memory API. Serves /initialize.json itself and
 * answers unknown API routes with 404. Call restore() (or vi.unstubAllGlobals) after the test.
 */
export function mockApi(routes: MockRoutes, init: { apiKey?: string; urlBase?: string } = {}): MockApi {
  resetInitializeCache();
  const calls: MockRequest[] = [];
  const table = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ');
    return { method, pattern: pattern.replace(/^\/+/, ''), handler };
  });

  const json = (status: number, body: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    if (url.pathname === '/initialize.json') {
      return json(200, {
        apiKey: init.apiKey ?? 'test-key',
        urlBase: init.urlBase ?? '',
        instanceName: 'Sonarr',
        version: '0.0.0-test',
      });
    }
    const method = (options?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^.*?\/api\/v3\//, '');
    const body = typeof options?.body === 'string' ? JSON.parse(options.body) : undefined;

    for (const route of table) {
      if (route.method !== method) continue;
      const params = matchRoute(route.pattern, path);
      if (!params) continue;
      const req: MockRequest = { method, path, params, query: url.searchParams, body };
      calls.push(req);
      const result = route.handler(req);
      if (isResponse(result)) return json(result.status ?? 200, result.body);
      return json(200, result);
    }
    calls.push({ method, path, params: {}, query: url.searchParams, body });
    return json(404, { message: `No mock for ${method} ${path}` });
  });

  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    callsTo: (method, path) => calls.filter((c) => c.method === method && (c.path === path || matchRoute(path.replace(/^\/+/, ''), c.path) !== null)),
    restore: () => {
      vi.unstubAllGlobals();
      resetInitializeCache();
    },
  };
}

/** Sonarr-style 400 body for one invalid property. */
export const validation400 = (propertyName: string, errorMessage: string): MockResponse => ({
  status: 400,
  body: { message: 'Validation failed', errors: [{ propertyName, errorMessage }] },
});
