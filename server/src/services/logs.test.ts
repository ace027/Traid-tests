import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinoStream, LogService, redact, RING_SIZE } from './logs.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonarr-logs-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('LogService', () => {
  it('pages entries newest first and filters by level', () => {
    const logs = new LogService(dir);
    for (let i = 1; i <= 5; i++) logs.write({ level: i % 2 ? 'info' : 'error', message: `m${i}` });
    const p1 = logs.entries({ page: 1, pageSize: 2 });
    expect(p1.totalRecords).toBe(5);
    expect(p1.records.map((e) => e.message)).toEqual(['m5', 'm4']);
    expect(logs.entries({ page: 3, pageSize: 2 }).records.map((e) => e.message)).toEqual(['m1']);
    const errors = logs.entries({ level: 'error' });
    expect(errors.totalRecords).toBe(2);
    expect(errors.records.map((e) => e.message)).toEqual(['m4', 'm2']);
  });

  it('keeps only the last 2000 entries in memory', () => {
    const logs = new LogService(dir);
    for (let i = 0; i < RING_SIZE + 10; i++) logs.write({ level: 'debug', message: `m${i}` });
    const all = logs.entries({ pageSize: 5000 });
    expect(all.totalRecords).toBe(RING_SIZE);
    expect(all.records[0]!.message).toBe(`m${RING_SIZE + 9}`);
  });

  it('appends formatted lines to sonarr.txt', () => {
    const logs = new LogService(dir);
    logs.write({ level: 'warn', logger: 'Test', message: 'hello\nworld', time: new Date('2026-01-02T03:04:05.678Z') });
    const text = fs.readFileSync(path.join(dir, 'logs', 'sonarr.txt'), 'utf8');
    expect(text).toBe('2026-01-02 03:04:05.6|Warn|Test|hello world\n');
  });

  it('rotates past 1 MB and keeps 5 files', () => {
    const logs = new LogService(dir);
    const big = 'x'.repeat(100_000);
    for (let i = 0; i < 60; i++) logs.write({ level: 'info', message: big });
    const names = logs.listFiles().map((f) => f.filename).sort();
    expect(names).toContain('sonarr.0.txt');
    expect(names).toContain('sonarr.txt');
    expect(names.length).toBeLessThanOrEqual(5);
    for (const f of logs.listFiles()) expect(f.size).toBeLessThanOrEqual(1024 * 1024);
  });

  it('redacts secrets', () => {
    expect(redact('GET /x?apikey=abc123&b=1')).toBe('GET /x?apikey=********&b=1');
    expect(redact('{"x-api-key":"secret1"}')).not.toContain('secret1');
    expect(redact('password=hunter2 ok')).toBe('password=******** ok');
    expect(redact('{"password":"hunter2"}')).not.toContain('hunter2');
    expect(redact('https://discord.com/api/webhooks/123/tok-en_1')).toBe('https://discord.com/api/webhooks/123/********');
    const logs = new LogService(dir);
    logs.write({ level: 'info', message: 'url ?apikey=zzz' });
    expect(fs.readFileSync(path.join(dir, 'logs', 'sonarr.txt'), 'utf8')).not.toContain('zzz');
  });

  it('only resolves listed log files', () => {
    const logs = new LogService(dir);
    logs.write({ level: 'info', message: 'a' });
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');
    expect(logs.filePath('sonarr.txt')).toBe(path.join(dir, 'logs', 'sonarr.txt'));
    expect(logs.filePath('../x')).toBeNull();
    expect(logs.filePath('../secret.txt')).toBeNull();
    expect(logs.filePath('sonarr.9.txt')).toBeNull();
    expect(logs.filePath('')).toBeNull();
  });

  it('adapts pino JSON lines', () => {
    const logs = new LogService(dir);
    const stream = createPinoStream(logs);
    stream.write(JSON.stringify({ level: 50, time: 1_700_000_000_000, msg: 'boom', err: { message: 'bad', stack: 'Error: bad\n at x' } }) + '\n');
    stream.write(JSON.stringify({ level: 30, msg: 'incoming request', req: { method: 'GET', url: '/a?apikey=k1' } }) + '\n');
    stream.write('not json\n');
    const { records } = logs.entries();
    expect(records.map((r) => r.level)).toEqual(['info', 'info', 'error']);
    expect(records[1]!.message).toBe('incoming request GET /a?apikey=********');
    expect(records[2]!.exception).toContain('Error: bad');
  });
});
