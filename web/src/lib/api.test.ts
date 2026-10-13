import { QueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, buildApiUrl, del, login, post, queryKeys, resetInitializeCache } from './api';
import { backoffDelay, getConnectionStatus, startEventStream } from './events';

const init = { apiKey: 'abc123', urlBase: '/sonarr', instanceName: 'Sonarr', version: '1.0.0' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, reqInit?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/initialize.json') return json(init);
    return handler(url, reqInit);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  resetInitializeCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('apiFetch', () => {
  it('prefixes urlBase + /api/v3 and sends the API key and JSON', async () => {
    const fetchMock = mockFetch(() => json({ id: 1, label: 'hd' }, 201));
    const tag = await post<{ id: number }>('/tag', { label: 'hd' });
    expect(tag).toEqual({ id: 1, label: 'hd' });

    const [url, reqInit] = fetchMock.mock.calls[1];
    expect(url).toBe('/sonarr/api/v3/tag');
    const headers = reqInit!.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('abc123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(reqInit!.method).toBe('POST');
    expect(reqInit!.body).toBe(JSON.stringify({ label: 'hd' }));
  });

  it('caches initialize.json across calls', async () => {
    const fetchMock = mockFetch(() => json([]));
    await apiFetch('tag');
    await apiFetch('rootfolder');
    const initCalls = fetchMock.mock.calls.filter(([u]) => u === '/initialize.json');
    expect(initCalls).toHaveLength(1);
  });

  it('retries initialize.json after a failure', async () => {
    let fail = true;
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/initialize.json') {
        if (fail) {
          fail = false;
          return new Response('nope', { status: 503 });
        }
        return json(init);
      }
      return json([]);
    });
    vi.stubGlobal('fetch', fn);
    await expect(apiFetch('tag')).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch('tag')).resolves.toEqual([]);
  });

  it('throws ApiError with the server validation errors on 400', async () => {
    mockFetch(() =>
      json(
        { message: 'Validation failed', errors: [{ propertyName: 'path', errorMessage: 'Path does not exist' }] },
        400,
      ),
    );
    const err = await apiFetch('rootfolder', { body: { path: '/nope' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.message).toBe('Validation failed');
    expect(apiErr.errors).toEqual([{ propertyName: 'path', errorMessage: 'Path does not exist' }]);
    expect(apiErr.fieldError('path')).toBe('Path does not exist');
  });

  it('uses the status text when the error body is not JSON and handles 204', async () => {
    mockFetch((url) =>
      url.endsWith('/tag/1')
        ? new Response(null, { status: 204 })
        : new Response('', { status: 500, statusText: 'Internal Server Error' }),
    );
    await expect(del('tag/1')).resolves.toBeUndefined();
    await expect(apiFetch('boom')).rejects.toMatchObject({ status: 500, message: 'Internal Server Error', errors: [] });
  });

  it('sends cookies same-origin and omits X-Api-Key when initialize gives no key', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/initialize.json') return json({ ...init, apiKey: '', authenticated: true });
      return json([]);
    });
    vi.stubGlobal('fetch', fn);
    await apiFetch('tag');
    const [initUrl, initReq] = fn.mock.calls[0]!;
    expect(initUrl).toBe('/initialize.json');
    expect(initReq!.credentials).toBe('same-origin');
    const [, reqInit] = fn.mock.calls[1]!;
    expect(reqInit!.credentials).toBe('same-origin');
    const headers = reqInit!.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBeUndefined();
    expect(headers['X-Requested-With']).toBe('XMLHttpRequest');
  });

  it('on 401 resets the initialize cache and navigates to the login page', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/sonarr/settings', assign });
    const fetchMock = mockFetch(() => json({ message: 'Unauthorized' }, 401));
    await expect(apiFetch('tag')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/sonarr/login');
    await expect(apiFetch('tag')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.filter(([u]) => u === '/initialize.json')).toHaveLength(2);
  });

  it('login() posts JSON below the URL base and throws ApiError without redirecting', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetchMock = mockFetch(() => json({ message: 'Invalid username or password' }, 401));
    const err = await login({ username: 'a', password: 'b', rememberMe: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(assign).not.toHaveBeenCalled();
    const [url, reqInit] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/sonarr/login');
    expect(reqInit!.method).toBe('POST');
    expect(JSON.parse(String(reqInit!.body))).toEqual({ username: 'a', password: 'b', rememberMe: true });
    expect((reqInit!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('builds query strings and skips empty values', () => {
    expect(buildApiUrl('', '/command', { page: 2, sort: undefined, desc: true })).toBe('/api/v3/command?page=2&desc=true');
  });
});

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe('startEventStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
  });

  it('is a no-op when EventSource is unavailable', () => {
    vi.stubGlobal('EventSource', undefined);
    const stop = startEventStream(new QueryClient());
    expect(getConnectionStatus()).toBe('disconnected');
    stop();
  });

  it('invalidates the tags query when a tag event arrives and ignores unknown events', async () => {
    mockFetch(() => json([]));
    vi.stubGlobal('EventSource', FakeEventSource);
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const stop = startEventStream(qc);

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('/sonarr/api/v3/events?apikey=abc123');
    expect(getConnectionStatus()).toBe('connecting');
    es.open();
    expect(getConnectionStatus()).toBe('connected');

    es.emit({ id: 1, name: 'tag', action: 'created', at: new Date().toISOString() });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.tags });

    spy.mockClear();
    es.emit({ id: 2, name: 'somethingelse', action: 'created', at: '' });
    es.onmessage?.(new MessageEvent('message', { data: 'not json' }));
    expect(spy).not.toHaveBeenCalled();

    stop();
    expect(es.closed).toBe(true);
    expect(getConnectionStatus()).toBe('disconnected');
  });

  it('relies on the session cookie when initialize gives no key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...init, apiKey: '' })));
    vi.stubGlobal('EventSource', FakeEventSource);
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toBe('/sonarr/api/v3/events');
    stop();
  });

  it('reconnects with exponential backoff after the stream closes and resyncs', async () => {
    mockFetch(() => json([]));
    vi.stubGlobal('EventSource', FakeEventSource);
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const stop = startEventStream(qc);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    vi.useFakeTimers();
    FakeEventSource.instances[0].fail();
    expect(getConnectionStatus()).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1].fail();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    FakeEventSource.instances[2].open();
    expect(getConnectionStatus()).toBe('connected');
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.tags });
    stop();
  });

  it('caps the backoff at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});
