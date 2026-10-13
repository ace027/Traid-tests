import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import net from 'node:net';
import { eq, lt, ne } from 'drizzle-orm';
import type { AuthenticationMethod, AuthenticationRequired } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';
import { getHostConfig, getPasswordHash, setPasswordHash } from './hostConfig.js';

export const SESSION_COOKIE = 'SonarrAuth';
export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 6;

// ---- passwords -------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const scryptOptions = (N: number): ScryptOptions => ({ N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * N * SCRYPT_R });

/** Hashes a password as `scrypt$N$salt$hash` (base64 salt and hash, 16-byte random salt). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, scryptOptions(SCRYPT_N));
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Verifies a password against a stored hash in constant time. Malformed hashes never verify. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  // Bound N so a tampered database cannot make each login burn unbounded CPU and memory.
  if (!Number.isInteger(N) || N < 1024 || N > 1 << 20 || (N & (N - 1)) !== 0) return false;
  const salt = Buffer.from(parts[2]!, 'base64');
  const expected = Buffer.from(parts[3]!, 'base64');
  if (salt.length < 16 || expected.length < 32) return false;
  const actual = await scryptAsync(password, salt, expected.length, scryptOptions(N));
  return timingSafeEqual(actual, expected);
}

/** Constant-time string comparison (length differences return false immediately). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---- local addresses ---------------------------------------------------------

const localV4 = new net.BlockList();
localV4.addSubnet('127.0.0.0', 8, 'ipv4');
localV4.addSubnet('10.0.0.0', 8, 'ipv4');
localV4.addSubnet('172.16.0.0', 12, 'ipv4');
localV4.addSubnet('192.168.0.0', 16, 'ipv4');
localV4.addSubnet('169.254.0.0', 16, 'ipv4');

const localV6 = new net.BlockList();
localV6.addAddress('::1', 'ipv6');
localV6.addSubnet('fc00::', 7, 'ipv6');
localV6.addSubnet('fe80::', 10, 'ipv6');

/** Extracts the IPv4 address from an IPv4-mapped IPv6 address (dotted or hex form). */
function unmapIPv4(ip: string): string | null {
  const m = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/i.exec(ip);
  if (!m) return null;
  const rest = m[1]!;
  if (net.isIPv4(rest)) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for loopback, RFC 1918, link-local and unique-local addresses (and their IPv4-mapped forms). */
export function isLocalAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const addr = ip.replace(/%.*$/, '');
  if (net.isIPv4(addr)) return localV4.check(addr, 'ipv4');
  if (!net.isIPv6(addr)) return false;
  const mapped = unmapIPv4(addr);
  if (mapped) return localV4.check(mapped, 'ipv4');
  return localV6.check(addr, 'ipv6');
}

export const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host', 'x-forwarded-proto'] as const;

/** A request that went through a proxy is never local, whatever the peer address is. */
export function hasProxyHeaders(headers: Record<string, unknown>): boolean {
  return PROXY_HEADERS.some((h) => headers[h] !== undefined);
}

export function isLocalRequest(ip: string | undefined, headers: Record<string, unknown>): boolean {
  return !hasProxyHeaders(headers) && isLocalAddress(ip);
}

// ---- cookies -----------------------------------------------------------------

/** Parses a Cookie header. First occurrence of a name wins; values are URI-decoded when possible. */
export function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const raw = Array.isArray(header) ? header.join(';') : header;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || out.has(name)) continue;
    let value = part.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value
    }
    out.set(name, value);
  }
  return out;
}

export interface CookieOptions {
  path: string;
  maxAgeSeconds?: number;
  secure?: boolean;
}

