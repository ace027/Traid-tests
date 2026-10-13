import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, getHostConfig, OUTSIDE_URL_BASE, redactUrl, stripUrlBase } from '../app.js';
import { resolveListenOptions } from '../config.js';
import {
  AuthService,
  hashPassword,
  isLocalAddress,
  LoginRateLimiter,
  parseCookies,
  SESSION_TTL_MS,
  verifyPassword,
} from '../services/auth.js';
import { getPasswordHash } from '../services/hostConfig.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const USER = 'admin';
const PASS = 'correct horse';

/** The `SonarrAuth=<token>` pair from a Set-Cookie header. */
function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['set-cookie'];
  const raw = String(Array.isArray(header) ? header[0] : header);
  return raw.split(';')[0]!;
}

async function setup(app = t!.app) {
  const res = await app.inject({ method: 'POST', url: '/initialize/setup', payload: { username: USER, password: PASS } });
  expect(res.statusCode).toBe(200);
  return sessionCookie(res);
}

const login = (body: Record<string, unknown>, remoteAddress = '203.0.113.9') =>
  t!.app.inject({ method: 'POST', url: '/login', payload: body, remoteAddress });

const initialize = (opts: { remoteAddress?: string; headers?: Record<string, string> } = {}) =>
  t!.app.inject({ url: '/initialize.json', remoteAddress: opts.remoteAddress ?? '203.0.113.9', headers: opts.headers });

const putHost = async (changes: Record<string, unknown>) => {
  const h = (await t!.app.inject({ url: '/api/v3/config/host', headers: { 'x-api-key': t!.apiKey } })).json();
  const res = await t!.app.inject({
    method: 'PUT',
    url: '/api/v3/config/host',
    headers: { 'x-api-key': t!.apiKey },
    payload: { ...h, ...changes },
  });
  return res;
};

