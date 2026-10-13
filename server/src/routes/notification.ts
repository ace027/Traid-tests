import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  notificationInputSchema,
  validationError,
  type NotificationImplementation,
  type NotificationInput,
  type NotificationResource,
} from '@sonarr/shared';
import { schema } from '../db/index.js';
import { activateNotificationDispatcher, createProvider, registerNotificationDispatcher, scrub, secretsOf, type NotificationRow } from '../notifications/dispatcher.js';
import { getHostConfig } from '../services/hostConfig.js';

const MASK = '********';

const capitalise = (impl: string): NotificationImplementation =>
  (impl === 'discord' ? 'Discord' : impl === 'email' ? 'Email' : 'Webhook') as NotificationImplementation;

/** A URL carrying credentials or a query string may hold secrets, so it is only returned masked. */
function maskUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const u = new URL(value);
    return u.username || u.password || u.search ? MASK : value;
  } catch {
    return MASK;
  }
}

function maskSettings(implementation: string, settings: Record<string, unknown>): Record<string, unknown> {
  const out = { ...settings };
  if (implementation === 'webhook') {
    out.url = maskUrl(out.url);
    if (out.password) out.password = MASK;
  } else if (implementation === 'discord') {
    out.webHookUrl = MASK;
  } else if (out.password) {
    out.password = MASK;
  }
  return out;
}

const SECRET_KEYS = ['url', 'webHookUrl', 'password'] as const;

