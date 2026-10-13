import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUALITIES, type QualityModel } from '@sonarr/shared';
import { recordEvent, recordGrabbed } from '../services/history.js';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { setNotificationProviderFactory, type NotificationRow } from './dispatcher.js';
import { buildDiscordBody, DiscordProvider } from './discord.js';
import { buildWebhookPayload, summary } from './payload.js';
import {
  NotificationError,
  type NotificationMessage,
  type NotificationProvider,
  type ProviderContext,
} from './types.js';
import { WebhookProvider } from './webhook.js';

const ctx: ProviderContext = { instanceName: 'Sonarr', applicationUrl: 'http://sonarr.test' };
const quality: QualityModel = { quality: QUALITIES.find((q) => q.name === 'HDTV-720p')!, revision: { version: 1, real: 0, isRepack: false } };

// ---- providers -----------------------------------------------------------

const sampleMessage: NotificationMessage = {
  eventType: 'Grab',
  series: { id: 7, title: 'Show', path: '/tv/Show', tvdbId: 11, tvMazeId: 22, type: 'standard', posterUrl: 'https://img.test/p.jpg' },
  episodes: [{ id: 70, episodeNumber: 2, seasonNumber: 1, title: 'Title', airDate: '2024-01-02' }],
  release: { quality: 'HDTV-720p', releaseTitle: 'Show.S01E02.720p.HDTV-GRP', indexer: 'NZB', size: 1_500_000_000 },
  downloadClient: 'SAB',
  downloadId: 'abc',
};

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(statuses: (number | Error)[], headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    if (next instanceof Error) throw next;
    return new Response(next === 204 ? null : next >= 200 && next < 300 ? '' : '{}', { status: next, headers });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('summary and payload', () => {
  it('describes events on one line', () => {
    expect(summary(sampleMessage)).toBe('Grabbed: Show - S01E02 - Title [HDTV-720p]');
    expect(summary({ ...sampleMessage, eventType: 'Download', isUpgrade: true })).toMatch(/^Upgraded: Show - S01E02/);
    expect(summary({ eventType: 'Health', health: { level: 'error', message: 'Broken', type: 'X' } })).toBe('Health check failure: Broken');
    expect(summary({ eventType: 'Test' })).toBe('Test notification from Sonarr');
  });

  it('builds the webhook payload shape', () => {
    expect(buildWebhookPayload(sampleMessage, ctx)).toEqual({
      eventType: 'Grab',
      instanceName: 'Sonarr',
      applicationUrl: 'http://sonarr.test',
      series: { id: 7, title: 'Show', path: '/tv/Show', tvdbId: 11, tvMazeId: 22, type: 'standard' },
      episodes: [{ id: 70, episodeNumber: 2, seasonNumber: 1, title: 'Title', airDate: '2024-01-02' }],
      release: { quality: 'HDTV-720p', releaseTitle: 'Show.S01E02.720p.HDTV-GRP', indexer: 'NZB', size: 1_500_000_000 },
      downloadClient: 'SAB',
      downloadId: 'abc',
    });
    const download = buildWebhookPayload(
      { eventType: 'Download', isUpgrade: true, series: sampleMessage.series!, episodeFile: { relativePath: 'S01/a.mkv', path: '/tv/Show/S01/a.mkv', quality: 'HDTV-720p' } },
      ctx,
    );
    expect(download).toMatchObject({ isUpgrade: true, episodeFile: { relativePath: 'S01/a.mkv', path: '/tv/Show/S01/a.mkv', quality: 'HDTV-720p' } });
    expect(buildWebhookPayload({ eventType: 'Health', health: { level: 'warning', message: 'm', type: 'IndexerRssCheck' } }, ctx)).toMatchObject({
      health: { level: 'warning', message: 'm', type: 'IndexerRssCheck' },
    });
  });
});

describe('webhook provider', () => {
  const settings = { url: 'https://hook.test/in', method: 'POST' as const, username: '', password: '' };

  it('posts JSON, uses basic auth when a username is set and supports PUT', async () => {
    const f = fakeFetch([200]);
    await new WebhookProvider({ ...settings, method: 'PUT', username: 'u', password: 'p' }, ctx, { fetch: f.fn }).send(sampleMessage);
    expect(f.calls[0]!.url).toBe('https://hook.test/in');
    expect(f.calls[0]!.init.method).toBe('PUT');
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(JSON.parse(f.calls[0]!.init.body as string).eventType).toBe('Grab');
  });

  it('retries once on 503 and then succeeds', async () => {
    const f = fakeFetch([503, 200]);
    await new WebhookProvider(settings, ctx, { fetch: f.fn }).send(sampleMessage);
    expect(f.calls).toHaveLength(2);
  });

  it('retries once on a network error, then fails without leaking the URL', async () => {
    const f = fakeFetch([new Error('connect ECONNREFUSED https://hook.test/in?token=SECRET')]);
    const err = await new WebhookProvider({ ...settings, url: 'https://hook.test/in?token=SECRET' }, ctx, { fetch: f.fn })
      .send(sampleMessage)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotificationError);
    expect(f.calls).toHaveLength(2);
    expect((err as Error).message).not.toContain('SECRET');
    expect((err as Error).message).not.toContain('hook.test');
  });

  it('does not retry a 4xx and reports the status', async () => {
    const f = fakeFetch([404]);
    const err = (await new WebhookProvider(settings, ctx, { fetch: f.fn }).send(sampleMessage).catch((e: unknown) => e)) as NotificationError;
    expect(f.calls).toHaveLength(1);
    expect(err.status).toBe(404);
    expect(err.message).toContain('404');
  });

  it('moves credentials in the URL into a basic auth header', async () => {
    const f = fakeFetch([200]);
    await new WebhookProvider({ ...settings, url: 'https://us%40er:p%3Ass@hook.test/in?x=1' }, ctx, { fetch: f.fn }).send(sampleMessage);
    expect(f.calls[0]!.url).toBe('https://hook.test/in?x=1');
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from('us@er:p:ss').toString('base64')}`);
    const failing = fakeFetch([500]);
    const err = (await new WebhookProvider({ ...settings, url: 'https://user:hunter2@hook.test/in' }, ctx, { fetch: failing.fn })
      .send(sampleMessage)
      .catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('hunter2');
  });

  it('aborts a request that exceeds the timeout', async () => {
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const err = (await new WebhookProvider(settings, ctx, { fetch: hanging as unknown as typeof fetch, timeoutMs: 20 })
      .send(sampleMessage)
      .catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/timed out/);
    expect(hanging).toHaveBeenCalledTimes(2);
  });

  it('rejects non-http URLs', async () => {
    const f = fakeFetch([200]);
    await expect(new WebhookProvider({ ...settings, url: 'ftp://x/y' }, ctx, { fetch: f.fn }).send(sampleMessage)).rejects.toThrow(/valid http/);
    expect(f.calls).toHaveLength(0);
  });
});

describe('discord provider', () => {
  const settings = { webHookUrl: 'https://discord.com/api/webhooks/123/tokentokentokentoken', username: '', avatar: 'https://img.test/a.png' };

  it('builds an embed with quality, size, indexer and download client', () => {
    const body = buildDiscordBody(sampleMessage, settings, ctx) as { username: string; avatar_url: string; embeds: Record<string, unknown>[] };
    expect(body.username).toBe('Sonarr');
    expect(body.avatar_url).toBe('https://img.test/a.png');
    const embed = body.embeds[0]!;
    expect(embed.title).toBe('Grabbed: Show - S01E02 - Title [HDTV-720p]');
    expect(embed.description).toBe('Show.S01E02.720p.HDTV-GRP');
    expect(embed.fields).toEqual([
      { name: 'Quality', value: 'HDTV-720p', inline: true },
      { name: 'Size', value: '1.4 GB', inline: true },
      { name: 'Indexer', value: 'NZB', inline: true },
      { name: 'Download client', value: 'SAB', inline: true },
    ]);
    expect(embed.thumbnail).toEqual({ url: 'https://img.test/p.jpg' });
    expect(typeof embed.timestamp).toBe('string');
    expect(typeof embed.color).toBe('number');
  });

  it('waits out a 429 once and then succeeds', async () => {
    const f = fakeFetch([429, 204], { 'retry-after': '2' });
    const sleep = vi.fn(async () => undefined);
    await new DiscordProvider(settings, ctx, { fetch: f.fn, sleep }).send(sampleMessage);
    expect(f.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('reports a persistent 429 as rate limited without leaking the token', async () => {
    const f = fakeFetch([429]);
    const err = (await new DiscordProvider(settings, ctx, { fetch: f.fn, sleep: async () => undefined })
      .send(sampleMessage)
      .catch((e: unknown) => e)) as NotificationError;
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/rate limited/);
    expect(err.message).not.toContain('tokentoken');
    expect(f.calls).toHaveLength(2);
  });

  it('retries once on 502', async () => {
    const f = fakeFetch([502, 204]);
    await new DiscordProvider(settings, ctx, { fetch: f.fn }).send(sampleMessage);
    expect(f.calls).toHaveLength(2);
  });
});

// ---- dispatcher ----------------------------------------------------------

interface Sent {
  id: number;
  name: string;
  message: NotificationMessage;
}

let t: TestApp | undefined;
let root: string | undefined;
let sent: Sent[];
let failFor: Set<number>;
let failWith: string;
let gate: Promise<void> | undefined;
let active = 0;
let maxActive = 0;

beforeEach(() => {
  sent = [];
  failFor = new Set();
  failWith = 'boom';
  gate = undefined;
  active = 0;
  maxActive = 0;
  setNotificationProviderFactory((row: NotificationRow): NotificationProvider => ({
    send: async (message) => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (gate) await gate;
        if (failFor.has(row.id)) throw new Error(failWith);
        sent.push({ id: row.id, name: row.name, message });
      } finally {
        active--;
      }
    },
    test: async () => undefined,
  }));
});

afterEach(async () => {
  setNotificationProviderFactory(undefined);
  await t?.cleanup();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  t = undefined;
  root = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

async function setup() {
  t = await createTestApp();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-root-')));
  await req('POST', '/api/v3/rootfolder', { path: root });
  const profileId = (await req('GET', '/api/v3/qualityprofile')).json()[0].id as number;
  const add = async (tvMazeId: number) =>
    (await req('POST', '/api/v3/series', { tvMazeId, qualityProfileId: profileId, rootFolderPath: root })).json().id as number;
  const seriesId = await add(100);
  const episodeIds = (t.app.sqlite.prepare('select id from episodes where series_id = ? order by id').all(seriesId) as { id: number }[]).map((r) => r.id);
  return { seriesId, episodeIds, add };
}

const notify = async (name: string, over: Record<string, unknown> = {}) => {
  const res = await req('POST', '/api/v3/notification', {
    name,
    implementation: 'Webhook',
    onGrab: false,
    onDownload: false,
    onUpgrade: false,
    settings: { url: 'https://hook.test/in' },
    ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as number;
};

const sentTo = (id: number) => sent.filter((s) => s.id === id);
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('notification dispatcher', () => {
  it('sends Grab only to notifications with onGrab, once per grab', async () => {
    const { seriesId, episodeIds } = await setup();
    const grab = await notify('grab', { onGrab: true });
    const none = await notify('none');
    recordGrabbed(t!.app, {
      seriesId,
      episodeIds: [episodeIds[0]!, episodeIds[1]!],
      sourceTitle: 'Show.S01E01E02.720p',
      quality,
      downloadId: 'dl1',
      data: { indexer: 'NZB', downloadClient: 'SAB', size: '1000' },
    });
    await vi.waitFor(() => expect(sentTo(grab)).toHaveLength(1));
    await settle();
    expect(sentTo(grab)).toHaveLength(1);
    expect(sentTo(none)).toHaveLength(0);
    const m = sentTo(grab)[0]!.message;
    expect(m.eventType).toBe('Grab');
    expect(m.episodes).toHaveLength(2);
    expect(m.release).toMatchObject({ quality: 'HDTV-720p', releaseTitle: 'Show.S01E01E02.720p', indexer: 'NZB', size: 1000 });
    expect(m.downloadClient).toBe('SAB');
    expect(m.series?.id).toBe(seriesId);
  });

  it('does not block the publisher', async () => {
    const { seriesId, episodeIds } = await setup();
    await notify('grab', { onGrab: true });
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    recordGrabbed(t!.app, { seriesId, episodeIds: [episodeIds[0]!], sourceTitle: 'x', quality });
    expect(sent).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('filters by tags: tagged notifications skip untagged series', async () => {
    const { seriesId, episodeIds } = await setup();
    const tag = (await req('POST', '/api/v3/tag', { label: 'anime' })).json().id as number;
    const open = await notify('open', { onGrab: true });
    const tagged = await notify('tagged', { onGrab: true, tags: [tag] });
    const grab = () => recordGrabbed(t!.app, { seriesId, episodeIds: [episodeIds[0]!], sourceTitle: 'x', quality });

    grab();
    await vi.waitFor(() => expect(sentTo(open)).toHaveLength(1));
    await settle();
    expect(sentTo(tagged)).toHaveLength(0);

    t!.app.sqlite.prepare('update series set tags = ? where id = ?').run(JSON.stringify([tag]), seriesId);
    grab();
    await vi.waitFor(() => expect(sentTo(tagged)).toHaveLength(1));
    expect(sentTo(open)).toHaveLength(2);
  });

  it('maps an import to Download, and an upgrade import to Download with isUpgrade', async () => {
    const { seriesId, episodeIds } = await setup();
    const both = await notify('both', { onDownload: true, onUpgrade: true });
    const onlyNew = await notify('onlyNew', { onDownload: true, onUpgrade: false });
    const imported = (title: string) =>
      recordEvent(t!.app, 'downloadFolderImported', {
        seriesId,
        episodeIds: [episodeIds[0]!],
        sourceTitle: title,
        quality,
        downloadId: 'dl1',
        data: { importedPath: '/nope/a.mkv', downloadClient: 'SAB' },
      });

    imported('first');
    await vi.waitFor(() => expect(sentTo(both)).toHaveLength(1));
    await vi.waitFor(() => expect(sentTo(onlyNew)).toHaveLength(1));
    expect(sentTo(both)[0]!.message).toMatchObject({ eventType: 'Download', isUpgrade: false, downloadClient: 'SAB' });

    recordEvent(t!.app, 'episodeFileDeleted', {
      seriesId,
      episodeIds: [episodeIds[0]!],
      sourceTitle: 'S01/old.mkv',
      quality,
      data: { reason: 'upgrade', path: '/tv/old.mkv' },
    });
    imported('second');
    await vi.waitFor(() => expect(sentTo(both)).toHaveLength(2));
    await settle();
    expect(sentTo(both)[1]!.message).toMatchObject({ eventType: 'Download', isUpgrade: true });
    // not subscribed to upgrades
    expect(sentTo(onlyNew)).toHaveLength(1);

    // the mark is consumed: a later plain import is not an upgrade
    imported('third');
    await vi.waitFor(() => expect(sentTo(both)).toHaveLength(3));
    expect(sentTo(both)[2]!.message.isUpgrade).toBe(false);
  });

  it('sends EpisodeFileDelete for upgrades only when onEpisodeFileDeleteForUpgrade is set', async () => {
    const { seriesId, episodeIds } = await setup();
    const del = await notify('del', { onEpisodeFileDelete: true });
    const forUpgrade = await notify('forUpgrade', { onEpisodeFileDeleteForUpgrade: true });
    const rec = (reason: string) =>
      recordEvent(t!.app, 'episodeFileDeleted', {
        seriesId,
        episodeIds: [episodeIds[0]!],
        sourceTitle: 'S01/old.mkv',
        quality,
        data: { reason, path: '/tv/old.mkv' },
      });
    rec('upgrade');
    await vi.waitFor(() => expect(sentTo(forUpgrade)).toHaveLength(1));
    await settle();
    expect(sentTo(del)).toHaveLength(0);
    expect(sentTo(forUpgrade)[0]!.message).toMatchObject({ eventType: 'EpisodeFileDelete', deleteReason: 'upgrade' });

    rec('manual');
    await vi.waitFor(() => expect(sentTo(del)).toHaveLength(1));
    await settle();
    expect(sentTo(forUpgrade)).toHaveLength(1);
  });

  it('sends one Rename per series for a batch of renamed files', async () => {
    const { seriesId, episodeIds } = await setup();
    const id = await notify('rename', { onRename: true });
    for (const ep of episodeIds.slice(0, 2)) {
      recordEvent(t!.app, 'episodeFileRenamed', {
        seriesId,
        episodeIds: [ep],
        sourceTitle: 'old.mkv',
        quality,
        data: { path: '/tv/new.mkv', relativePath: 'new.mkv' },
      });
    }
    await vi.waitFor(() => expect(sentTo(id)).toHaveLength(1), { timeout: 3000 });
    await settle();
    expect(sentTo(id)).toHaveLength(1);
    expect(sentTo(id)[0]!.message.eventType).toBe('Rename');
    expect(sentTo(id)[0]!.message.episodes).toHaveLength(2);
  });

  it('sends SeriesAdd and SeriesDelete', async () => {
    const { add } = await setup();
    const id = await notify('series', { onSeriesAdd: true, onSeriesDelete: true });
    const newId = await add(400);
    await vi.waitFor(() => expect(sentTo(id)).toHaveLength(1));
    expect(sentTo(id)[0]!.message).toMatchObject({ eventType: 'SeriesAdd', series: { id: newId } });
    const title = sentTo(id)[0]!.message.series!.title;
    expect((await req('DELETE', `/api/v3/series/${newId}`)).statusCode).toBe(200);
    await vi.waitFor(() => expect(sentTo(id)).toHaveLength(2));
    expect(sentTo(id)[1]!.message).toMatchObject({ eventType: 'SeriesDelete', series: { id: newId, title } });
  });

  it('sends Health for new errors (warnings only when requested) and HealthRestored', async () => {
    await setup();
    await t!.app.health.check();
    const errors = await notify('errors', { onHealthIssue: true, onHealthRestored: true });
    const warnings = await notify('warnings', { onHealthIssue: true, onHealthRestored: true, includeHealthWarnings: true });
    // a missing root folder is an error
    const missing = path.join(root!, 'gone');
    t!.app.sqlite.prepare('insert into root_folders (path) values (?)').run(missing);
    await t!.app.health.check();
    await vi.waitFor(() => expect(sentTo(errors)).toHaveLength(1));
    await vi.waitFor(() => expect(sentTo(warnings)).toHaveLength(1));
    expect(sentTo(errors)[0]!.message).toMatchObject({ eventType: 'Health', health: { level: 'error', type: 'RootFolderCheck' } });

    // a warning (recycle bin missing) reaches only the includeHealthWarnings notification
    t!.app.sqlite.prepare("insert into config (key, value) values ('mediaManagement', ?) on conflict(key) do nothing").run('{}');
    await req('PUT', '/api/v3/config/mediamanagement', {
      ...((await req('GET', '/api/v3/config/mediamanagement')).json() as Record<string, unknown>),
      recycleBin: path.join(root!, 'no-bin'),
    });
    await t!.app.health.check();
    await vi.waitFor(() => expect(sentTo(warnings).length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(sentTo(errors)).toHaveLength(1);

    t!.app.sqlite.prepare('delete from root_folders where path = ?').run(missing);
    await t!.app.health.check();
    await vi.waitFor(() => expect(sentTo(errors).map((s) => s.message.eventType)).toEqual(['Health', 'HealthRestored']));
    expect(sentTo(errors)[1]!.message.health?.type).toBe('RootFolderCheck');
  });

  it('marks failing notifications in health, logs without secrets, and recovers on success', async () => {
    const { seriesId, episodeIds } = await setup();
    const id = await notify('flaky', { onGrab: true, settings: { url: 'https://hook.test/in', password: 'hunter2hunter2' } });
    failFor.add(id);
    failWith = 'request to https://hook.test/in failed with password hunter2hunter2';
    recordGrabbed(t!.app, { seriesId, episodeIds: [episodeIds[0]!], sourceTitle: 'x', quality });
    await vi.waitFor(async () => {
      const list = await t!.app.health.check();
      expect(list.some((h) => h.source === 'NotificationStatusCheck' && h.message.includes('flaky'))).toBe(true);
    });
    const logged = t!.app.logs.entries({ level: 'warn' }).records.map((e) => e.message).join('\n');
    expect(logged).toContain('flaky');
    expect(logged).not.toContain('hunter2hunter2');

    failFor.clear();
    recordGrabbed(t!.app, { seriesId, episodeIds: [episodeIds[0]!], sourceTitle: 'y', quality });
    await vi.waitFor(() => expect(sentTo(id)).toHaveLength(1));
    const list = await t!.app.health.check();
    expect(list.some((h) => h.source === 'NotificationStatusCheck')).toBe(false);
  });

  it('runs at most four sends at once', async () => {
    const { seriesId, episodeIds } = await setup();
    for (let i = 0; i < 6; i++) await notify(`n${i}`, { onGrab: true });
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    recordGrabbed(t!.app, { seriesId, episodeIds: [episodeIds[0]!], sourceTitle: 'x', quality });
    await vi.waitFor(() => expect(maxActive).toBe(4));
    await settle();
    expect(maxActive).toBe(4);
    release();
    await vi.waitFor(() => expect(sent).toHaveLength(6));
  });
});