describe('first-run setup', () => {
  it('requires setup, creates credentials, logs the caller in, then returns 409', async () => {
    t = await createTestApp();
    expect((await initialize()).json()).toMatchObject({ setupRequired: true, authenticated: false, apiKey: '' });

    const short = await t.app.inject({ method: 'POST', url: '/initialize/setup', payload: { username: USER, password: '12345' } });
    expect(short.statusCode).toBe(400);
    expect(short.json().errors[0].propertyName).toBe('password');

    const res = await t.app.inject({ method: 'POST', url: '/initialize/setup', payload: { username: USER, password: PASS } });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^SonarrAuth=[A-Za-z0-9_-]{43}; /);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Max-Age');
    expect(setCookie).not.toContain('Secure');
    expect(res.headers['cache-control']).toBe('no-store');

    const cookie = sessionCookie(res);
    const init = (await initialize({ headers: { cookie } })).json();
    expect(init).toMatchObject({ setupRequired: false, authenticated: true, apiKey: t.apiKey, authMethod: 'forms' });

    expect(getPasswordHash(t.app.db)).toMatch(/^scrypt\$16384\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    const again = await t.app.inject({ method: 'POST', url: '/initialize/setup', payload: { username: 'evil', password: 'takeover' } });
    expect(again.statusCode).toBe(409);
    expect(getHostConfig(t.app.db).username).toBe(USER);
  });

  it('keeps protected routes closed while setup is pending, even with the local bypass', async () => {
    t = await createTestApp();
    // Configure the bypass through the API key (it works during setup) before any password exists.
    expect((await putHost({ authenticationRequired: 'disabledForLocalAddresses' })).statusCode).toBe(200);
    const res = await t.app.inject({ url: '/api/v3/tag', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(401);
    expect((await initialize({ remoteAddress: '127.0.0.1' })).json().apiKey).toBe('');
  });
});

describe('login and sessions', () => {
  it('logs in with valid credentials and rejects bad ones with 401', async () => {
    t = await createTestApp();
    await setup();
    for (const body of [
      { username: USER, password: 'wrong-password' },
      { username: 'someone', password: PASS },
      { username: '', password: '' },
    ]) {
      const res = await login(body);
      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    const ok = await login({ username: 'Admin', password: PASS });
    expect(ok.statusCode).toBe(200);
    expect(String(ok.headers['set-cookie'])).not.toContain('Max-Age');

    const remember = await login({ username: USER, password: PASS, rememberMe: true });
    expect(String(remember.headers['set-cookie'])).toContain('Max-Age=2592000');
    expect((await login({ username: USER, password: PASS, rememberMe: 'yes' })).statusCode).toBe(400);
  });

  it('returns 429 after 5 failed attempts from one IP, without blocking other IPs', async () => {
    t = await createTestApp();
    await setup();
    for (let i = 0; i < 5; i++) {
      expect((await login({ username: USER, password: `bad-${i}` }, '198.51.100.1')).statusCode).toBe(401);
    }
    const blocked = await login({ username: USER, password: PASS }, '198.51.100.1');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['set-cookie']).toBeUndefined();
    expect((await login({ username: USER, password: PASS }, '198.51.100.2')).statusCode).toBe(200);
  });

  it('grants /api access with a session cookie and revokes it on logout', async () => {
    t = await createTestApp();
    const cookie = await setup();
    expect((await t.app.inject({ url: '/api/v3/tag', remoteAddress: '203.0.113.9' })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/v3/tag', headers: { cookie } })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/v3/tag', headers: { cookie: 'SonarrAuth=forged' } })).statusCode).toBe(401);

    const out = await t.app.inject({ method: 'POST', url: '/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/^SonarrAuth=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0/);
    expect((await t.app.inject({ url: '/api/v3/tag', headers: { cookie } })).statusCode).toBe(401);
    expect((await initialize({ headers: { cookie } })).json()).toMatchObject({ authenticated: false, apiKey: '' });
  });

  it('expires sessions after 12 hours unless remembered', async () => {
    t = await createTestApp();
    let now = 1_000_000;
    const auth = new AuthService(t.app.db, () => now);
    const short = auth.createSession(false);
    const long = auth.createSession(true);
    expect(short.maxAgeSeconds).toBeUndefined();
    now += SESSION_TTL_MS - 1;
    expect(auth.validateSession(short.token)).toBe(true);
    now += 2;
    expect(auth.validateSession(short.token)).toBe(false);
    expect(auth.validateSession(long.token)).toBe(true);
    // Only the hash is stored.
    const rows = t.app.sqlite.prepare('select token_hash from sessions').all() as { token_hash: string }[];
    expect(rows.map((r) => r.token_hash)).not.toContain(long.token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the password write-only and revokes other sessions when it changes', async () => {
    t = await createTestApp();
    const mine = await setup();
    const other = sessionCookie(await login({ username: USER, password: PASS }));
    const h = (await t.app.inject({ url: '/api/v3/config/host', headers: { cookie: mine } })).json();
    expect(h.password).toBe('');
    expect(JSON.stringify(h)).not.toContain('scrypt');

    // Blank password keeps the current one.
    const keep = await t.app.inject({ method: 'PUT', url: '/api/v3/config/host', headers: { cookie: mine }, payload: { ...h, instanceName: 'X' } });
    expect(keep.statusCode).toBe(200);
    expect(keep.json().password).toBe('');
    expect((await login({ username: USER, password: PASS })).statusCode).toBe(200);

    const tooShort = await t.app.inject({ method: 'PUT', url: '/api/v3/config/host', headers: { cookie: mine }, payload: { password: 'abc' } });
    expect(tooShort.statusCode).toBe(400);

    const change = await t.app.inject({ method: 'PUT', url: '/api/v3/config/host', headers: { cookie: mine }, payload: { password: 'new-secret' } });
    expect(change.statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/v3/tag', headers: { cookie: mine } })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/v3/tag', headers: { cookie: other } })).statusCode).toBe(401);
    expect((await login({ username: USER, password: PASS }, '198.51.100.50')).statusCode).toBe(401);
    expect((await login({ username: USER, password: 'new-secret' }, '198.51.100.50')).statusCode).toBe(200);
  });

  it('refuses to switch to forms without credentials', async () => {
    t = await createTestApp();
    expect((await putHost({ authenticationMethod: 'external' })).statusCode).toBe(200);
    const res = await putHost({ authenticationMethod: 'forms' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].propertyName).toBe('password');
    expect((await putHost({ authenticationMethod: 'forms', username: 'me', password: 'secret1' })).statusCode).toBe(200);
  });
});

