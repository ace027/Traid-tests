import type { NamingConfig, QualityModel } from '@sonarr/shared';

export type ColonReplacement = NamingConfig['colonReplacementFormat'];
export type MultiEpisodeStyle = NamingConfig['multiEpisodeStyle'];

export interface CleanOptions {
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: ColonReplacement;
}

/** Values a format string is rendered against. */
export interface TokenContext {
  seriesTitle: string;
  seriesYear: number;
  seasonNumber: number;
  episodeNumbers: number[];
  absoluteNumbers: number[];
  episodeTitle: string;
  /** YYYY-MM-DD */
  airDate?: string;
  quality?: QualityModel;
  releaseGroup?: string;
  originalTitle?: string;
  originalFilename?: string;
}

export type LiteralPart = { kind: 'literal'; text: string };
export type TokenPart = {
  kind: 'token';
  /** The text between the braces. */
  raw: string;
  /** Normalised lookup key. */
  key: string;
  /** Format after ':' (zero padding for numeric tokens). */
  format?: string;
  sep: ' ' | '.' | '_';
  caseMode: 'lower' | 'upper' | 'as-is';
};
export type FormatPart = LiteralPart | TokenPart;

export interface ParsedFormat {
  parts: FormatPart[];
  /** Structural problems: nested or unbalanced braces. */
  errors: string[];
}

const normaliseKey = (name: string) => name.trim().toLowerCase().replace(/[._ ]+/g, ' ');

/** Linear scanner: literals and {tokens}; nested braces are not allowed. */
export function parseFormat(format: string): ParsedFormat {
  const parts: FormatPart[] = [];
  const errors: string[] = [];
  let literal = '';
  const flush = () => {
    if (literal) parts.push({ kind: 'literal', text: literal });
    literal = '';
  };
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;
    if (ch === '{') {
      let j = i + 1;
      while (j < format.length && format[j] !== '}' && format[j] !== '{') j++;
      if (j < format.length && format[j] === '}') {
        flush();
        const raw = format.slice(i + 1, j);
        const colon = raw.indexOf(':');
        const name = colon === -1 ? raw : raw.slice(0, colon);
        const letters = name.replace(/[^A-Za-z]/g, '');
        const part: TokenPart = {
          kind: 'token',
          raw,
          key: normaliseKey(name),
          sep: name.includes('.') ? '.' : name.includes('_') ? '_' : ' ',
          caseMode: letters === letters.toLowerCase() ? 'lower' : letters === letters.toUpperCase() ? 'upper' : 'as-is',
        };
        if (colon !== -1) part.format = raw.slice(colon + 1);
        parts.push(part);
        i = j + 1;
        continue;
      }
      errors.push(j < format.length ? "Nested braces are not allowed" : "Unclosed '{' in format");
      literal += ch;
      i++;
      continue;
    }
    if (ch === '}') {
      errors.push("Unmatched '}' in format");
    }
    literal += ch;
    i++;
  }
  flush();
  return { parts, errors: [...new Set(errors)] };
}

// ---------------------------------------------------------------- cleaning

const SIMPLE_REPLACEMENTS: Record<string, string> = {
  '\\': '+',
  '/': '+',
  '<': '',
  '>': '',
  '?': '!',
  '*': '-',
  '"': "'",
  '|': '-',
};

