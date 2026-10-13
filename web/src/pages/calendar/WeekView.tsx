import { Link } from 'react-router-dom';
import type { CalendarEpisode } from '@sonarr/shared';
import { cn } from '../../lib/cn';
import { episodeCode } from '../series/SeasonSection';
import { dayKey, episodeStatus, formatAirTime, formatDayLong, isSameDay, statusMeta, stripeStyle } from './hooks';
import { StatusTag } from './MonthView';

export interface WeekViewProps {
  days: Date[];
  episodesByDay: Map<string, CalendarEpisode[]>;
  colorImpaired: boolean;
  now: Date;
}

/** One time-ordered card per episode. */
function WeekCard({ episode: ep, colorImpaired, now }: { episode: CalendarEpisode; colorImpaired: boolean; now: Date }) {
  const status = episodeStatus(ep, now);
  const meta = statusMeta[status];
  const time = formatAirTime(ep);
  const seriesTitle = ep.series?.title ?? `Series ${ep.seriesId}`;
  return (
    <article
      className={cn('flex flex-col gap-0.5 rounded-md border-l-4 px-2 py-1.5 text-sm', meta.chip, colorImpaired && meta.pattern)}
      style={stripeStyle(meta, colorImpaired)}
    >
      <span className="text-xs text-text-muted tabular-nums">{time ?? 'Time TBA'}</span>
      {ep.series?.titleSlug ? (
        <Link to={`/series/${ep.series.titleSlug}`} className="focus-ring rounded-sm font-medium break-words text-text hover:underline">
          {seriesTitle}
        </Link>
      ) : (
        <span className="font-medium break-words text-text">{seriesTitle}</span>
      )}
      <span className="text-xs break-words text-text-muted">
        <span className="tabular-nums">{episodeCode(ep)}</span>
        {ep.title ? ` - ${ep.title}` : ''}
      </span>
      <StatusTag status={status} compact />
    </article>
  );
}

/** Seven day columns (stacked on small screens). */
export function WeekView({ days, episodesByDay, colorImpaired, now }: WeekViewProps) {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border shadow-sm md:grid-cols-7">
      {days.map((day) => {
        const key = dayKey(day);
        const episodes = episodesByDay.get(key) ?? [];
        const isToday = isSameDay(day, now);
        const headingId = `week-day-${key}`;
        return (
          <section
            key={key}
            aria-labelledby={headingId}
            aria-current={isToday ? 'date' : undefined}
            className={cn('flex min-h-32 min-w-0 flex-col gap-2 bg-surface-raised p-2', isToday && 'bg-accent-soft')}
          >
            <h2 id={headingId} className="flex items-baseline justify-between gap-2 text-sm font-semibold text-text">
              <span className="sr-only">
                {formatDayLong(day)}
                {isToday ? ', today' : ''}
              </span>
              <span aria-hidden="true">{weekday.format(day)}</span>
              <span aria-hidden="true" className={cn('text-xs tabular-nums', isToday ? 'font-bold text-accent' : 'text-text-muted')}>
                {date.format(day)}
              </span>
            </h2>
            {episodes.length === 0 ? (
              <p className="text-xs text-text-muted">No episodes</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {episodes.map((ep) => (
                  <li key={ep.id}>
                    <WeekCard episode={ep} colorImpaired={colorImpaired} now={now} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
