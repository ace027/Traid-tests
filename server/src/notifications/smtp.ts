import { randomBytes } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

export const SMTP_TIMEOUT_MS = 15_000;

export interface SendMailOptions {
  host: string;
  port: number;
  /** Implicit TLS from the first byte (port 465). */
  secure?: boolean;
  /** Shorthand for starttls: 'always'. */
  requireTls?: boolean;
  /** STARTTLS policy: 'always' fails when the server does not offer it, 'never' skips it. Default 'preferred'. */
  starttls?: 'always' | 'preferred' | 'never';
  username?: string;
  password?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  /** Socket inactivity timeout (default 15 s). */
  timeoutMs?: number;
  /** Certificate verification; only disable for tests. */
  rejectUnauthorized?: boolean;
}

/** SMTP failure; the message never contains credentials. */
export class SmtpError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

interface Reply {
  code: number;
  lines: string[];
}

/** Line reader and writer over a socket; replies may span several `250-` lines. */
class Connection {
  private socket!: net.Socket;
  private lines: string[] = [];
  private partial = '';
  private waiters: { resolve: (line: string) => void; reject: (e: Error) => void }[] = [];
  private failure: Error | undefined;
  private readonly onData = (chunk: Buffer) => {
    this.partial += chunk.toString('utf8');
    const parts = this.partial.split('\n');
    this.partial = parts.pop() ?? '';
    for (const p of parts) this.lines.push(p.replace(/\r$/, ''));
    this.flush();
  };

  constructor(
    socket: net.Socket,
    private readonly timeoutMs: number,
  ) {
    this.attach(socket);
  }

  attach(socket: net.Socket): void {
    this.socket = socket;
    socket.setTimeout(this.timeoutMs);
    socket.on('data', this.onData);
    socket.on('timeout', () => this.fail(new SmtpError('SMTP connection timed out')));
    socket.on('error', (err) => this.fail(new SmtpError(`SMTP connection error: ${(err as NodeJS.ErrnoException).code ?? err.message}`)));
    socket.on('close', () => this.fail(new SmtpError('SMTP connection closed unexpectedly')));
  }

  /** Detaches from the plain socket before a TLS upgrade. */
  detach(): net.Socket {
    this.socket.off('data', this.onData);
    this.socket.removeAllListeners('timeout');
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('error');
    this.socket.on('error', () => undefined);
    this.socket.setTimeout(0);
    return this.socket;
  }

  private fail(err: Error): void {
    if (!this.failure) this.failure = err;
    this.socket.destroy();
    this.flush();
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      if (this.lines.length > 0) this.waiters.shift()!.resolve(this.lines.shift()!);
      else if (this.failure) this.waiters.shift()!.reject(this.failure);
      else break;
    }
  }

  private nextLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.flush();
    });
  }

  async reply(): Promise<Reply> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.nextLine();
      const m = /^(\d{3})([ -]|$)(.*)$/.exec(line);
      if (!m) throw new SmtpError('SMTP server sent an unexpected response');
      lines.push(m[3] ?? '');
      if (m[2] !== '-') return { code: Number(m[1]), lines };
    }
  }

  write(data: string): void {
    if (this.failure) throw this.failure;
    this.socket.write(data);
  }

  async command(line: string): Promise<Reply> {
    this.write(`${line}\r\n`);
    return this.reply();
  }

  close(): void {
    this.socket.destroy();
  }
}

function expectCode(reply: Reply, ok: number[], what: string): Reply {
  if (!ok.includes(reply.code)) {
    throw new SmtpError(`SMTP ${what} failed: ${reply.code} ${reply.lines.join(' ').slice(0, 200)}`.trim(), reply.code);
  }
  return reply;
}

function assertNoLineBreaks(value: string, what: string): void {
  if (/[\r\n\0]/.test(value)) throw new SmtpError(`${what} must not contain line breaks`);
}