describe('GET /initialize.json', () => {
  it('returns no key to unauthenticated callers while authentication is enabled', async () => {
    t = await createTestApp();
    await setup();
    const cases: { remoteAddress: string; headers?: Record<string, string> }[] = [
      { remoteAddress: '127.0.0.1' },
      { remoteAddress: '::1' },
      { remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.1' } },
      { remoteAddress: '127.0.0.1', headers: { 'x-forwarded-proto': 'https' } },
      { remoteAddress: '192.168.1.20' },
      { remoteAddress: '172.17.0.1' },
      { remoteAddress: '::ffff:10.0.0.2' },
      { remoteAddress: '203.0.113.9' },
    ];
    for (const c of cases) {
      const res = await initialize(c);
      expect(res.statusCode).toBe(200);
      expect(res.json(), JSON.stringify(c)).toMatchObject({ apiKey: '', authenticated: false, setupRequired: false });
      expect(res.body).not.toContain(t.apiKey);
    }
  });

  it("returns the key with 'external' authentication", async () => {
    t = await createTestApp();
    expect((await putHost({ authenticationMethod: 'external' })).statusCode).toBe(200);
    const res = (await initialize()).json();
    expect(res).toMatchObject({ authMethod: 'external', setupRequired: false, authenticated: true, apiKey: t.apiKey });
    expect((await t.app.inject({ url: '/api/v3/tag', remoteAddress: '203.0.113.9' })).statusCode).toBe(200);
  });

  it('returns the key to local peers with disabledForLocalAddresses, but never through a proxy', async () => {
    t = await createTestApp();
    await setup();
    expect((await putHost({ authenticationRequired: 'disabledForLocalAddresses' })).statusCode).toBe(200);
    for (const remoteAddress of ['192.168.1.20', '127.0.0.1', '::ffff:192.168.0.3', 'fe80::1']) {
      expect((await initialize({ remoteAddress })).json().apiKey, remoteAddress).toBe(t.apiKey);
    }
    expect((await t.app.inject({ url: '/api/v3/tag', remoteAddress: '192.168.1.20' })).statusCode).toBe(200);
    const proxied: Record<string, string>[] = [{ 'x-forwarded-for': '203.0.113.1' }, { forwarded: 'for=203.0.113.1' }, { 'x-real-ip': '1.2.3.4' }, { 'x-forwarded-host': 'a' }];
    for (const headers of proxied) {
      const res = await initialize({ remoteAddress: '127.0.0.1', headers });
      expect(res.json(), JSON.stringify(headers)).toMatchObject({ apiKey: '', authenticated: false });
    }
    expect((await initialize({ remoteAddress: '8.8.8.8' })).json().apiKey).toBe('');
  });
});

describe('API key placement and CSRF', () => {
  it('rejects the apikey query on /api/v3/tag but accepts it on /api/v3/events', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ url: `/api/v3/tag?apikey=${t.apiKey}` })).statusCode).toBe(401);
    expect((await t.app.inject({ url: `/api/v3/events?apikey=wrong` })).statusCode).toBe(401);
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/v3/events?apikey=${t.apiKey}`, { signal: ctl.signal });
    expect(res.status).toBe(200);
    ctl.abort();
  });

  it('rejects cookie-authenticated writes without JSON or X-Requested-With', async () => {
    t = await createTestApp();
    const cookie = await setup();
    const form = await t.app.inject({
      method: 'POST',
      url: '/api/v3/tag',
      headers: { cookie, 'content-type': 'text/plain' },
      payload: '{"label":"x"}',
    });
    expect(form.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/v3/config/host/apikey/reset', headers: { cookie } })).statusCode).toBe(403);
    expect(getHostConfig(t.app.db).apiKey).toBe(t.apiKey);

    const json = await t.app.inject({ method: 'POST', url: '/api/v3/tag', headers: { cookie }, payload: { label: 'ok' } });
    expect(json.statusCode).toBe(201);
    const del = await t.app.inject({ method: 'DELETE', url: `/api/v3/tag/${json.json().id}`, headers: { cookie, 'x-requested-with': 'XMLHttpRequest' } });
    expect(del.statusCode).toBeLessThan(300);
    // API key callers are not subject to the check.
    const keyed = await t.app.inject({ method: 'POST', url: '/api/v3/config/host/apikey/reset', headers: { 'x-api-key': t.apiKey } });
    expect(keyed.statusCode).toBe(200);
  });

  it('applies the CSRF check to bypass-authorized writes too', async () => {
    t = await createTestApp();
    expect((await putHost({ authenticationMethod: 'external' })).statusCode).toBe(200);
    const res = await t.app.inject({ method: 'POST', url: '/api/v3/config/host/apikey/reset', remoteAddress: '203.0.113.9' });
    expect(res.statusCode).toBe(403);
  });

  it('does not fall back to other credentials when a wrong X-Api-Key is sent', async () => {
    t = await createTestApp();
    const cookie = await setup();
    expect((await t.app.inject({ url: '/api/v3/tag', headers: { cookie, 'x-api-key': 'nope' } })).statusCode).toBe(401);
  });

  it('protects percent-encoded API paths', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ url: '/%61pi/v3/config/host', remoteAddress: '203.0.113.9' });
    expect([401, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain(t.apiKey);
  });
});

describe('URL base', () => {
  it.each([
    ['/sonarr', '/'],
    ['/sonarr/', '/'],
    ['/sonarr?x=1', '/?x=1'],
    ['/sonarr/a?b', '/a?b'],
    ['/sonarr/api/v3/tag', '/api/v3/tag'],
    ['/basement', OUTSIDE_URL_BASE],
    ['/sonarrx/api', OUTSIDE_URL_BASE],
    ['/api/v3/tag', OUTSIDE_URL_BASE],
    ['/', OUTSIDE_URL_BASE],
  ])('stripUrlBase(%s, /sonarr) -> %s', (url, expected) => {
    expect(stripUrlBase(url, '/sonarr')).toBe(expected);
  });

  it('leaves URLs alone without a base', () => {
    expect(stripUrlBase('/api/v3/tag?x', '')).toBe('/api/v3/tag?x');
  });

  it('serves the API and /ping under the base and 404s outside it', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-urlbase-'));
    try {
      const first = await buildApp({ dataDir });
      const key = getHostConfig(first.db).apiKey;
      const put = await first.inject({ method: 'PUT', url: '/api/v3/config/host', headers: { 'x-api-key': key }, payload: { urlBase: 'sonarr/' } });
      expect(put.json().urlBase).toBe('/sonarr');
      await first.close();

      const app = await buildApp({ dataDir });
      const headers = { 'x-api-key': key };
      const status = await app.inject({ url: '/sonarr/api/v3/system/status', headers });
      expect(status.statusCode).toBe(200);
      expect(status.json().urlBase).toBe('/sonarr');
      expect((await app.inject({ url: '/sonarr/ping' })).json()).toEqual({ status: 'OK' });
      expect((await app.inject({ url: '/ping' })).statusCode).toBe(200);
      for (const url of ['/api/v3/system/status', '/basement/api/v3/system/status', '/initialize.json']) {
        const res = await app.inject({ url, headers });
        expect(res.statusCode, url).toBe(404);
        expect(res.json()).toEqual({ message: 'NotFound' });
      }
      const init = await app.inject({ url: '/sonarr/initialize.json' });
      expect(init.json().urlBase).toBe('/sonarr');

      const setupRes = await app.inject({ method: 'POST', url: '/sonarr/initialize/setup', payload: { username: USER, password: PASS } });
      expect(String(setupRes.headers['set-cookie'])).toContain('Path=/sonarr;');
      await app.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('helpers', () => {
  it('resolveListenOptions prefers a valid SONARR_PORT and maps *', () => {
    const host = { bindAddress: '*', port: 9000 };
    expect(resolveListenOptions(host, {})).toEqual({ host: '0.0.0.0', port: 9000 });
    expect(resolveListenOptions(host, { SONARR_PORT: '8990' })).toEqual({ host: '0.0.0.0', port: 8990 });
    for (const bad of ['', 'abc', '0', '65536', '80.5', '-1', '1e3']) {
      expect(resolveListenOptions(host, { SONARR_PORT: bad }).port, bad).toBe(9000);
    }
    expect(resolveListenOptions({ bindAddress: '127.0.0.1', port: 1 }, {})).toEqual({ host: '127.0.0.1', port: 1 });
  });

  it('isLocalAddress covers private, loopback and link-local ranges', () => {
    for (const ip of ['127.0.0.1', '127.5.5.5', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '::1', 'fd00::1', 'fc00::1', 'fe80::1', 'fe80::1%eth0', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.1.1']) {
      expect(isLocalAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '203.0.113.9', '2001:db8::1', '::ffff:8.8.8.8', '', 'localhost', undefined]) {
      expect(isLocalAddress(ip), String(ip)).toBe(false);
    }
  });

  it('hashes and verifies passwords with scrypt', async () => {
    const hash = await hashPassword('hunter22');
    expect(hash.split('$')).toHaveLength(4);
    expect(await verifyPassword('hunter22', hash)).toBe(true);
    expect(await verifyPassword('hunter23', hash)).toBe(false);
    expect(await verifyPassword('hunter22', 'scrypt$99999999$AAAA$BBBB')).toBe(false);
    expect(await verifyPassword('hunter22', 'plain')).toBe(false);
    expect(await hashPassword('hunter22')).not.toBe(hash);
  });

  it('rate limiter forgets failures after the window', () => {
    let now = 0;
    const limiter = new LoginRateLimiter(5, 1000, () => now);
    for (let i = 0; i < 5; i++) limiter.recordFailure('a');
    expect(limiter.retryAfter('a')).toBeGreaterThan(0);
    expect(limiter.retryAfter('b')).toBe(0);
    now = 1001;
    expect(limiter.retryAfter('a')).toBe(0);
  });

  it('parses cookies and redacts api keys from logged URLs', () => {
    const c = parseCookies('a=1; SonarrAuth=tok%2D1; SonarrAuth=second; bad; __proto__=x');
    expect(c.get('SonarrAuth')).toBe('tok-1');
    expect(c.get('a')).toBe('1');
    expect(parseCookies(undefined).size).toBe(0);
    expect(redactUrl('/api/v3/events?apikey=secret&x=1')).toBe('/api/v3/events?apikey=***&x=1');
    expect(redactUrl('/feed/x?a=1&APIKEY=secret')).toBe('/feed/x?a=1&APIKEY=***');
  });
});
