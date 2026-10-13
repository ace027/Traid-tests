import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { CalendarEpisode } from '@sonarr/shared';
import { cn } from '../../lib/cn';
import { episodeCode } from '../series/SeasonSection';
import {
  addDays,
  dayKey,
  episodeStatus,
  formatAirTime,
  formatDayLong,
  isSameDay,
  statusMeta,
  stripeStyle,
  weekdayNames,
  type EpisodeStatus,
} from './hooks';

/** Status icon plus text, used by every view. */
export function StatusTag({ status, compact = false }: { status: EpisodeStatus; compact?: boolean }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', compact ? 'text-xs' : 'text-sm')}>
      <Icon aria-hidden="true" className={cn('shrink-0', compact ? 'size-3.5' : 'size-4', meta.text)} />
      <span>{meta.label}</span>
    </span>
  );
}

export interface ChipProps {
  episode: CalendarEpisode;
  colorImpaired: boolean;
  now: Date;
}

/** Compact episode chip (month view): series, SxxEyy, time and status, linking to the series. */
export function EpisodeChip({ episode: ep, colorImpaired, now }: ChipProps) {
  const status = episodeStatus(ep, now);
  const meta = statusMeta[status];
  const time = formatAirTime(ep);
  const code = episodeCode(ep);
  const seriesTitle = ep.series?.title ?? `Series ${ep.seriesId}`;
  const body = (
    <>
      <span className="block truncate font-medium text-text">{seriesTitle}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-text-muted">
        <span className="tabular-nums">{code}</span>
        {time && <span className="tabular-nums">{time}</span>}
        <StatusTag status={status} compact />
      </span>
    </>
  );
  const className = cn(
    'focus-ring block rounded-md border-l-4 px-1.5 py-1 text-xs leading-snug',
    meta.chip,
    colorImpaired && meta.pattern,
  );
  const title = `${seriesTitle} ${code}${ep.title ? ` - ${ep.title}` : ''}${time ? `, ${time}` : ''}, ${meta.label}`;
  return ep.series?.titleSlug ? (
    <Link to={`/series/${ep.series.titleSlug}`} title={title} className={cn(className, 'hover:brightness-110')} style={stripeStyle(meta, colorImpaired)}>
      {body}
    </Link>
  ) : (
    <span title={title} className={className} style={stripeStyle(meta, colorImpaired)}>
      {body}
    </span>
  );
}

/** Most lines a day cell shows; a crowded day shows MAX_VISIBLE - 1 chips and '+N more'. */
export const MAX_VISIBLE = 3;

