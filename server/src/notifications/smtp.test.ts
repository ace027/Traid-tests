import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { quotedPrintable, sendMail, SmtpError, toDataBlock, type SendMailOptions } from './smtp.js';

interface FakeSmtpOptions {
  /** Advertise AUTH LOGIN (and PLAIN when true-ish 'plain'). */
  auth?: 'login' | 'plain';
  rejectRcpt?: string;
  /** Advertise STARTTLS (the fake cannot upgrade, so the client's STARTTLS command is answered 454). */
  advertiseStarttls?: boolean;
}

interface FakeSmtp {
  port: number;
  commands: string[];
  data: string[];
  close: () => Promise<void>;
}

async function startFakeSmtp(opts: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const state = { commands: [] as string[], data: [] as string[] };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buf = '';
    let mode: 'command' | 'data' | 'auth-user' | 'auth-pass' = 'command';
    let body: string[] = [];
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake.test ESMTP');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (mode === 'data') {
          if (line === '.') {
            state.data.push(body.join('\r\n'));
            body = [];
            mode = 'command';
            reply('250 queued');
          } else body.push(line);
          continue;
        }
        if (mode === 'auth-user') {
          state.commands.push('<user>');
          mode = 'auth-pass';
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (mode === 'auth-pass') {
          state.commands.push('<pass>');
          mode = 'command';
          reply('235 ok');
          continue;
        }
        state.commands.push(line);
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) {
          const caps = ['250-fake.test', '250-8BITMIME'];
          if (opts.advertiseStarttls) caps.push('250-STARTTLS');
          if (opts.auth) caps.push(`250-AUTH ${opts.auth === 'plain' ? 'PLAIN LOGIN' : 'LOGIN'}`);
          caps.push('250 SIZE 1000000');
          reply(caps.join('\r\n'));
        } else if (upper === 'STARTTLS') reply('454 TLS not available');
        else if (upper === 'AUTH LOGIN') {
          mode = 'auth-user';
          reply('334 VXNlcm5hbWU6');
        } else if (upper.startsWith('AUTH PLAIN')) reply('235 ok');
        else if (upper.startsWith('MAIL FROM')) reply('250 ok');
        else if (upper.startsWith('RCPT TO')) reply(opts.rejectRcpt && line.includes(opts.rejectRcpt) ? '550 no such user' : '250 ok');
        else if (upper === 'DATA') {
          mode = 'data';
          reply('354 go ahead');
        } else if (upper === 'QUIT') {
          reply('221 bye');
          socket.end();
        } else reply('500 what');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    commands: state.commands,
    data: state.data,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

let fake: FakeSmtp | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const base = (port: number, over: Partial<SendMailOptions> = {}): SendMailOptions => ({
  host: '127.0.0.1',
  port,
  starttls: 'never',
  from: 'sonarr@example.com',
  to: ['me@example.com'],
  subject: 'Hello',
  text: 'Body line',
  ...over,
});

