import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Clock, EyeOff, Radio, type LucideIcon } from 'lucide-react';
import type { CalendarEpisode } from '@sonarr/shared';
import { api, queryKeys } from '../../lib/api';

// ---- data -----------------------------------------------------------------

export interface CalendarParams {
  /** ISO instant of the first local midnight in range. */
  start: string;
  /** ISO instant of the local midnight after the last day (exclusive). */
  end: string;
  unmonitored: boolean;
}

export const useCalendar = (params: CalendarParams) =>
  useQuery({
    queryKey: queryKeys.calendar({ ...params }),
    queryFn: ({ signal }) =>
      api.get<CalendarEpisode[]>('calendar', { query: { ...params, includeSeries: true }, signal }),
    placeholderData: keepPreviousData,
  });

// ---- view state -----------------------------------------------------------------

export type CalendarView = 'month' | 'week' | 'agenda';
export const calendarViews: CalendarView[] = ['month', 'week', 'agenda'];
export const STORAGE_KEY = 'sonarr.calendar';
/** Tailwind's md breakpoint. */
export const MD_QUERY = '(min-width: 768px)';

interface StoredState {
  view?: CalendarView;
  showUnmonitored?: boolean;
}

function readStored(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredState) : {};
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(patch: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), ...patch }));
  } catch {
    // Storage unavailable (private mode): the choice just is not remembered.
  }
}

/** Agenda below md, month otherwise; matchMedia is missing in some environments. */
export function defaultView(): CalendarView {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'month';
  return window.matchMedia(MD_QUERY).matches ? 'month' : 'agenda';
}

/** View and 'show unmonitored', persisted in localStorage 'sonarr.calendar'. */
export function useCalendarPreferences() {
  const [state, setState] = useState(() => {
    const stored = readStored();
    return {
      view: stored.view && calendarViews.includes(stored.view) ? stored.view : defaultView(),
      showUnmonitored: stored.showUnmonitored === true,
    };
  });
  const setView = useCallback((view: CalendarView) => {
    writeStored({ view });
    setState((s) => ({ ...s, view }));
  }, []);
  const setShowUnmonitored = useCallback((showUnmonitored: boolean) => {
    writeStored({ showUnmonitored });
    setState((s) => ({ ...s, showUnmonitored }));
  }, []);
  return { ...state, setView, setShowUnmonitored };
}

// ---- date helpers (local time, plain Date math) -----------------------------------

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Calendar-day arithmetic (setDate keeps local midnight across DST changes). */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Same day-of-month n months later, clamped to the month's length (Jan 31 + 1 -> Feb 28/29). */
export function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}

export function startOfWeek(d: Date, firstDayOfWeek: number): Date {
  const day = startOfDay(d);
  const offset = (day.getDay() - firstDayOfWeek + 7) % 7;
  return addDays(day, -offset);
}

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Local 'YYYY-MM-DD'. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses 'YYYY-MM-DD' as a local date. */
export function parseDayKey(key: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

export interface CalendarRange {
  /** First day shown (local midnight). */
  start: Date;
  /** Day after the last day shown (local midnight, exclusive). */
  end: Date;
  days: Date[];
}

export const AGENDA_DAYS = 14;

/**
 * Days a view shows around `anchor`. Month: whole weeks covering the month. Week: the week
 * containing the anchor. Agenda: AGENDA_DAYS days starting at the anchor.
 */
export function viewRange(view: CalendarView, anchor: Date, firstDayOfWeek: number): CalendarRange {
  let start: Date;
  let end: Date;
  if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    start = startOfWeek(first, firstDayOfWeek);
    end = addDays(startOfWeek(last, firstDayOfWeek), 7);
  } else if (view === 'week') {
    start = startOfWeek(anchor, firstDayOfWeek);
    end = addDays(start, 7);
  } else {
    start = startOfDay(anchor);
    end = addDays(start, AGENDA_DAYS);
  }
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  return { start, end, days };
}

/** Moves the anchor one period back (-1) or forward (+1). */
export function shiftAnchor(view: CalendarView, anchor: Date, step: -1 | 1): Date {
  if (view === 'month') return addMonths(new Date(anchor.getFullYear(), anchor.getMonth(), 1), step);
  if (view === 'week') return addDays(anchor, 7 * step);
  return addDays(anchor, AGENDA_DAYS * step);
}

type RangeFormatter = Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };

function formatRange(a: Date, b: Date, options: Intl.DateTimeFormatOptions): string {
  const fmt = new Intl.DateTimeFormat(undefined, options) as RangeFormatter;
  if (isSameDay(a, b)) return fmt.format(a);
  return typeof fmt.formatRange === 'function' ? fmt.formatRange(a, b) : `${fmt.format(a)} - ${fmt.format(b)}`;
}

/** 'October 2026', 'Dec 28, 2026 - Jan 3, 2027' and similar. */
export function rangeTitle(view: CalendarView, anchor: Date, range: CalendarRange): string {
  if (view === 'month') return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor);
  return formatRange(range.start, addDays(range.end, -1), { month: 'short', day: 'numeric', year: 'numeric' });
}