function MorePopover({
  day,
  episodes,
  hidden,
  colorImpaired,
  now,
}: {
  day: Date;
  episodes: CalendarEpisode[];
  hidden: number;
  colorImpaired: boolean;
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointer = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`${hidden} more ${hidden === 1 ? 'episode' : 'episodes'} on ${formatDayLong(day)}`}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring w-full rounded-md px-1.5 py-0.5 text-left text-xs font-medium text-accent hover:bg-surface-hover"
      >
        +{hidden} more
      </button>
      {open && (
        <div
          ref={panelRef}
          id={popoverId}
          role="dialog"
          aria-label={`Episodes on ${formatDayLong(day)}`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
          className="absolute top-full left-0 z-30 mt-1 flex max-h-80 w-64 max-w-[80vw] flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-surface-raised p-2 shadow-lg outline-none"
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <p className="text-sm font-semibold text-text">{formatDayLong(day)}</p>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="focus-ring rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {episodes.map((ep) => (
              <li key={ep.id}>
                <EpisodeChip episode={ep} colorImpaired={colorImpaired} now={now} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface MonthViewProps {
  /** Whole weeks covering the month. */
  days: Date[];
  /** The month shown (other days are dimmed). */
  month: Date;
  episodesByDay: Map<string, CalendarEpisode[]>;
  firstDayOfWeek: number;
  colorImpaired: boolean;
  now: Date;
  /** Grid label, e.g. 'October 2026'. */
  label: string;
}

/** 7-column month grid (ARIA grid) with roving focus: arrows move by day/week, Home/End within the week. */
export function MonthView({ days, month, episodesByDay, firstDayOfWeek, colorImpaired, now, label }: MonthViewProps) {
  const today = days.find((d) => isSameDay(d, now));
  const inMonth = days.find((d) => d.getMonth() === month.getMonth());
  const [focusKey, setFocusKey] = useState(() => dayKey(today ?? inMonth ?? days[0]));
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const shouldFocus = useRef(false);
  const idBase = useId();

  // Keep the roving tab stop inside the visible range when the month changes.
  const visibleKeys = days.map(dayKey);
  const activeKey = visibleKeys.includes(focusKey) ? focusKey : dayKey(today ?? inMonth ?? days[0]);

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    cellRefs.current.get(activeKey)?.focus();
  }, [activeKey]);

  const names = weekdayNames(firstDayOfWeek, 'long');
  const short = weekdayNames(firstDayOfWeek, 'short');
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, day: Date, index: number) => {
    if (e.target !== e.currentTarget) return;
    const col = index % 7;
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -col,
      End: 6 - col,
    };
    const delta = moves[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const target = addDays(day, delta);
    const key = dayKey(target);
    if (!visibleKeys.includes(key)) return;
    shouldFocus.current = true;
    setFocusKey(key);
    if (key === activeKey) cellRefs.current.get(key)?.focus();
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised shadow-sm">
      <div role="grid" aria-label={label} className="min-w-[44rem]">
        <div role="row" className="grid grid-cols-7 border-b border-border bg-surface">
          {names.map((name, i) => (
            <div
              key={name}
              role="columnheader"
              className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-text-muted uppercase"
            >
              <span aria-hidden="true">{short[i]}</span>
              <span className="sr-only">{name}</span>
            </div>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={dayKey(week[0])} role="row" className="grid grid-cols-7 divide-x divide-border border-b border-border last:border-b-0">
            {week.map((day, d) => {
              const key = dayKey(day);
              const episodes = episodesByDay.get(key) ?? [];
              const isToday = isSameDay(day, now);
              const outside = day.getMonth() !== month.getMonth();
              const count = episodes.length;
              // A crowded day keeps one line for '+N more'.
              const visible = count > MAX_VISIBLE ? episodes.slice(0, MAX_VISIBLE - 1) : episodes;
              return (
                <div
                  key={key}
                  ref={(el) => {
                    if (el) cellRefs.current.set(key, el);
                    else cellRefs.current.delete(key);
                  }}
                  role="gridcell"
                  tabIndex={key === activeKey ? 0 : -1}
                  aria-labelledby={`${idBase}-${key}`}
                  aria-current={isToday ? 'date' : undefined}
                  onFocus={(e) => {
                    if (e.target === e.currentTarget) setFocusKey(key);
                  }}
                  onKeyDown={(e) => onKeyDown(e, day, w * 7 + d)}
                  className={cn(
                    'focus-ring flex min-h-28 min-w-0 flex-col gap-1 p-1.5 outline-none',
                    outside && 'bg-surface',
                    isToday && 'bg-accent-soft',
                  )}
                >
                  <span id={`${idBase}-${key}`} className="sr-only">
                    {`${formatDayLong(day)}${isToday ? ', today' : ''}, ${count === 0 ? 'no episodes' : `${count} ${count === 1 ? 'episode' : 'episodes'}`}`}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex size-6 items-center justify-center self-end rounded-full text-xs font-medium tabular-nums',
                      isToday ? 'bg-accent text-accent-foreground' : outside ? 'text-text-subtle' : 'text-text',
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {count > 0 && (
                    <ul className="flex flex-col gap-1">
                      {visible.map((ep) => (
                        <li key={ep.id}>
                          <EpisodeChip episode={ep} colorImpaired={colorImpaired} now={now} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {count > MAX_VISIBLE && <MorePopover day={day} episodes={episodes} hidden={count - visible.length} colorImpaired={colorImpaired} now={now} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
