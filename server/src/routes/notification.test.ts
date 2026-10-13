import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setNotificationProviderFactory, type NotificationRow } from '../notifications/dispatcher.js';
import { NotificationError, type NotificationProvider } from '../notifications/types.js';
import { createTestApp, type TestApp } from '../test/helpers.js';

let t: TestApp | undefined;
let testBehaviour: (row: NotificationRow) => Promise<void>;
let tested: NotificationRow[];

beforeEach(() => {
  tested = [];
  testBehaviour = async () => undefined;
  setNotificationProviderFactory((row): NotificationProvider => ({
    send: async () => undefined,
    test: async () => {
      tested.push(row);
      await testBehaviour(row);
    },
  }));
});
afterEach(async () => {
  setNotificationProviderFactory(undefined);
  await t?.cleanup();
  t = undefined;
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t!.app.inject({ method, url, headers: { 'x-api-key': t!.apiKey }, payload: payload as object });

const webhook = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) => ({
  name: 'Hook',
  implementation: 'Webhook',
  onGrab: true,
  settings: { url: 'https://hook.test/in', username: 'user', password: 'pw123456', ...settings },
  ...over,
});

const stored = (id: number) =>
  JSON.parse((t!.app.sqlite.prepare('select settings from notifications where id = ?').get(id) as { settings: string }).settings) as Record<string, unknown>;

describe('notification api', () => {
  it('creates, masks, lists, updates and deletes', async () => {
    t = await createTestApp();
    const res = await req('POST', '/api/v3/notification', webhook());
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created).toMatchObject({ implementation: 'Webhook', onGrab: true, onDownload: false, tags: [] });
    expect(created.settings).toMatchObject({ url: 'https://hook.test/in', method: 'POST', username: 'user', password: '********' });
    expect((await req('GET', '/api/v3/notification')).json()).toHaveLength(1);
    expect((await req('GET', `/api/v3/notification/${created.id}`)).json().settings.password).toBe('********');

    const put = await req('PUT', `/api/v3/notification/${created.id}`, webhook({ onRename: true }, { password: '********' }));
    expect(put.statusCode).toBe(200);
    expect(put.json().onRename).toBe(true);
    expect(stored(created.id).password).toBe('pw123456');
    await req('PUT', `/api/v3/notification/${created.id}`, webhook({}, { password: 'new-password' }));
    expect(stored(created.id).password).toBe('new-password');

    expect((await req('PUT', '/api/v3/notification/999', webhook())).statusCode).toBe(404);
    expect((await req('GET', '/api/v3/notification/999')).statusCode).toBe(404);
    expect((await req('DELETE', `/api/v3/notification/${created.id}`)).statusCode).toBe(200);
    expect((await req('DELETE', `/api/v3/notification/${created.id}`)).statusCode).toBe(404);
  });

  it('masks URLs that carry credentials or a query, and keeps them on masked updates', async () => {
    t = await createTestApp();
    const withQuery = (await req('POST', '/api/v3/notification', webhook({}, { url: 'https://hook.test/in?token=abc' }))).json();
    expect(withQuery.settings.url).toBe('********');
    const withUser = (await req('POST', '/api/v3/notification', webhook({ name: 'B' }, { url: 'https://u:p@hook.test/in' }))).json();
    expect(withUser.settings.url).toBe('********');
    const put = await req('PUT', `/api/v3/notification/${withQuery.id}`, webhook({}, { url: '********' }));
    expect(put.statusCode).toBe(200);
    expect(stored(withQuery.id).url).toBe('https://hook.test/in?token=abc');

    const discord = (
      await req('POST', '/api/v3/notification', {
        name: 'D',
        implementation: 'Discord',
        settings: { webHookUrl: 'https://discord.com/api/webhooks/1/secrettoken' },
      })
    ).json();
    expect(discord.settings).toMatchObject({ webHookUrl: '********', username: '', avatar: '' });
    const dPut = await req('PUT', `/api/v3/notification/${discord.id}`, {
      name: 'D',
      implementation: 'Discord',
      settings: { webHookUrl: '********', username: 'bot' },
    });
    expect(dPut.statusCode).toBe(200);
    expect(stored(discord.id).webHookUrl).toBe('https://discord.com/api/webhooks/1/secrettoken');
    expect(JSON.stringify((await req('GET', '/api/v3/notification')).json())).not.toContain('secrettoken');
  });

  it('validates input', async () => {
    t = await createTestApp();
    await req('POST', '/api/v3/notification', webhook());
    const dup = await req('POST', '/api/v3/notification', webhook());
    expect(dup.statusCode).toBe(400);
    expect(dup.json().errors[0].propertyName).toBe('name');
    expect((await req('POST', '/api/v3/notification', webhook({ name: 'B' }, { url: 'ftp://x/y' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/notification', webhook({ name: 'C' }, { url: 'javascript:alert(1)' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/notification', webhook({ name: 'D', tags: [99] }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/notification', webhook({ name: 'E', implementation: 'Pushover' }))).statusCode).toBe(400);
    const email = (settings: Record<string, unknown>) => ({
      name: 'Mail',
      implementation: 'Email',
      settings: { server: 'smtp.test', from: 'a@example.com', to: ['b@example.com'], ...settings },
    });
    expect((await req('POST', '/api/v3/notification', email({ from: 'not an email' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/notification', email({ to: [] }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/notification', email({ to: ['bad'] }))).statusCode).toBe(400);
    expect((await req('POST', '/api/v3/notification', email({ port: 70000 }))).statusCode).toBe(400);
    const ok = await req('POST', '/api/v3/notification', email({ password: 'smtp-pw' }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json().settings).toMatchObject({ port: 587, useEncryption: 'preferred', password: '********', cc: [], bcc: [] });
    // a tag that exists is accepted
    const tag = (await req('POST', '/api/v3/tag', { label: 'x' })).json().id as number;
    expect((await req('POST', '/api/v3/notification', webhook({ name: 'F', tags: [tag, tag] }))).json().tags).toEqual([tag]);
  });

  it('returns the schema templates', async () => {
    t = await createTestApp();
    const schema = (await req('GET', '/api/v3/notification/schema')).json() as Record<string, unknown>[];
    expect(schema.map((s) => s.implementation)).toEqual(['Webhook', 'Discord', 'Email']);
    for (const s of schema) {
      expect(s).toMatchObject({
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
        tags: [],
      });
    }
    expect(schema[2]!.settings).toMatchObject({ port: 587, useEncryption: 'preferred', to: [] });
  });

  it('tests with the given settings, resolving masked secrets from the stored row', async () => {
    t = await createTestApp();
    const created = (await req('POST', '/api/v3/notification', webhook())).json();
    const ok = await req('POST', '/api/v3/notification/test', webhook({ id: created.id }, { password: '********' }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(tested[0]!.settings).password).toBe('pw123456');
    // without an id the settings are used as given
    expect((await req('POST', '/api/v3/notification/test', webhook())).statusCode).toBe(200);
    expect((await req('POST', '/api/v3/notification/test', webhook({}, { url: 'ftp://x' }))).statusCode).toBe(400);
  });

  it('reports test failures with a redacted message', async () => {
    t = await createTestApp();
    testBehaviour = async () => {
      throw new NotificationError('Webhook failed for https://hook.test/in?token=abc with pw123456');
    };
    const res = await req('POST', '/api/v3/notification/test', webhook({}, { url: 'https://hook.test/in?token=abc' }));
    expect(res.statusCode).toBe(400);
    const message = res.json().message as string;
    expect(message).not.toContain('pw123456');
    expect(message).not.toContain('token=abc');
    expect(message).toContain('********');
  });

  it('tests every notification and reflects failures in health', async () => {
    t = await createTestApp();
    const a = (await req('POST', '/api/v3/notification', webhook({ name: 'A' }))).json().id as number;
    const b = (await req('POST', '/api/v3/notification', webhook({ name: 'B' }))).json().id as number;
    testBehaviour = async (row) => {
      if (row.id === b) throw new Error('nope');
    };
    const results = (await req('POST', '/api/v3/notification/testall')).json();
    expect(results).toEqual([
      { id: a, isValid: true, validationFailures: [] },
      { id: b, isValid: false, validationFailures: [{ propertyName: '', errorMessage: 'nope' }] },
    ]);
    expect((await t.app.health.check()).some((h) => h.source === 'NotificationStatusCheck' && h.message.includes('B'))).toBe(true);
    testBehaviour = async () => undefined;
    await req('POST', '/api/v3/notification/testall');
    expect((await t.app.health.check()).some((h) => h.source === 'NotificationStatusCheck')).toBe(false);
  });

  it('publishes notification events', async () => {
    t = await createTestApp();
    const seen: string[] = [];
    t.app.events.subscribe((e) => {
      if (e.name === 'notification') seen.push(e.action);
    });
    const id = (await req('POST', '/api/v3/notification', webhook())).json().id as number;
    await req('PUT', `/api/v3/notification/${id}`, webhook());
    await req('DELETE', `/api/v3/notification/${id}`);
    expect(seen).toEqual(['created', 'updated', 'deleted']);
  });
});

describe('notification test endpoint with the email provider', () => {
  let server: net.Server | undefined;
  afterEach(async () => {
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    server = undefined;
  });

  async function fakeSmtp(rejectRcpt = false) {
    const log: string[] = [];
    const data: string[] = [];
    server = net.createServer((socket) => {
      socket.on('error', () => undefined);
      let buf = '';
      let inData = false;
      let body: string[] = [];
      socket.write('220 fake ESMTP\r\n');
      socket.on('data', (c) => {
        buf += c.toString();
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              data.push(body.join('\r\n'));
              socket.write('250 queued\r\n');
            } else body.push(line);
            continue;
          }
          log.push(line);
          if (line.startsWith('EHLO')) socket.write('250-fake\r\n250 SIZE 100000\r\n');
          else if (line.startsWith('RCPT') && rejectRcpt) socket.write('550 rejected\r\n');
          else if (line === 'DATA') {
            inData = true;
            body = [];
            socket.write('354 go\r\n');
          } else if (line === 'QUIT') {
            socket.write('221 bye\r\n');
            socket.end();
          } else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return { port: (server.address() as net.AddressInfo).port, log, data };
  }

  const email = (port: number) => ({
    name: 'Mail',
    implementation: 'Email',
    settings: { server: '127.0.0.1', port, useEncryption: 'never', from: 'sonarr@example.com', to: ['me@example.com'] },
  });

  it('delivers a test message', async () => {
    setNotificationProviderFactory(undefined);
    t = await createTestApp();
    const smtp = await fakeSmtp();
    const res = await req('POST', '/api/v3/notification/test', email(smtp.port));
    expect(res.statusCode).toBe(200);
    expect(smtp.log).toContain('RCPT TO:<me@example.com>');
    expect(smtp.data[0]).toContain('Subject: [Sonarr] Test notification from Sonarr');
  });

  it('returns 400 with the SMTP error when delivery is refused', async () => {
    setNotificationProviderFactory(undefined);
    t = await createTestApp();
    const smtp = await fakeSmtp(true);
    const res = await req('POST', '/api/v3/notification/test', email(smtp.port));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/RCPT TO.*550/);
  });

  it('returns 400 when STARTTLS is required but not offered', async () => {
    setNotificationProviderFactory(undefined);
    t = await createTestApp();
    const smtp = await fakeSmtp();
    const body = email(smtp.port);
    body.settings.useEncryption = 'always';
    const res = await req('POST', '/api/v3/notification/test', body);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/STARTTLS/);
  });
});