export const formatDayLong = (d: Date) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d);

/** Weekday names starting at the configured first day (Jan 4 2026 was a Sunday). */
export function weekdayNames(firstDayOfWeek: number, width: 'short' | 'long'): string[] {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: width });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 0, 4 + ((firstDayOfWeek + i) % 7))));
}

// ---- episodes -----------------------------------------------------------------------

/** Local air instant, or undefined when only the date is known (no air time). */
export function airInstant(ep: Pick<CalendarEpisode, 'airDateUtc'>): Date | undefined {
  if (!ep.airDateUtc) return undefined;
  const d = new Date(ep.airDateUtc);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Local day an episode belongs to: its air instant, else its air date. */
export function episodeDayKey(ep: Pick<CalendarEpisode, 'airDate' | 'airDateUtc'>): string | undefined {
  const instant = airInstant(ep);
  if (instant) return dayKey(instant);
  return ep.airDate && parseDayKey(ep.airDate) ? ep.airDate.slice(0, 10) : undefined;
}

/** '9:00 PM', or undefined for episodes without an air time. */
export function formatAirTime(ep: Pick<CalendarEpisode, 'airDateUtc'>): string | undefined {
  const instant = airInstant(ep);
  return instant ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(instant) : undefined;
}

function compareEpisodes(a: CalendarEpisode, b: CalendarEpisode): number {
  const ta = airInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const tb = airInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb ? -1 : 1;
  const titles = (a.series?.sortTitle ?? '').localeCompare(b.series?.sortTitle ?? '');
  return titles || a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber;
}

/** Episodes grouped by local day key, each day in air order (episodes without a time last). */
export function groupByDay(episodes: CalendarEpisode[]): Map<string, CalendarEpisode[]> {
  const map = new Map<string, CalendarEpisode[]>();
  for (const ep of episodes) {
    const key = episodeDayKey(ep);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(ep);
    else map.set(key, [ep]);
  }
  for (const list of map.values()) list.sort(compareEpisodes);
  return map;
}

export type EpisodeStatus = 'downloaded' | 'missing' | 'airingSoon' | 'unaired' | 'unmonitored';

const HOUR = 3_600_000;

/** Status shown by every view. Date-only episodes count as aired once their day is over. */
export function episodeStatus(ep: CalendarEpisode, now = new Date()): EpisodeStatus {
  if (ep.hasFile) return 'downloaded';
  if (!ep.monitored || ep.series?.monitored === false) return 'unmonitored';
  const instant = airInstant(ep);
  const airAt = instant ?? (ep.airDate ? parseDayKey(ep.airDate) : undefined);
  if (!airAt) return 'unaired';
  const aired = instant ? instant <= now : addDays(airAt, 1) <= now;
  if (aired) return 'missing';
  if (airAt.getTime() - now.getTime() <= 24 * HOUR) return 'airingSoon';
  return 'unaired';
}

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** Icon colour. */
  text: string;
  /** Chip/card accent: left border and soft background. */
  chip: string;
  /** Extra non-colour cue for colour-impaired mode: left border style. */
  pattern: string;
  /** Colour-impaired mode also stripes these (CSS colour of the stripes). */
  stripes?: string;
}

/** Inline style for colour-impaired stripes. */
export function stripeStyle(meta: StatusMeta, colorImpaired: boolean): { backgroundImage: string } | undefined {
  if (!colorImpaired || !meta.stripes) return undefined;
  return {
    backgroundImage: `repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, ${meta.stripes} 16%, transparent) 6px 9px)`,
  };
}

export const statusMeta: Record<EpisodeStatus, StatusMeta> = {
  downloaded: {
    label: 'Downloaded',
    icon: CircleCheck,
    text: 'text-success',
    chip: 'border-l-success bg-success-soft',
    pattern: 'border-solid',
  },
  missing: {
    label: 'Missing',
    icon: CircleAlert,
    text: 'text-danger',
    chip: 'border-l-danger bg-danger-soft',
    pattern: 'border-solid',
    stripes: 'var(--color-danger)',
  },
  airingSoon: {
    label: 'Airing soon',
    icon: Radio,
    text: 'text-warning',
    chip: 'border-l-warning bg-warning-soft',
    pattern: 'border-dotted',
  },
  unaired: {
    label: 'Unaired',
    icon: Clock,
    text: 'text-info',
    chip: 'border-l-info bg-info-soft',
    pattern: 'border-dashed',
  },
  unmonitored: {
    label: 'Unmonitored',
    icon: EyeOff,
    text: 'text-text-muted',
    chip: 'border-l-border-strong bg-surface-sunken',
    pattern: 'border-double',
    stripes: 'var(--color-text-muted)',
  },
};

export const statusOrder: EpisodeStatus[] = ['downloaded', 'missing', 'airingSoon', 'unaired', 'unmonitored'];
