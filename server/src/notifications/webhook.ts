import type { WebhookSettings } from '@sonarr/shared';
import { buildWebhookPayload } from './payload.js';
import { NotificationError, type NotificationMessage, type NotificationProvider, type ProviderContext, type ProviderDeps } from './types.js';

export const REQUEST_TIMEOUT_MS = 10_000;
/** Longest a 429 Retry-After is honoured before the single retry. */
export const MAX_RATE_LIMIT_WAIT_MS = 5_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface JsonRequest {
  label: string;
  url: string;
  method: string;
  body: unknown;
  headers?: Record<string, string>;
  /** Wait for a 429 Retry-After and retry once (Discord). */
  retryRateLimit?: boolean;
}

/** Seconds from a Retry-After header or a Discord-style `retry_after` body, capped. */
async function rateLimitDelay(res: Response): Promise<number> {
  let seconds = Number(res.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    try {
      const json = (await res.clone().json()) as { retry_after?: unknown };
      seconds = typeof json.retry_after === 'number' ? json.retry_after : 1;
    } catch {
      seconds = 1;
    }
  }
  return Math.min(Math.ceil(seconds * 1000), MAX_RATE_LIMIT_WAIT_MS);
}

/**
 * POSTs/PUTs JSON with a timeout and one retry on network errors and 5xx responses. Credentials embedded in
 * the URL become a Basic auth header; error messages never contain the URL, its query or credentials.
 */
export async function sendJson(req: JsonRequest, deps: ProviderDeps = {}): Promise<void> {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let target: URL;
  try {
    target = new URL(req.url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw new NotificationError(`${req.label}: the URL is not a valid http(s) URL`);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'Sonarr', ...req.headers };
  if (target.username || target.password) {
    if (!headers.authorization) {
      const user = decodeURIComponent(target.username);
      const pass = decodeURIComponent(target.password);
      headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }
    target.username = '';
    target.password = '';
  }
  const payload = JSON.stringify(req.body);

  let retried = false;
  for (;;) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let res: Response;
    try {
      res = await doFetch(target.toString(), { method: req.method, headers, body: payload, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (!retried) {
        retried = true;
        continue;
      }
      if (timedOut) throw new NotificationError(`${req.label}: request timed out after ${Math.round(timeoutMs / 1000)} s`);
      const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
      throw new NotificationError(`${req.label}: request failed${code ? ` (${code})` : ''}`);
    }
    clearTimeout(timer);
    const status = res.status;
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }
    let delay = 0;
    if (!retried && status === 429 && req.retryRateLimit) delay = await rateLimitDelay(res);
    await res.body?.cancel().catch(() => undefined);
    if (!retried && (status >= 500 || (status === 429 && req.retryRateLimit))) {
      retried = true;
      if (delay > 0) await sleep(delay);
      continue;
    }
    throw new NotificationError(`${req.label}: server responded with HTTP ${status}${status === 429 ? ' (rate limited)' : ''}`, status);
  }
}

export class WebhookProvider implements NotificationProvider {
  constructor(
    private readonly settings: WebhookSettings,
    private readonly ctx: ProviderContext,
    private readonly deps: ProviderDeps = {},
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.settings.username) {
      headers.authorization = `Basic ${Buffer.from(`${this.settings.username}:${this.settings.password}`).toString('base64')}`;
    }
    await sendJson(
      { label: 'Webhook', url: this.settings.url, method: this.settings.method, body: buildWebhookPayload(message, this.ctx), headers },
      this.deps,
    );
  }

  test(): Promise<void> {
    return this.send({
      eventType: 'Test',
      series: { id: 1, title: 'Test Title', path: '/tv/Test Title', tvdbId: 1234, tvMazeId: 1234, type: 'standard' },
      episodes: [{ id: 123, episodeNumber: 1, seasonNumber: 1, title: 'Test title', airDate: '2024-01-01' }],
    });
  }
}
