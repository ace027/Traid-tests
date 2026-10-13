import fs from 'node:fs';
import zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ReadZipOptions {
  /** Maximum number of entries accepted (default 2: sonarr.db and version.txt). */
  maxEntries?: number;
  /** Maximum uncompressed size per entry in bytes (default 2 GB). */
  maxEntrySize?: number;
}

export class ZipError extends Error {}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const MAX_ENTRY_SIZE = 2 * 1024 * 1024 * 1024;

/** Rejects names that could escape the extraction folder. */
export function validateEntryName(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[a-zA-Z]:/.test(name) ||
    name.split('/').some((part) => part === '..')
  ) {
    throw new ZipError(`Invalid zip entry name: ${name}`);
  }
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipBuffer(entries: ZipEntry[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    validateEntryName(entry.name);
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = zlib.crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, compressed);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(CENTRAL_SIG, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(entry.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

/** Writes a standard zip file (deflate, CRC-32) to destPath. */
export function writeZip(destPath: string, entries: ZipEntry[]): void {
  fs.writeFileSync(destPath, zipBuffer(entries));
}

/** Parses a zip held in memory via its central directory. Throws ZipError on anything malformed or unsafe. */
export function readZip(buffer: Buffer, opts: ReadZipOptions = {}): ZipEntry[] {
  const maxEntries = opts.maxEntries ?? 2;
  const maxSize = opts.maxEntrySize ?? MAX_ENTRY_SIZE;
  if (buffer.length < 22) throw new ZipError('Not a zip file');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === END_SIG) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('Not a zip file');
  const count = buffer.readUInt16LE(end + 10);
  const cdSize = buffer.readUInt32LE(end + 12);
  const cdOffset = buffer.readUInt32LE(end + 16);
  if (count > maxEntries) throw new ZipError('Too many entries in zip');
  if (cdOffset + cdSize > end) throw new ZipError('Corrupt zip directory');

  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || buffer.readUInt32LE(p) !== CENTRAL_SIG) throw new ZipError('Corrupt zip directory');
    const flags = buffer.readUInt16LE(p + 8);
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const compSize = buffer.readUInt32LE(p + 20);
    const size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    if (p + 46 + nameLen > end) throw new ZipError('Corrupt zip directory');
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    validateEntryName(name);
    if (flags & 1) throw new ZipError('Encrypted zip entries are not supported');
    if (size > maxSize) throw new ZipError(`Zip entry too large: ${name}`);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new ZipError('Corrupt zip entry');
    }
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (start + compSize > cdOffset) throw new ZipError('Corrupt zip entry');
    const raw = buffer.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new ZipError(`Corrupt zip entry: ${name}`);
      }
    } else {
      throw new ZipError('Unsupported zip compression method');
    }
    if (data.length !== size || zlib.crc32(data) !== crc) throw new ZipError(`Corrupt zip entry: ${name}`);
    out.push({ name, data });
  }
  return out;
}
