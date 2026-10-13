/**
 * Minimal dependency-free XML reader for Newznab/Torznab responses.
 * Everything is a linear indexOf scan; no regexes with nested quantifiers.
 */

export const MAX_XML_BYTES = 20 * 1024 * 1024;

export interface RawEnclosure {
  url: string;
  length: string;
  type: string;
}

export interface RawItem {
  title: string;
  guid: string;
  link: string;
  comments: string;
  pubDate: string;
  size: string;
  enclosure?: RawEnclosure;
  /** newznab:attr / torznab:attr values by lowercase name, in document order. */
  attrs: Record<string, string[]>;
}

export interface IndexerCaps {
  searchAvailable: boolean;
  tvSearchAvailable: boolean;
  tvSearchParams: string[];
  categories: { id: number; name: string }[];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function codePoint(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return null;
  try {
    return String.fromCodePoint(n);
  } catch {
    return null;
  }
}

/** Decodes XML entities in a string (no CDATA handling). */
export function decodeEntities(s: string): string {
  let amp = s.indexOf('&');
  if (amp < 0) return s;
  let out = '';
  let pos = 0;
  while (amp >= 0) {
    out += s.slice(pos, amp);
    const rel = s.slice(amp + 1, amp + 12).indexOf(';');
    const semi = rel < 0 ? -1 : amp + 1 + rel;
    let replaced: string | null = null;
    if (semi > amp) {
      const name = s.slice(amp + 1, semi);
      if (name[0] === '#') {
        const hex = name[1] === 'x' || name[1] === 'X';
        const digits = name.slice(hex ? 2 : 1);
        if (digits && (hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) {
          replaced = codePoint(parseInt(digits, hex ? 16 : 10));
        }
      } else if (name in NAMED) {
        replaced = NAMED[name]!;
      }
    }
    if (replaced !== null) {
      out += replaced;
      pos = semi + 1;
    } else {
      out += '&';
      pos = amp + 1;
    }
    amp = s.indexOf('&', pos);
  }
  return out + s.slice(pos);
}

/** Decodes element text: CDATA sections are taken verbatim, the rest is entity-decoded. */
export function decodeText(raw: string): string {
  let cd = raw.indexOf('<![CDATA[');
  if (cd < 0) return decodeEntities(raw).trim();
  let out = '';
  let pos = 0;
  while (cd >= 0) {
    out += decodeEntities(raw.slice(pos, cd));
    const end = raw.indexOf(']]>', cd + 9);
    if (end < 0) {
      out += raw.slice(cd + 9);
      pos = raw.length;
      break;
    }
    out += raw.slice(cd + 9, end);
    pos = end + 3;
    cd = raw.indexOf('<![CDATA[', pos);
  }
  out += decodeEntities(raw.slice(pos));
  return out.trim();
}

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

interface StartTag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  /** Index just past the closing '>'. */
  end: number;
}

/** Parses the start tag beginning at `lt` (which points at '<'). */
/** Where scanning should resume after the last failed readStartTag. */
let failAt = 0;
function fail(at: number): null {
  failAt = at;
  return null;
}

function readStartTag(s: string, lt: number): StartTag | null {
  failAt = 0;
  const t = readStartTagInner(s, lt);
  if (!t) failAt = Math.max(failAt, lt + 1);
  return t;
}

function readStartTagInner(s: string, lt: number): StartTag | null {
  let i = lt + 1;
  const nameStart = i;
  while (i < s.length && !isSpace(s[i]) && s[i] !== '>' && s[i] !== '/' && s[i] !== '<') i++;
  const name = s.slice(nameStart, i);
  if (!name) return fail(i);
  const attrs: Record<string, string> = {};
  for (;;) {
    while (i < s.length && isSpace(s[i])) i++;
    if (i >= s.length) return fail(s.length);
    const c = s[i]!;
    if (c === '<') return fail(i);
    if (c === '>') return { name, attrs, selfClosing: false, end: i + 1 };
    if (c === '/') {
      const close = s.indexOf('>', i);
      if (close < 0) return fail(s.length);
      return { name, attrs, selfClosing: true, end: close + 1 };
    }
    const aStart = i;
    while (i < s.length && !isSpace(s[i]) && s[i] !== '=' && s[i] !== '>' && s[i] !== '/' && s[i] !== '<') i++;
    const aName = s.slice(aStart, i);
    while (i < s.length && isSpace(s[i])) i++;
    if (s[i] === '=') {
      i++;
      while (i < s.length && isSpace(s[i])) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, i + 1);
        if (close < 0) return fail(s.length);
        if (aName) attrs[aName] = decodeEntities(s.slice(i + 1, close));
        i = close + 1;
      } else {
        const vStart = i;
        while (i < s.length && !isSpace(s[i]) && s[i] !== '>') i++;
        if (aName) attrs[aName] = decodeEntities(s.slice(vStart, i));
      }
    } else if (aName) {
      attrs[aName] = '';
    } else {
      i++;
    }
  }
}