export function serializeSessionCookie(value: string, opts: CookieOptions): string {
  const parts = [`${SESSION_COOKIE}=${value}`, `Path=${opts.path}`, 'HttpOnly', 'SameSite=Strict'];
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  if (opts.maxAgeSeconds === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

// ---- login rate limiting -------------------------------------------------------

/** In-memory failed-login limiter: `max` failures per key within `windowMs` blocks further attempts. */
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds until the key may try again, or 0 when not blocked. */
  retryAfter(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((list[list.length - this.max]! + this.windowMs - this.now()) / 1000));
  }

  recordFailure(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
    if (this.failures.size > this.maxKeys) {
      // Bound memory: drop the oldest key.
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

// ---- service -------------------------------------------------------------------

export interface AuthSettings {
  apiKey: string;
  method: AuthenticationMethod;
  required: AuthenticationRequired;
  username: string;
  hasPassword: boolean;
  urlBase: string;
}

export interface NewSession {
  token: string;
  expiresAt: number;
  /** Set only for remember-me sessions (persistent cookie). */
  maxAgeSeconds?: number;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const LAST_SEEN_RESOLUTION_MS = 60_000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Credentials, sessions and a cached snapshot of the auth-related host settings. */
export class AuthService {
  private cache: AuthSettings | null = null;
  readonly limiter = new LoginRateLimiter();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Auth settings, cached in memory. Call invalidate() after changing the host config or password. */
  settings(): AuthSettings {
    if (!this.cache) {
      const host = getHostConfig(this.db);
      this.cache = {
        apiKey: host.apiKey,
        method: host.authenticationMethod,
        required: host.authenticationRequired,
        username: host.username,
        hasPassword: getPasswordHash(this.db) !== null,
        urlBase: host.urlBase,
      };
    }
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** True while forms auth is selected but no password has been stored yet. */
  setupRequired(): boolean {
    const s = this.settings();
    return s.method === 'forms' && !s.hasPassword;
  }

  isValidApiKey(key: string | undefined): boolean {
    return typeof key === 'string' && key.length > 0 && safeEqual(key, this.settings().apiKey);
  }

  async setPassword(password: string): Promise<void> {
    setPasswordHash(this.db, await hashPassword(password));
    this.invalidate();
  }

  /** Stores a hash computed earlier (lets callers re-check state synchronously before writing). */
  storePasswordHash(hash: string): void {
    setPasswordHash(this.db, hash);
    this.invalidate();
  }

  async verifyCredentials(username: string, password: string): Promise<boolean> {
    const stored = getPasswordHash(this.db);
    const expectedUser = this.settings().username;
    // Always run scrypt so response time does not reveal whether the username matched.
    const passwordOk = stored
      ? await verifyPassword(password, stored)
      : (await hashPassword(password), false);
    const userOk = safeEqual(username.trim().toLowerCase(), expectedUser.toLowerCase());
    return Boolean(stored) && userOk && passwordOk;
  }

  createSession(rememberMe: boolean): NewSession {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const ttl = rememberMe ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_MS;
    const expiresAt = now + ttl;
    this.db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).run();
    this.db
      .insert(schema.sessions)
      .values({ tokenHash: sha256(token), createdAt: now, expiresAt, lastSeenAt: now })
      .run();
    return { token, expiresAt, maxAgeSeconds: rememberMe ? Math.floor(ttl / 1000) : undefined };
  }

  /** True when the token belongs to an unexpired session. Expired sessions are deleted. */
  validateSession(token: string | undefined): boolean {
    if (!token || !TOKEN_RE.test(token)) return false;
    const hash = sha256(token);
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hash)).get();
    if (!row) return false;
    const now = this.now();
    if (row.expiresAt <= now) {
      this.db.delete(schema.sessions).where(eq(schema.sessions.id, row.id)).run();
      return false;
    }
    if (now - row.lastSeenAt >= LAST_SEEN_RESOLUTION_MS) {
      this.db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, row.id)).run();
    }
    return true;
  }

  revokeSession(token: string | undefined): void {
    if (!token || !TOKEN_RE.test(token)) return;
    this.db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).run();
  }

  /** Revokes every session, optionally keeping the caller's own. */
  revokeAllSessions(exceptToken?: string): void {
    if (exceptToken && TOKEN_RE.test(exceptToken)) {
      this.db.delete(schema.sessions).where(ne(schema.sessions.tokenHash, sha256(exceptToken))).run();
    } else {
      this.db.delete(schema.sessions).run();
    }
  }

  /** Count of live sessions (diagnostics and tests). */
  sessionCount(): number {
    const now = this.now();
    return this.db.select().from(schema.sessions).all().filter((s) => s.expiresAt > now).length;
  }
}