describe('sendMail', () => {
  it('delivers a plain message with AUTH LOGIN', async () => {
    fake = await startFakeSmtp({ auth: 'login' });
    await sendMail(base(fake.port, { username: 'user', password: 'secret', html: '<p>Body</p>', starttls: 'preferred' }));
    expect(fake.commands.filter((c) => !c.startsWith('EHLO'))).toEqual([
      'AUTH LOGIN',
      '<user>',
      '<pass>',
      'MAIL FROM:<sonarr@example.com>',
      'RCPT TO:<me@example.com>',
      'DATA',
      'QUIT',
    ]);
    const msg = fake.data[0]!;
    expect(msg).toContain('From: sonarr@example.com');
    expect(msg).toContain('Subject: Hello');
    expect(msg).toContain('multipart/alternative');
    expect(msg).toContain('text/html');
  });

  it('prefers AUTH PLAIN when offered', async () => {
    fake = await startFakeSmtp({ auth: 'plain' });
    await sendMail(base(fake.port, { username: 'user', password: 'secret' }));
    const auth = fake.commands.find((c) => c.startsWith('AUTH PLAIN'))!;
    expect(Buffer.from(auth.slice('AUTH PLAIN '.length), 'base64').toString()).toBe('\0user\0secret');
  });

  it('dot-stuffs lines starting with a dot and normalises line endings', async () => {
    fake = await startFakeSmtp();
    await sendMail(base(fake.port, { text: 'first\n.hidden\r\n..two\rlast' }));
    const msg = fake.data[0]!;
    // the server does not un-stuff, so the stuffed lines are visible on the wire
    expect(msg).toContain('\r\n..hidden\r\n');
    expect(msg).toContain('\r\n...two\r\n');
    expect(msg).not.toMatch(/[^\r]\n/);
    expect(toDataBlock('a\n.b')).toBe('a\r\n..b');
  });

  it('addresses To, Cc and Bcc recipients', async () => {
    fake = await startFakeSmtp();
    await sendMail(base(fake.port, { to: ['a@example.com', 'b@example.com'], cc: ['c@example.com'], bcc: ['hidden@example.com'] }));
    expect(fake.commands.filter((c) => c.startsWith('RCPT TO'))).toEqual([
      'RCPT TO:<a@example.com>',
      'RCPT TO:<b@example.com>',
      'RCPT TO:<c@example.com>',
      'RCPT TO:<hidden@example.com>',
    ]);
    const msg = fake.data[0]!;
    expect(msg).toContain('To: a@example.com, b@example.com');
    expect(msg).toContain('Cc: c@example.com');
    expect(msg).not.toContain('hidden@example.com');
  });

  it('fails cleanly when encryption is always but STARTTLS is not offered', async () => {
    fake = await startFakeSmtp();
    const err = await sendMail(base(fake.port, { starttls: 'always' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect((err as Error).message).toMatch(/STARTTLS/);
    expect(fake.commands.some((c) => c.startsWith('MAIL FROM'))).toBe(false);
  });

  it('sends without TLS when STARTTLS is not offered and encryption is preferred', async () => {
    fake = await startFakeSmtp();
    await sendMail(base(fake.port, { starttls: 'preferred' }));
    expect(fake.data).toHaveLength(1);
  });

  it('rejects CR/LF in the subject and addresses before connecting', async () => {
    fake = await startFakeSmtp();
    await expect(sendMail(base(fake.port, { subject: 'Hi\r\nBcc: evil@example.com' }))).rejects.toThrow(/line breaks/);
    await expect(sendMail(base(fake.port, { to: ['a@example.com\r\nRCPT TO:<x@y.z>'] }))).rejects.toThrow(/line breaks/);
    await expect(sendMail(base(fake.port, { from: 'bad address' }))).rejects.toThrow(/valid email/);
    expect(fake.commands).toHaveLength(0);
  });

  it('surfaces a 5xx reply to RCPT TO', async () => {
    fake = await startFakeSmtp({ rejectRcpt: 'bad@' });
    const err = await sendMail(base(fake.port, { to: ['ok@example.com', 'bad@example.com'] })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect((err as SmtpError).code).toBe(550);
    expect((err as Error).message).toMatch(/RCPT TO/);
    expect(fake.data).toHaveLength(0);
  });

  it('errors when credentials are set but the server offers no AUTH', async () => {
    fake = await startFakeSmtp();
    await expect(sendMail(base(fake.port, { username: 'u', password: 'p' }))).rejects.toThrow(/authentication/);
  });

  it('reports a refused connection without leaking details', async () => {
    fake = await startFakeSmtp();
    const port = fake.port;
    await fake.close();
    fake = undefined;
    await expect(sendMail(base(port, { password: 'topsecret' }))).rejects.toThrow(/Unable to connect/);
  });

  it('times out on a silent server', async () => {
    const silent = net.createServer(() => undefined);
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const port = (silent.address() as net.AddressInfo).port;
    try {
      await expect(sendMail(base(port, { timeoutMs: 100 }))).rejects.toThrow(/timed out/);
    } finally {
      await new Promise((r) => silent.close(r));
    }
  });
});

describe('quotedPrintable', () => {
  it('encodes non-ASCII, equals signs and long lines', () => {
    expect(quotedPrintable('a=b é')).toBe('a=3Db =C3=A9');
    const long = quotedPrintable('x'.repeat(200));
    for (const l of long.split('\r\n')) expect(l.length).toBeLessThanOrEqual(76);
    expect(long.replace(/=\r\n/g, '')).toBe('x'.repeat(200));
  });
});
