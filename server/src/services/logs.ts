import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogFileResource, LogLevel, Paged } from '@sonarr/shared';

export const RING_SIZE = 2000;
export const MAX_FILE_BYTES = 1024 * 1024;
/** The active file plus sonarr.0.txt ... sonarr.3.txt. */
export const KEEP_FILES = 5;
const ACTIVE_FILE = 'sonarr.txt';
const FILE_PATTERN = /^sonarr(\.\d+)?\.txt$/;
const MASK = '********';

const REDACTIONS: [RegExp, string][] = [
  [/(api_?key=)[^&\s"']+/gi, `$1${MASK}`],
  [/(x-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1${MASK}`],
  [/((?:password|passwd|pwd|secret|token)["']?\s*[:=]\s*["']?)[^\s"',&}]+/gi, `$1${MASK}`],
  [/(discord(?:app)?\.com\/api\/webhooks\/\d+\/)[\w-]+/gi, `$1${MASK}`],
];

/** Masks API keys, passwords and webhook tokens in free text. */
export function redact(text: string): string {
  let out = text;
  for (const [re, replacement] of REDACTIONS) out = out.replace(re, replacement);
  return out;
}

export interface LogInput {
  level: LogLevel;
  message: string;
  logger?: string;
  exception?: string;
  time?: Date;
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  fatal: 'Fatal',
};

function formatTime(d: Date): string {
  // yyyy-MM-dd HH:mm:ss.f (UTC, one fractional digit)
  return `${d.toISOString().slice(0, 19).replace('T', ' ')}.${Math.floor(d.getUTCMilliseconds() / 100)}`;
}

const oneLine = (s: string) => s.replace(/\r?\n/g, ' ');

export class LogService {
  readonly dir: string;
  private ring: LogEntry[] = [];
  private nextId = 1;
  private size = 0;

  constructor(
    dataDir: string,
    private readonly maxBytes: number = MAX_FILE_BYTES,
  ) {
    this.dir = path.join(dataDir, 'logs');
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.size = fs.statSync(path.join(this.dir, ACTIVE_FILE)).size;
    } catch {
      this.size = 0;
    }
  }

  write(input: LogInput): LogEntry {
    const time = input.time ?? new Date();
    const entry: LogEntry = {
      id: this.nextId++,
      time: time.toISOString(),
      level: input.level,
      logger: input.logger ?? 'App',
      message: redact(input.message),
    };
    if (input.exception) entry.exception = redact(input.exception);
    this.ring.push(entry);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    this.append(entry, time);
    return entry;
  }

  private append(entry: LogEntry, time: Date): void {
    const text = oneLine(entry.message) + (entry.exception ? `|${oneLine(entry.exception)}` : '');
    const line = `${formatTime(time)}|${LEVEL_LABEL[entry.level]}|${entry.logger}|${text}\n`;
    try {
      if (this.size > 0 && this.size + Buffer.byteLength(line) > this.maxBytes) this.rotate();
      fs.appendFileSync(path.join(this.dir, ACTIVE_FILE), line);
      this.size += Buffer.byteLength(line);
    } catch {
      // logging must never break the caller
    }
  }

  /** sonarr.txt -> sonarr.0.txt -> ... ; the oldest file beyond KEEP_FILES is dropped. */
  private rotate(): void {
    const file = (i: number) => path.join(this.dir, `sonarr.${i}.txt`);
    fs.rmSync(file(KEEP_FILES - 2), { force: true });
    for (let i = KEEP_FILES - 3; i >= 0; i--) {
      if (fs.existsSync(file(i))) fs.renameSync(file(i), file(i + 1));
    }
    fs.renameSync(path.join(this.dir, ACTIVE_FILE), file(0));
    this.size = 0;
  }

  /** Newest first. `level` keeps only entries of exactly that level. */
  entries({ page = 1, pageSize = 50, level }: { page?: number; pageSize?: number; level?: LogLevel } = {}): Paged<LogEntry> {
    const all = level ? this.ring.filter((e) => e.level === level) : this.ring;
    const start = (page - 1) * pageSize;
    const records = all
      .slice()
      .reverse()
      .slice(start, start + pageSize);
    return { page, pageSize, sortKey: 'time', sortDirection: 'descending', totalRecords: all.length, records };
  }

  listFiles(): LogFileResource[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir).filter((n) => FILE_PATTERN.test(n));
    } catch {
      return [];
    }
    const out: LogFileResource[] = [];
    for (const filename of names) {
      try {
        const st = fs.statSync(path.join(this.dir, filename));
        if (st.isFile()) out.push({ filename, lastWriteTime: st.mtime.toISOString(), size: st.size });
      } catch {
        // rotated away between readdir and stat
      }
    }
    return out.sort((a, b) => b.lastWriteTime.localeCompare(a.lastWriteTime) || a.filename.localeCompare(b.filename));
  }

  /** Absolute path of a listed log file, or null. The path is built from the listing, never from the input. */
  filePath(filename: string): string | null {
    const match = this.listFiles().find((f) => f.filename === filename);
    return match ? path.join(this.dir, match.filename) : null;
  }
}

const PINO_LEVELS: Record<number, LogLevel> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };

/** A pino destination-like stream that parses JSON lines into the log service. */
export function createPinoStream(service: LogService, tee?: { write(line: string): unknown }): { write(line: string): void } {
  return {
    write(line: string) {
      tee?.write(redact(line));
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        service.write({ level: 'info', logger: 'Fastify', message: line.trim() });
        return;
      }
      const level = PINO_LEVELS[Number(obj.level)] ?? 'info';
      let message = typeof obj.msg === 'string' ? obj.msg : '';
      const req = obj.req as { method?: string; url?: string } | undefined;
      if (req?.method) message += `${message ? ' ' : ''}${req.method} ${req.url ?? ''}`.trimEnd();
      const res = obj.res as { statusCode?: number } | undefined;
      if (res?.statusCode !== undefined) message += ` -> ${res.statusCode}`;
      if (typeof obj.responseTime === 'number') message += ` (${Math.round(obj.responseTime)} ms)`;
      const err = (obj.err ?? undefined) as { message?: string; stack?: string } | undefined;
      if (!message && err?.message) message = err.message;
      const time = typeof obj.time === 'number' ? new Date(obj.time) : undefined;
      const input: LogInput = { level, logger: req ? 'Http' : 'Fastify', message };
      if (err?.stack ?? err?.message) input.exception = err.stack ?? err.message;
      if (time && !Number.isNaN(time.getTime())) input.time = time;
      service.write(input);
    },
  };
}
