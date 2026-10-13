import type { CalendarEpisode } from '@sonarr/shared';

export interface ICalOptions {
  /** Emit VALUE=DATE events instead of timed ones. */
  asAllDay?: boolean;
  now?: Date;
}

const DEFAULT_RUNTIME_MINUTES = 30;
const MAX_OCTETS = 75;

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting a UTF-8 character; continuations start with one space. */
export function foldLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch, 'utf8');
    // Continuation lines carry a leading space that counts toward the limit.
    const limit = out.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (size + bytes > limit) {
      out.push(out.length === 0 ? current : ` ${current}`);
      current = '';
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  out.push(out.length === 0 ? current : ` ${current}`);
  return out;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/** Day (UTC) the episode airs on, or undefined when it has no usable date. */
function airDay(e: CalendarEpisode): Date | undefined {
  const source = e.airDate ?? e.airDateUtc;
  if (!source) return undefined;
  const d = new Date(e.airDate ? `${e.airDate.slice(0, 10)}T00:00:00Z` : source);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function eventLines(e: CalendarEpisode, opts: ICalOptions, now: Date): string[] | undefined {
  const lines = ['BEGIN:VEVENT', `UID:sonarr_episode_${e.id}`, `DTSTAMP:${utcStamp(now)}`];
  const start = e.airDateUtc ? new Date(e.airDateUtc) : undefined;
  if (start && !Number.isNaN(start.getTime()) && !opts.asAllDay) {
    const minutes = e.runtime > 0 ? e.runtime : e.series.runtime > 0 ? e.series.runtime : DEFAULT_RUNTIME_MINUTES;
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(new Date(start.getTime() + minutes * 60_000))}`);
  } else {
    const day = start && !Number.isNaN(start.getTime()) ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) : airDay(e);
    if (!day) return undefined;
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(day)}`, `DTEND;VALUE=DATE:${dateStamp(new Date(day.getTime() + 86_400_000))}`);
  }
  lines.push(`SUMMARY:${escapeText(`${e.series.title} - ${e.seasonNumber}x${pad(e.episodeNumber)} - ${e.title}`)}`);
  if (e.overview) lines.push(`DESCRIPTION:${escapeText(e.overview)}`);
  if (e.series.network) lines.push(`CATEGORIES:${escapeText(e.series.network)}`);
  lines.push('STATUS:CONFIRMED', 'END:VEVENT');
  return lines;
}

/** Builds an RFC 5545 calendar: CRLF line endings, lines folded at 75 octets. Episodes without any date are skipped. */
export function buildICalendar(episodes: readonly CalendarEpisode[], opts: ICalOptions = {}): string {
  const now = opts.now ?? new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sonarr-replica//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Sonarr TV Schedule'];
  for (const e of episodes) {
    const ev = eventLines(e, opts, now);
    if (ev) lines.push(...ev);
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(foldLine).map((l) => `${l}\r\n`).join('');
}
