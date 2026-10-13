/** Shape returned by GET /initialize.json (unauthenticated bootstrap for the UI). */
export interface InitializeConfig {
  /** Non-empty only when the request was authorized (session, external auth or local bypass). */
  apiKey: string;
  urlBase: string;
  instanceName: string;
  version: string;
  authMethod: 'forms' | 'external';
  setupRequired: boolean;
  authenticated: boolean;
}

export interface ApiValidationError {
  propertyName: string;
  errorMessage: string;
}

/** Thrown for every non-2xx response. `errors` carries the server's validation errors (400). */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: ApiValidationError[];

  constructor(status: number, message: string, errors: ApiValidationError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }

  /** First validation message for a property (e.g. 'path'), for inline field errors. */
  fieldError(propertyName: string): string | undefined {
    return this.errors.find((e) => e.propertyName.toLowerCase() === propertyName.toLowerCase())?.errorMessage;
  }
}

let initializePromise: Promise<InitializeConfig> | null = null;

/**
 * URL base the page was served under, from `<base href>` (document.baseURI). Without a
 * <base> element the app is assumed to live at the root.
 */
export function detectUrlBase(): string {
  if (typeof document === 'undefined' || !document.querySelector('base[href]')) return '';
  try {
    return normalizeUrlBase(new URL(document.baseURI).pathname);
  } catch {
    return '';
  }
}

/** Loads initialize.json once and caches it. A failed load is not cached. */
export function loadInitialize(): Promise<InitializeConfig> {
  if (!initializePromise) {
    initializePromise = (async () => {
      const res = await fetch(`${detectUrlBase()}/initialize.json`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new ApiError(res.status, `Failed to load initialize.json (${res.status})`);
      const data = (await res.json()) as Partial<InitializeConfig>;
      const apiKey = data.apiKey ?? '';
      return {
        apiKey,
        urlBase: normalizeUrlBase(data.urlBase ?? ''),
        instanceName: data.instanceName ?? 'Sonarr',
        version: data.version ?? '',
        authMethod: data.authMethod === 'external' ? 'external' : 'forms',
        setupRequired: data.setupRequired === true,
        authenticated: data.authenticated ?? Boolean(apiKey),
      };
    })();
    initializePromise.catch(() => {
      initializePromise = null;
    });
  }
  return initializePromise;
}

/** Clears the cached initialize.json (tests, after login/logout, or after the API key is regenerated). */
export function resetInitializeCache(): void {
  initializePromise = null;
}

function normalizeUrlBase(urlBase: string): string {
  const trimmed = urlBase.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Sends the browser to the login page (full navigation so all state is dropped). */
export function redirectToLogin(urlBase: string): void {
  if (typeof window === 'undefined') return;
  const target = `${urlBase}/login`;
  if (window.location.pathname === target) return;
  window.location.assign(target);
}

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiFetchInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Serialized as JSON when defined. */
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
}

/** Builds `${urlBase}/api/v3/<path>?<query>`. */
export function buildApiUrl(urlBase: string, path: string, query?: Record<string, QueryValue>): string {
  const clean = path.replace(/^\/+/, '');
  let url = `${urlBase}/api/v3/${clean}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Calls the Sonarr v3 API: prefixes urlBase + '/api/v3', sends X-Api-Key and
 * JSON, parses the JSON response and throws ApiError for non-2xx statuses.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { apiKey, urlBase } = await loadInitialize();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Marks the request as script-originated; the server requires it (or JSON) for cookie-auth writes.
    'X-Requested-With': 'XMLHttpRequest',
    ...init.headers,
  };
  // Without a key the session cookie authenticates the request.
  if (apiKey) headers['X-Api-Key'] = apiKey;
  const hasBody = init.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  const res = await fetch(buildApiUrl(urlBase, path, init.query), {
    method: init.method ?? (hasBody ? 'POST' : 'GET'),
    headers,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    credentials: 'same-origin',
  });

  const data = await readBody(res);
  if (res.status === 401) {
    resetInitializeCache();
    redirectToLogin(urlBase);
  }
  if (!res.ok) throw errorFrom(res, data);
  return data as T;
}

function errorFrom(res: Response, data: unknown): ApiError {
  const payload = (data && typeof data === 'object' ? data : {}) as { message?: unknown; errors?: unknown };
  const message =
    typeof payload.message === 'string' && payload.message
      ? payload.message
      : typeof data === 'string' && data
        ? data
        : res.statusText || `Request failed with status ${res.status}`;
  const list = Array.isArray(payload.errors) ? payload.errors : Array.isArray(data) ? data : [];
  const errors = (list as ApiValidationError[]).filter((e) => e && typeof e.errorMessage === 'string');
  return new ApiError(res.status, message, errors);
}

/** POSTs JSON to an auth endpoint below the URL base. Never redirects on 401. */
async function authPost(path: string, body?: unknown): Promise<void> {
  const { urlBase } = await loadInitialize().catch(() => ({ urlBase: detectUrlBase() }));
  const res = await fetch(`${urlBase}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  });
  const data = await readBody(res);
  resetInitializeCache();
  if (!res.ok) throw errorFrom(res, data);
}

export interface LoginInput {
  username: string;
  password: string;
  rememberMe: boolean;
}

/** Logs in with forms credentials; the server sets the session cookie. Throws ApiError (401, 429). */
export const login = (input: LoginInput) => authPost('/login', input);

/** Ends the session and clears the cookie. */
export const logout = () => authPost('/logout');

/** First-run setup: stores the credentials and logs the caller in. Throws ApiError (400, 409). */
export const setup = (input: { username: string; password: string }) => authPost('/initialize/setup', input);

type Opts = Omit<ApiFetchInit, 'method' | 'body'>;

export const get = <T>(path: string, opts?: Opts) => apiFetch<T>(path, { ...opts, method: 'GET' });
export const post = <T>(path: string, body?: unknown, opts?: Opts) =>
  apiFetch<T>(path, { ...opts, method: 'POST', body });
export const put = <T>(path: string, body?: unknown, opts?: Opts) => apiFetch<T>(path, { ...opts, method: 'PUT', body });
export const del = <T = void>(path: string, opts?: Opts) => apiFetch<T>(path, { ...opts, method: 'DELETE' });

export const api = { fetch: apiFetch, get, post, put, del };

/**
 * TanStack Query keys. List keys are prefixes of their detail keys, so
 * invalidating `queryKeys.tags` also refreshes `queryKeys.tag(id)`.
 */
export const queryKeys = {
  rootFolders: ['rootfolder'] as const,
  rootFolder: (id: number) => ['rootfolder', id] as const,
  tags: ['tag'] as const,
  tag: (id: number) => ['tag', id] as const,
  qualityDefinitions: ['qualitydefinition'] as const,
  qualityProfiles: ['qualityprofile'] as const,
  qualityProfile: (id: number) => ['qualityprofile', id] as const,
  qualityProfileSchema: ['qualityprofile', 'schema'] as const,
  hostConfig: ['config', 'host'] as const,
  uiConfig: ['config', 'ui'] as const,
  commands: ['command'] as const,
  command: (id: number) => ['command', id] as const,
  systemStatus: ['system', 'status'] as const,
} as const;