/** Calls `cb` for every start tag in `s` (skipping comments, CDATA, PIs and end tags). */
function eachStartTag(s: string, cb: (tag: StartTag) => void): void {
  let pos = 0;
  for (;;) {
    const lt = s.indexOf('<', pos);
    if (lt < 0) return;
    const next = s[lt + 1];
    if (next === '!') {
      if (s.startsWith('<!--', lt)) {
        const end = s.indexOf('-->', lt + 4);
        pos = end < 0 ? s.length : end + 3;
      } else if (s.startsWith('<![CDATA[', lt)) {
        const end = s.indexOf(']]>', lt + 9);
        pos = end < 0 ? s.length : end + 3;
      } else {
        const end = s.indexOf('>', lt);
        pos = end < 0 ? s.length : end + 1;
      }
      continue;
    }
    if (next === '/' || next === '?') {
      const end = s.indexOf('>', lt);
      pos = end < 0 ? s.length : end + 1;
      continue;
    }
    const tag = readStartTag(s, lt);
    if (!tag) {
      pos = failAt;
      continue;
    }
    cb(tag);
    pos = tag.end;
  }
}

function checkSize(xml: string): void {
  if (xml.length > MAX_XML_BYTES) throw new Error('XML input exceeds the 20 MB limit');
}

const TEXT_TAGS = new Set(['title', 'guid', 'link', 'comments', 'pubDate', 'size', 'description']);

function parseItem(body: string): RawItem {
  const item: RawItem = { title: '', guid: '', link: '', comments: '', pubDate: '', size: '', attrs: {} };
  let pos = 0;
  const missingClose = new Set<string>();
  for (;;) {
    const lt = body.indexOf('<', pos);
    if (lt < 0) break;
    if (body[lt + 1] === '!' || body[lt + 1] === '/' || body[lt + 1] === '?') {
      // skip comments, CDATA, stray end tags
      let stop: string;
      let from = lt;
      if (body.startsWith('<!--', lt)) stop = '-->';
      else if (body.startsWith('<![CDATA[', lt)) stop = ']]>';
      else stop = '>';
      if (stop !== '>') from = lt + 4;
      const end = body.indexOf(stop, from);
      pos = end < 0 ? body.length : end + stop.length;
      continue;
    }
    const tag = readStartTag(body, lt);
    if (!tag) {
      pos = failAt;
      continue;
    }
    let content = '';
    pos = tag.end;
    if (!tag.selfClosing && TEXT_TAGS.has(tag.name) && !missingClose.has(tag.name)) {
      const close = body.indexOf('</' + tag.name, tag.end);
      if (close < 0) missingClose.add(tag.name);
      else {
        content = body.slice(tag.end, close);
        const gt = body.indexOf('>', close);
        pos = gt < 0 ? body.length : gt + 1;
      }
    }
    switch (tag.name) {
      case 'title':
        if (!item.title) item.title = decodeText(content);
        break;
      case 'guid':
        if (!item.guid) item.guid = decodeText(content);
        break;
      case 'link':
        if (!item.link) item.link = decodeText(content);
        break;
      case 'comments':
        if (!item.comments) item.comments = decodeText(content);
        break;
      case 'pubDate':
        if (!item.pubDate) item.pubDate = decodeText(content);
        break;
      case 'size':
        if (!item.size) item.size = decodeText(content);
        break;
      case 'enclosure':
        if (!item.enclosure) {
          item.enclosure = { url: tag.attrs.url ?? '', length: tag.attrs.length ?? '', type: tag.attrs.type ?? '' };
        }
        break;
      case 'newznab:attr':
      case 'torznab:attr': {
        const name = (tag.attrs.name ?? '').toLowerCase();
        if (name) (item.attrs[name] ??= []).push(tag.attrs.value ?? '');
        break;
      }
      default:
        break; // description and everything else is ignored
    }
  }
  return item;
}

export function readRssItems(xml: string): RawItem[] {
  checkSize(xml);
  const items: RawItem[] = [];
  let pos = 0;
  for (;;) {
    const start = xml.indexOf('<item', pos);
    if (start < 0) break;
    const after = xml[start + 5];
    if (!(after === '>' || isSpace(after) || after === '/')) {
      pos = start + 5;
      continue;
    }
    const tag = readStartTag(xml, start);
    if (!tag) break;
    if (tag.selfClosing) {
      pos = tag.end;
      continue;
    }
    const end = xml.indexOf('</item>', tag.end);
    const body = xml.slice(tag.end, end < 0 ? xml.length : end);
    items.push(parseItem(body));
    if (end < 0) break;
    pos = end + 7;
  }
  return items;
}

export function readError(xml: string): { code: number; description: string } | null {
  checkSize(xml);
  let found: { code: number; description: string } | null = null;
  eachStartTag(xml, (tag) => {
    if (found || tag.name !== 'error') return;
    const code = Number(tag.attrs.code);
    found = { code: Number.isFinite(code) ? code : 0, description: tag.attrs.description ?? '' };
  });
  return found;
}

export function readCaps(xml: string): IndexerCaps {
  checkSize(xml);
  const caps: IndexerCaps = { searchAvailable: false, tvSearchAvailable: false, tvSearchParams: [], categories: [] };
  const yes = (v: string | undefined) => (v ?? '').toLowerCase() === 'yes';
  eachStartTag(xml, (tag) => {
    if (tag.name === 'search') caps.searchAvailable = yes(tag.attrs.available);
    else if (tag.name === 'tv-search') {
      caps.tvSearchAvailable = yes(tag.attrs.available);
      caps.tvSearchParams = (tag.attrs.supportedParams ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    } else if (tag.name === 'category' || tag.name === 'subcat') {
      const id = Number(tag.attrs.id);
      if (Number.isInteger(id)) caps.categories.push({ id, name: tag.attrs.name ?? '' });
    }
  });
  return caps;
}