/** Replaces '********' placeholders in a request body with the stored secrets (when the stored row has the same implementation). */
function unmask(body: unknown, stored: NotificationRow | undefined): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, unknown>;
  if (!b.settings || typeof b.settings !== 'object') return body;
  const settings = { ...(b.settings as Record<string, unknown>) };
  if (stored && stored.implementation === String(b.implementation).toLowerCase()) {
    const old = JSON.parse(stored.settings) as Record<string, unknown>;
    for (const key of SECRET_KEYS) if (settings[key] === MASK && key in old) settings[key] = old[key];
  }
  return { ...b, settings };
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  registerNotificationDispatcher(app);

  const find = (id: number) => app.db.select().from(schema.notifications).where(eq(schema.notifications.id, id)).get();
  const byName = (name: string) => app.db.select().from(schema.notifications).where(eq(schema.notifications.name, name)).get();
  const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

  const toResource = (row: NotificationRow): NotificationResource => ({
    id: row.id,
    name: row.name,
    implementation: capitalise(row.implementation),
    onGrab: row.onGrab,
    onDownload: row.onDownload,
    onUpgrade: row.onUpgrade,
    onRename: row.onRename,
    onSeriesAdd: row.onSeriesAdd,
    onSeriesDelete: row.onSeriesDelete,
    onEpisodeFileDelete: row.onEpisodeFileDelete,
    onEpisodeFileDeleteForUpgrade: row.onEpisodeFileDeleteForUpgrade,
    onHealthIssue: row.onHealthIssue,
    onHealthRestored: row.onHealthRestored,
    includeHealthWarnings: row.includeHealthWarnings,
    tags: JSON.parse(row.tags) as number[],
    settings: maskSettings(row.implementation, JSON.parse(row.settings) as Record<string, unknown>),
  });

  function checkTags(tags: number[]): void {
    const existing = new Set(app.db.select({ id: schema.tags.id }).from(schema.tags).all().map((t) => t.id));
    for (const id of tags) if (!existing.has(id)) throw validationError('tags', `Tag ${id} does not exist`);
  }

  function toColumns(input: NotificationInput) {
    return {
      name: input.name,
      implementation: input.implementation.toLowerCase(),
      onGrab: input.onGrab,
      onDownload: input.onDownload,
      onUpgrade: input.onUpgrade,
      onRename: input.onRename,
      onSeriesAdd: input.onSeriesAdd,
      onSeriesDelete: input.onSeriesDelete,
      onEpisodeFileDelete: input.onEpisodeFileDelete,
      onEpisodeFileDeleteForUpgrade: input.onEpisodeFileDeleteForUpgrade,
      onHealthIssue: input.onHealthIssue,
      onHealthRestored: input.onHealthRestored,
      includeHealthWarnings: input.includeHealthWarnings,
      tags: JSON.stringify([...new Set(input.tags)]),
      settings: JSON.stringify(input.settings),
    };
  }

  const publish = (action: 'created' | 'updated' | 'deleted', row: NotificationRow) =>
    app.events.publish('notification', action, toResource(row) as unknown as Record<string, unknown>);

  /** Sends a test message; returns null on success or a redacted failure message. */
  async function runTest(row: NotificationRow): Promise<string | null> {
    let secrets: string[] = [];
    try {
      secrets = secretsOf(JSON.parse(row.settings) as Record<string, unknown>);
      const ctx = { instanceName: getHostConfig(app.db).instanceName, applicationUrl: '' };
      await createProvider(row, ctx).test();
      return null;
    } catch (e) {
      return scrub((e as Error).message || 'Test failed', secrets);
    }
  }

  app.get('/api/v3/notification', async () => app.db.select().from(schema.notifications).orderBy(schema.notifications.name).all().map(toResource));

  app.get('/api/v3/notification/schema', async () => {
    const flags = {
      onGrab: true,
      onDownload: true,
      onUpgrade: true,
      onRename: false,
      onSeriesAdd: false,
      onSeriesDelete: false,
      onEpisodeFileDelete: false,
      onEpisodeFileDeleteForUpgrade: false,
      onHealthIssue: false,
      onHealthRestored: false,
      includeHealthWarnings: false,
    };
    const template = (implementation: NotificationImplementation, settings: Record<string, unknown>) => ({
      implementation,
      implementationName: implementation,
      name: '',
      ...flags,
      tags: [] as number[],
      settings,
    });
    return [
      template('Webhook', { url: '', method: 'POST', username: '', password: '' }),
      template('Discord', { webHookUrl: '', username: '', avatar: '' }),
      template('Email', { server: '', port: 587, useEncryption: 'preferred', username: '', password: '', from: '', to: [], cc: [], bcc: [] }),
    ];
  });

  app.post('/api/v3/notification/test', async (req, reply) => {
    const raw = (req.body ?? {}) as { id?: unknown };
    const id = typeof raw.id === 'number' ? raw.id : 0;
    const input = notificationInputSchema.parse(unmask(req.body, id ? find(id) : undefined));
    const failure = await runTest({ id, ...toColumns(input) });
    if (failure) return reply.code(400).send({ message: failure });
    return {};
  });

  app.post('/api/v3/notification/testall', async () => {
    const results: { id: number; isValid: boolean; validationFailures: { propertyName: string; errorMessage: string }[] }[] = [];
    for (const row of app.db.select().from(schema.notifications).orderBy(schema.notifications.id).all()) {
      const failure = await runTest(row);
      if (failure) app.health.reportNotificationFailure(row.id);
      else app.health.clearNotificationFailure(row.id);
      results.push({
        id: row.id,
        isValid: !failure,
        validationFailures: failure ? [{ propertyName: '', errorMessage: failure }] : [],
      });
    }
    return results;
  });

  app.get<{ Params: { id: string } }>('/api/v3/notification/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toResource(row);
  });

  app.post('/api/v3/notification', async (req, reply) => {
    const input = notificationInputSchema.parse(req.body);
    if (byName(input.name)) throw validationError('name', 'Name must be unique');
    checkTags(input.tags);
    const row = app.db.insert(schema.notifications).values(toColumns(input)).returning().get();
    activateNotificationDispatcher(app);
    publish('created', row);
    return reply.code(201).send(toResource(row));
  });

  app.put<{ Params: { id: string } }>('/api/v3/notification/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const existing = find(id);
    if (!existing) return reply.code(404).send({ message: 'NotFound' });
    const input = notificationInputSchema.parse(unmask(req.body, existing));
    const dup = byName(input.name);
    if (dup && dup.id !== id) throw validationError('name', 'Name must be unique');
    checkTags(input.tags);
    const row = app.db.update(schema.notifications).set(toColumns(input)).where(eq(schema.notifications.id, id)).returning().get();
    // a changed configuration starts with a clean failure state
    app.health.clearNotificationFailure(id);
    publish('updated', row);
    return toResource(row);
  });

  app.delete<{ Params: { id: string } }>('/api/v3/notification/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    app.db.delete(schema.notifications).where(eq(schema.notifications.id, row.id)).run();
    app.health.clearNotificationFailure(row.id);
    publish('deleted', row);
    return reply.code(200).send({});
  });
}

