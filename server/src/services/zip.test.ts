import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readZip, writeZip, zipBuffer, ZipError } from './zip.js';

describe('zip', () => {
  it('round-trips binary data through a file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
    try {
      const bin = crypto.randomBytes(100_000);
      const text = Buffer.from('hello '.repeat(5000));
      const dest = path.join(dir, 'a.zip');
      writeZip(dest, [
        { name: 'sonarr.db', data: bin },
        { name: 'sub/version.txt', data: text },
      ]);
      const out = readZip(fs.readFileSync(dest));
      expect(out.map((e) => e.name)).toEqual(['sonarr.db', 'sub/version.txt']);
      expect(out[0]!.data.equals(bin)).toBe(true);
      expect(out[1]!.data.equals(text)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles empty entries', () => {
    expect(readZip(zipBuffer([{ name: 'e', data: Buffer.alloc(0) }]))[0]!.data.length).toBe(0);
  });

  it('refuses to write unsafe names', () => {
    for (const name of ['../x', '/x', 'a\\b', 'a/../b', '']) {
      expect(() => zipBuffer([{ name, data: Buffer.from('x') }])).toThrow(ZipError);
    }
  });

  it('rejects zip-slip names found in an archive', () => {
    const buf = zipBuffer([{ name: 'aaaa', data: Buffer.from('x') }]);
    const patched = Buffer.from(buf.toString('latin1').replaceAll('aaaa', '../b'), 'latin1');
    expect(() => readZip(patched)).toThrow(/Invalid zip entry name/);
  });

  it('rejects oversize entries and too many entries', () => {
    const buf = zipBuffer([{ name: 'a', data: Buffer.alloc(1000) }]);
    expect(() => readZip(buf, { maxEntrySize: 999 })).toThrow(/too large/);
    const three = zipBuffer([1, 2, 3].map((n) => ({ name: `f${n}`, data: Buffer.from('x') })));
    expect(() => readZip(three)).toThrow(/Too many/);
  });

  it('rejects garbage and corrupted data', () => {
    expect(() => readZip(Buffer.from('not a zip file at all, definitely not'))).toThrow(ZipError);
    const buf = zipBuffer([{ name: 'a', data: Buffer.from('hello world hello world') }]);
    buf[40 + 1] = buf[40 + 1]! ^ 0xff; // flip a byte in the compressed payload
    expect(() => readZip(buf)).toThrow(ZipError);
  });
});