/** Replaces (or removes) characters that are illegal in file names. */
export function cleanIllegal(text: string, opts: CleanOptions): string {
  let out = text;
  if (opts.replaceIllegalCharacters) {
    switch (opts.colonReplacementFormat) {
      case 'delete':
        out = out.replace(/:/g, '');
        break;
      case 'dash':
        out = out.replace(/:/g, '-');
        break;
      case 'spaceDash':
        out = out.replace(/:/g, ' -');
        break;
      case 'spaceDashSpace':
        out = out.replace(/:/g, ' - ');
        break;
      case 'smart':
        out = out.replace(/:\s+/g, ' - ').replace(/\s+:/g, ' -').replace(/:/g, '-');
        break;
    }
    out = out.replace(/[\\/<>?*"|]/g, (c) => SIMPLE_REPLACEMENTS[c]!);
  } else {
    out = out.replace(/[\\/:*?"<>|]/g, '');
  }
  // Control characters are never valid.
  // eslint-disable-next-line no-control-regex
  return out.replace(/[\u0000-\u001f]/g, '');
}

/** Final tidy-up of a rendered name: collapses spaces and dangling separators, trims. */
export function tidy(text: string): string {
  let s = text.replace(/\s+/g, ' ');
  s = s.replace(/\[\s*\]|\(\s*\)|\{\s*\}/g, '');
  s = s.replace(/\s+/g, ' ');
  // " - " around an empty token leaves " - - ".
  s = s.replace(/ [-_.] (?:[-_.] )+/g, ' - ');
  s = s.replace(/^(?:\s*[-_]\s+)+/, '');
  s = s.replace(/[\s.\-_]+$/, '');
  return s.trim();
}

const cleanTitleOf = (t: string) =>
  t
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const titleThe = (t: string) => {
  const m = /^(the|a|an)\s+(.+)$/i.exec(t);
  return m ? `${m[2]}, ${m[1]}` : t;
};

// ---------------------------------------------------------------- token table

export type TokenKind = 'series' | 'season' | 'episode' | 'absolute' | 'episodeTitle' | 'airDate' | 'quality' | 'releaseGroup' | 'original';

interface TextToken {
  kind: TokenKind;
  numeric?: false;
  value: (c: TokenContext) => string;
}
interface NumericToken {
  kind: TokenKind;
  numeric: true;
}
export type TokenDef = TextToken | NumericToken;

const proper = (q?: QualityModel) => (q && q.revision.version > 1 ? (q.revision.isRepack ? 'Repack' : 'Proper') : '');

export const TOKENS: Record<string, TokenDef> = {
  'series title': { kind: 'series', value: (c) => c.seriesTitle },
  'series titleyear': { kind: 'series', value: (c) => (c.seriesYear > 0 ? `${c.seriesTitle} (${c.seriesYear})` : c.seriesTitle) },
  'series cleantitle': { kind: 'series', value: (c) => cleanTitleOf(c.seriesTitle) },
  'series titlethe': { kind: 'series', value: (c) => titleThe(c.seriesTitle) },
  season: { kind: 'season', numeric: true },
  episode: { kind: 'episode', numeric: true },
  absolute: { kind: 'absolute', numeric: true },
  'episode title': { kind: 'episodeTitle', value: (c) => c.episodeTitle },
  'episode cleantitle': { kind: 'episodeTitle', value: (c) => cleanTitleOf(c.episodeTitle) },
  'air-date': { kind: 'airDate', value: (c) => c.airDate ?? '' },
  'air date': { kind: 'airDate', value: (c) => (c.airDate ?? '').replace(/-/g, ' ') },
  'quality full': {
    kind: 'quality',
    value: (c) => (c.quality ? [c.quality.quality.name, proper(c.quality)].filter(Boolean).join(' ') : ''),
  },
  'quality title': { kind: 'quality', value: (c) => c.quality?.quality.name ?? '' },
  'quality proper': { kind: 'quality', value: (c) => proper(c.quality) },
  'release group': { kind: 'releaseGroup', value: (c) => c.releaseGroup ?? '' },
  'original title': { kind: 'original', value: (c) => c.originalTitle || c.originalFilename || '' },
  'original filename': { kind: 'original', value: (c) => c.originalFilename ?? '' },
};

/** The token definition for a part, or undefined when the name or its format is not valid. */
export function resolveToken(part: TokenPart): TokenDef | undefined {
  const def = TOKENS[part.key];
  if (!def) return undefined;
  if (def.numeric) {
    if (part.format !== undefined && !/^0{1,3}$/.test(part.format)) return undefined;
  } else if (part.format !== undefined) {
    return undefined;
  }
  return def;
}

const pad = (n: number, width: number) => String(Math.abs(n)).padStart(width, '0');

/** Episode numbers rendered for the given multi-episode style; `letter` is the E/x before the number. */
function renderEpisodes(
  numbers: number[],
  width: number,
  style: MultiEpisodeStyle,
  letter: string,
  duplicatePrefix: string,
): string {
  const nums = numbers.map((n) => pad(n, width));
  if (nums.length <= 1) return nums[0] ?? '';
  const first = nums[0]!;
  const last = nums[nums.length - 1]!;
  switch (style) {
    case 'extend':
      return nums.join('-');
    case 'duplicate':
      return first + nums.slice(1).map((n) => `.${duplicatePrefix}${n}`).join('');
    case 'repeat':
      return first + nums.slice(1).map((n) => `${letter}${n}`).join('');
    case 'scene':
      return first + nums.slice(1).map((n) => `-${letter}${n}`).join('');
    case 'range':
      return `${first}-${last}`;
    case 'prefixedRange':
      return `${first}-${letter}${last}`;
  }
}

export interface RenderOptions extends CleanOptions {
  multiEpisodeStyle: MultiEpisodeStyle;
}

/** Renders a format against a context. Unknown tokens are left as written. */
export function renderFormat(format: string, ctx: TokenContext, opts: RenderOptions): string {
  const { parts } = parseFormat(format);
  const width = (p: TokenPart) => (p.format ? p.format.length : 1);
  let out = '';
  parts.forEach((part, idx) => {
    if (part.kind === 'literal') {
      out += part.text;
      return;
    }
    const def = resolveToken(part);
    if (!def) {
      out += `{${part.raw}}`;
      return;
    }
    if (def.numeric) {
      if (part.key === 'season') out += pad(ctx.seasonNumber, width(part));
      else if (part.key === 'absolute') out += ctx.absoluteNumbers.map((n) => pad(n, width(part))).join('-');
      else {
        const prev = parts[idx - 1];
        const letter = prev?.kind === 'literal' && /[exEX]$/.test(prev.text) ? prev.text.slice(-1) : '';
        let dupPrefix = '';
        const seasonPart = parts[idx - 2];
        if (letter && seasonPart?.kind === 'token' && seasonPart.key === 'season') {
          const before = parts[idx - 3];
          const s = before?.kind === 'literal' && /[sS]$/.test(before.text) ? before.text.slice(-1) : '';
          dupPrefix = `${s}${pad(ctx.seasonNumber, width(seasonPart))}${letter}`;
        } else if (letter) {
          dupPrefix = letter;
        }
        out += renderEpisodes(ctx.episodeNumbers, width(part), opts.multiEpisodeStyle, letter, dupPrefix);
      }
      return;
    }
    let value = cleanIllegal(def.value(ctx), opts).replace(/\s+/g, ' ').trim();
    if (part.caseMode === 'lower') value = value.toLowerCase();
    else if (part.caseMode === 'upper') value = value.toUpperCase();
    if (part.sep !== ' ') value = value.replace(/ /g, part.sep);
    out += value;
  });
  return tidy(cleanIllegal(out, opts));
}