/** Validates a bare address (no display names) and returns it. */
function checkAddress(value: string, what: string): string {
  assertNoLineBreaks(value, what);
  const v = value.trim();
  if (!/^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+$/.test(v)) throw new SmtpError(`${what} is not a valid email address`);
  return v;
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

function encodeHeader(value: string): string {
  return isAscii(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Quoted-printable (RFC 2045) with CRLF line breaks and soft wraps at 76 characters. */
export function quotedPrintable(input: string): string {
  const normalised = input.replace(/\r\n|\r|\n/g, '\n');
  return normalised
    .split('\n')
    .map((line) => {
      const bytes = Buffer.from(line, 'utf8');
      const out: string[] = [];
      let cur = '';
      const push = (token: string) => {
        if (cur.length + token.length > 75) {
          out.push(`${cur}=`);
          cur = '';
        }
        cur += token;
      };
      bytes.forEach((b, i) => {
        const trailingSpace = (b === 0x20 || b === 0x09) && i === bytes.length - 1;
        if (b === 0x3d || b > 0x7e || (b < 0x20 && b !== 0x09) || trailingSpace) {
          push(`=${b.toString(16).toUpperCase().padStart(2, '0')}`);
        } else push(String.fromCharCode(b));
      });
      out.push(cur);
      return out.join('\r\n');
    })
    .join('\r\n');
}

function buildMessage(o: SendMailOptions, from: string, to: string[], cc: string[]): string {
  const boundary = `=_sonarr_${randomBytes(12).toString('hex')}`;
  const domain = from.split('@')[1] ?? 'localhost';
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    ...(cc.length > 0 ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(o.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
  ];
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: quoted-printable', '', quotedPrintable(body)].join('\r\n');
  if (o.html === undefined) {
    return [...headers, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', quotedPrintable(o.text)].join('\r\n');
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', o.text),
    part('text/html', o.html),
    `--${boundary}--`,
  ].join('\r\n');
}

/** Normalises line endings to CRLF and dot-stuffs, ready to be followed by the terminating "." line. */
export function toDataBlock(message: string): string {
  return message
    .replace(/\r\n|\r|\n/g, '\r\n')
    .split('\r\n')
    .map((l) => (l.startsWith('.') ? `.${l}` : l))
    .join('\r\n');
}

function connect(o: SendMailOptions, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(new SmtpError(`Unable to connect to the SMTP server: ${(err as NodeJS.ErrnoException).code ?? err.message}`));
    const socket = o.secure
      ? tls.connect({ host: o.host, port: o.port, servername: net.isIP(o.host) ? undefined : o.host, rejectUnauthorized: o.rejectUnauthorized ?? true })
      : net.connect({ host: o.host, port: o.port });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new SmtpError('Unable to connect to the SMTP server: timed out'));
    });
    socket.once('error', onError);
    socket.once(o.secure ? 'secureConnect' : 'connect', () => {
      socket.off('error', onError);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

/** Sends one message over SMTP (node:net/node:tls, no dependencies). */
export async function sendMail(o: SendMailOptions): Promise<void> {
  const mode = o.requireTls ? 'always' : (o.starttls ?? 'preferred');
  const timeoutMs = o.timeoutMs ?? SMTP_TIMEOUT_MS;

  assertNoLineBreaks(o.subject, 'Subject');
  const from = checkAddress(o.from, 'From address');
  const to = o.to.map((a) => checkAddress(a, 'Recipient address'));
  const cc = (o.cc ?? []).map((a) => checkAddress(a, 'Cc address'));
  const bcc = (o.bcc ?? []).map((a) => checkAddress(a, 'Bcc address'));
  if (to.length === 0) throw new SmtpError('At least one recipient is required');
  assertNoLineBreaks(o.host, 'Server');
  const data = toDataBlock(buildMessage(o, from, to, cc));

  const conn = new Connection(await connect(o, timeoutMs), timeoutMs);
  try {
    expectCode(await conn.reply(), [220], 'greeting');
    const helo = `[${os.hostname().replace(/[^\w.-]/g, '') || 'localhost'}]`;
    let ehlo = expectCode(await conn.command(`EHLO ${helo}`), [250], 'EHLO');
    const offers = (name: string) => ehlo.lines.some((l) => l.toUpperCase().split(' ')[0] === name);

    if (!o.secure && mode !== 'never') {
      if (offers('STARTTLS')) {
        expectCode(await conn.command('STARTTLS'), [220], 'STARTTLS');
        const plain = conn.detach();
        const upgraded = tls.connect({
          socket: plain,
          servername: net.isIP(o.host) ? undefined : o.host,
          rejectUnauthorized: o.rejectUnauthorized ?? true,
        });
        await new Promise<void>((resolve, reject) => {
          upgraded.once('secureConnect', resolve);
          upgraded.once('error', (err) => reject(new SmtpError(`TLS negotiation failed: ${(err as NodeJS.ErrnoException).code ?? err.message}`)));
        });
        conn.attach(upgraded);
        ehlo = expectCode(await conn.command(`EHLO ${helo}`), [250], 'EHLO');
      } else if (mode === 'always') {
        throw new SmtpError('The SMTP server does not support STARTTLS, which is required by the encryption setting');
      }
    }

    if (o.username) {
      const auth = ehlo.lines.find((l) => l.toUpperCase().startsWith('AUTH'));
      if (!auth) throw new SmtpError('The SMTP server does not support authentication');
      const mechs = auth.toUpperCase().split(/[\s=]+/).slice(1);
      const password = o.password ?? '';
      if (mechs.includes('PLAIN')) {
        const token = Buffer.from(`\0${o.username}\0${password}`, 'utf8').toString('base64');
        expectCode(await conn.command(`AUTH PLAIN ${token}`), [235], 'authentication');
      } else if (mechs.includes('LOGIN')) {
        expectCode(await conn.command('AUTH LOGIN'), [334], 'authentication');
        expectCode(await conn.command(Buffer.from(o.username, 'utf8').toString('base64')), [334], 'authentication');
        expectCode(await conn.command(Buffer.from(password, 'utf8').toString('base64')), [235], 'authentication');
      } else {
        throw new SmtpError('The SMTP server offers no supported authentication method (PLAIN, LOGIN)');
      }
    }

    expectCode(await conn.command(`MAIL FROM:<${from}>`), [250], 'MAIL FROM');
    for (const rcpt of [...to, ...cc, ...bcc]) expectCode(await conn.command(`RCPT TO:<${rcpt}>`), [250, 251], 'RCPT TO');
    expectCode(await conn.command('DATA'), [354], 'DATA');
    conn.write(`${data}\r\n.\r\n`);
    expectCode(await conn.reply(), [250], 'message delivery');
    try {
      await conn.command('QUIT');
    } catch {
      // the message was accepted; a server closing without a QUIT reply is fine
    }
  } finally {
    conn.close();
  }
}
