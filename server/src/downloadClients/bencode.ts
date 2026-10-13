import { createHash } from 'node:crypto';

const MAX_DEPTH = 64;

class BencodeError extends Error {}

function fail(msg: string): never {
  throw new BencodeError(`Malformed torrent: ${msg}`);
}

function readInt(buf: Uint8Array, pos: number): { value: number; end: number } {
  // buf[pos] is 'i'
  let i = pos + 1;
  const start = i;
  if (buf[i] === 0x2d) i++;
  const digits = i;
  while (i < buf.length && buf[i]! >= 0x30 && buf[i]! <= 0x39) i++;
  if (i === digits || buf[i] !== 0x65) fail('invalid integer');
  return { value: Number(Buffer.from(buf.subarray(start, i)).toString('latin1')), end: i + 1 };
}

function readStringEnd(buf: Uint8Array, pos: number): { start: number; end: number } {
  let i = pos;
  while (i < buf.length && buf[i]! >= 0x30 && buf[i]! <= 0x39) i++;
  if (i === pos || buf[i] !== 0x3a) fail('invalid string length');
  const len = Number(Buffer.from(buf.subarray(pos, i)).toString('latin1'));
  const start = i + 1;
  const end = start + len;
  if (!Number.isSafeInteger(end) || end > buf.length) fail('string exceeds input');
  return { start, end };
}

/** Returns the index just past the value starting at pos. */
function skipValue(buf: Uint8Array, pos: number, depth: number): number {
  if (depth > MAX_DEPTH) fail('nesting too deep');
  const c = buf[pos];
  if (c === undefined) fail('unexpected end');
  if (c === 0x69) return readInt(buf, pos).end;
  if (c === 0x6c) {
    let i = pos + 1;
    while (buf[i] !== 0x65) {
      if (i >= buf.length) fail('unterminated list');
      i = skipValue(buf, i, depth + 1);
    }
    return i + 1;
  }
  if (c === 0x64) {
    let i = pos + 1;
    while (buf[i] !== 0x65) {
      if (i >= buf.length) fail('unterminated dictionary');
      i = readStringEnd(buf, i).end;
      i = skipValue(buf, i, depth + 1);
    }
    return i + 1;
  }
  if (c >= 0x30 && c <= 0x39) return readStringEnd(buf, pos).end;
  return fail('unexpected token');
}

/** Hex sha1 of the raw bytes of the top-level 'info' dictionary. Throws on malformed input. */
export function infoHashFromTorrent(buf: Uint8Array): string {
  if (buf[0] !== 0x64) fail('not a dictionary');
  let i = 1;
  while (buf[i] !== 0x65) {
    if (i >= buf.length) fail('unterminated dictionary');
    const key = readStringEnd(buf, i);
    const name = Buffer.from(buf.subarray(key.start, key.end)).toString('latin1');
    const valueStart = key.end;
    const valueEnd = skipValue(buf, valueStart, 1);
    if (name === 'info') {
      if (buf[valueStart] !== 0x64) fail('info is not a dictionary');
      return createHash('sha1').update(buf.subarray(valueStart, valueEnd)).digest('hex');
    }
    i = valueEnd;
  }
  return fail('missing info dictionary');
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Lowercase hex info hash of a magnet link (base16 or base32 btih), or undefined. */
export function infoHashFromMagnet(magnet: string): string | undefined {
  const m = /[?&]xt=urn:btih:([^&]+)/i.exec(magnet);
  if (!m) return undefined;
  const v = decodeURIComponent(m[1]!);
  if (/^[0-9a-f]{40}$/i.test(v)) return v.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(v)) {
    let bits = '';
    for (const ch of v.toUpperCase()) bits += BASE32.indexOf(ch).toString(2).padStart(5, '0');
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex.slice(0, 40);
  }
  return undefined;
}
