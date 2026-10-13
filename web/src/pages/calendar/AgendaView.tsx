import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import type { CalendarEpisode } from '@sonarr/shared';
import { Badge, EmptyState } from '../../components/ui';
import { cn } from '../../lib/cn';
import { episodeCode } from '../series/SeasonSection';
import { dayKey, episodeStatus, formatAirTime, formatDayLong, isSameDay, statusMeta, stripeStyle } from './hooks';
import { StatusTag } from './MonthView';

export interface AgendaViewProps {
  days: Date[];
  episodesByDay: Map<string, CalendarEpisode[]>;
  colorImpaired: boolean;
  now: Date;
}

function AgendaItem({ episode: ep, colorImpaired, now }: { episode: CalendarEpisode; colorImpaired: boolean; now: Date }) {
  const status = episodeStatus(ep, now);
  const meta = statusMeta[status];
  const time = formatAirTime(ep);
  const seriesTitle = ep.series?.title ?? `Series ${ep.seriesId}`;
  return (
    <li
      className={cn('flex flex-col gap-2 rounded-lg border-l-4 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4', meta.chip, colorImpaired && meta.pattern)}
      style={stripeStyle(meta, colorImpaired)}
    >
      <span className="w-20 shrink-0 text-sm font-medium text-text tabular-nums">{time ?? 'Time TBA'}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {ep.series?.titleSlug ? (
          <Link to={`/series/${ep.series.titleSlug}`} className="focus-ring self-start rounded-sm font-semibold break-words text-text hover:underline">
            {seriesTitle}
          </Link>
        ) : (
          <span className="font-semibold break-words text-text">{seriesTitle}</span>
        )}
        <span className="text-sm break-words text-text">
          <span className="tabular-nums">{episodeCode(ep)}</span>
          {ep.absoluteEpisodeNumber ? <span className="text-text-muted"> ({ep.absoluteEpisodeNumber})</span> : null}
          {` - ${ep.title || 'TBA'}`}
        </span>
        {(ep.series?.network || ep.runtime > 0) && (
          <span className="text-xs text-text-muted">
            {[ep.series?.network, ep.runtime > 0 ? `${ep.runtime} min` : undefined].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <StatusTag status={status} />
        {ep.hasFile && ep.episodeFile && <Badge variant="neutral">{ep.episodeFile.quality.quality.name}</Badge>}
      </div>
    </li>
  );
}

/** Day-grouped list with full details; days without episodes are skipped. */
export function AgendaView({ days, episodesByDay, colorImpaired, now }: AgendaViewProps) {
  const withEpisodes = days.filter((d) => (episodesByDay.get(dayKey(d)) ?? []).length > 0);
  if (withEpisodes.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="No episodes in this period"
        description="Use Next to look further ahead, or turn on 'Show unmonitored'."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {withEpisodes.map((day) => {
        const key = dayKey(day);
        const isToday = isSameDay(day, now);
        const headingId = `agenda-day-${key}`;
        return (
          <section key={key} aria-labelledby={headingId} aria-current={isToday ? 'date' : undefined}>
            <h2 id={headingId} className="mb-2 flex items-center gap-2 text-base font-semibold text-text">
              {formatDayLong(day)}
              {isToday && <Badge variant="accent">Today</Badge>}
            </h2>
            <ul className="flex flex-col gap-2">
              {(episodesByDay.get(key) ?? []).map((ep) => (
                <AgendaItem key={ep.id} episode={ep} colorImpaired={colorImpaired} now={now} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
