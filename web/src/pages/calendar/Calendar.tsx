import { useEffect, useId, useMemo, useState } from 'react';
import { CalendarDays, CalendarRange as CalendarRangeIcon, ChevronLeft, ChevronRight, List, Rss, type LucideIcon } from 'lucide-react';
import { Button, PageHeader, Switch } from '../../components/ui';
import { cn } from '../../lib/cn';
import { LoadError } from '../activity/History';
import { useUiConfig } from '../settings/hooks';
import { AgendaView } from './AgendaView';
import { ICalModal } from './ICalModal';
import { MonthView, StatusTag } from './MonthView';
import { WeekView } from './WeekView';
import {
  dayKey,
  groupByDay,
  rangeTitle,
  shiftAnchor,
  startOfDay,
  statusOrder,
  useCalendar,
  useCalendarPreferences,
  viewRange,
  type CalendarView,
} from './hooks';

const viewButtons: { view: CalendarView; label: string; icon: LucideIcon }[] = [
  { view: 'month', label: 'Month', icon: CalendarDays },
  { view: 'week', label: 'Week', icon: CalendarRangeIcon },
  { view: 'agenda', label: 'Agenda', icon: List },
];

const periodName: Record<CalendarView, string> = { month: 'month', week: 'week', agenda: 'period' };

/** Re-renders at the next minute so statuses ('Airing soon', 'Missing') and 'today' stay current. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setTimeout(() => setNow(new Date()), 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(t);
  }, [now]);
  return now;
}

export function Calendar() {
  const ui = useUiConfig();
  const firstDayOfWeek = ui.data?.firstDayOfWeek ?? 0;
  const colorImpaired = ui.data?.enableColorImpairedMode ?? false;
  const { view, setView, showUnmonitored, setShowUnmonitored } = useCalendarPreferences();
  const now = useNow();
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [icalOpen, setIcalOpen] = useState(false);
  const unmonitoredId = useId();

  const range = useMemo(() => viewRange(view, anchor, firstDayOfWeek), [view, anchor, firstDayOfWeek]);
  const calendar = useCalendar({
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    unmonitored: showUnmonitored,
  });

  // Only days in range; the server may include an edge episode from a neighbouring day.
  const episodesByDay = useMemo(() => {
    const grouped = groupByDay(calendar.data ?? []);
    const keys = new Set(range.days.map(dayKey));
    for (const key of [...grouped.keys()]) if (!keys.has(key)) grouped.delete(key);
    return grouped;
  }, [calendar.data, range]);

  const title = rangeTitle(view, anchor, range);
  const period = periodName[view];

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Upcoming and recent episodes of the series you follow."
        actions={
          <Button icon={<Rss aria-hidden="true" />} onClick={() => setIcalOpen(true)}>
            iCal
          </Button>
        }
        toolbar={
          <>
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
                Today
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Previous ${period}`}
                title={`Previous ${period}`}
                icon={<ChevronLeft aria-hidden="true" />}
                onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Next ${period}`}
                title={`Next ${period}`}
                icon={<ChevronRight aria-hidden="true" />}
                onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))}
              />
            </div>
            <p aria-live="polite" data-testid="calendar-range" className="min-w-0 flex-1 px-1 text-base font-semibold text-text">
              {title}
            </p>
            <div role="group" aria-label="View" className="flex items-center rounded-md border border-border p-0.5">
              {viewButtons.map(({ view: v, label, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'focus-ring inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium [@media(pointer:coarse)]:h-11',
                    view === v ? 'bg-accent text-accent-foreground' : 'text-text-muted hover:bg-surface-hover hover:text-text',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-1">
              <Switch id={unmonitoredId} checked={showUnmonitored} onCheckedChange={setShowUnmonitored} />
              <label htmlFor={unmonitoredId} className="text-sm text-text">
                Show unmonitored
              </label>
            </div>
          </>
        }
      />

      {calendar.isError && !calendar.data ? (
        <LoadError what="the calendar" error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : (
        <div aria-busy={calendar.isPending || calendar.isFetching || undefined}>
          {calendar.isPending && (
            <p role="status" className="sr-only">
              Loading calendar
            </p>
          )}
          {view === 'month' ? (
            <MonthView
              days={range.days}
              month={anchor}
              episodesByDay={episodesByDay}
              firstDayOfWeek={firstDayOfWeek}
              colorImpaired={colorImpaired}
              now={now}
              label={title}
            />
          ) : view === 'week' ? (
            <WeekView days={range.days} episodesByDay={episodesByDay} colorImpaired={colorImpaired} now={now} />
          ) : calendar.isPending ? null : (
            <AgendaView days={range.days} episodesByDay={episodesByDay} colorImpaired={colorImpaired} now={now} />
          )}
        </div>
      )}

      <section aria-label="Status legend" className="mt-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-text-muted">
          {statusOrder.map((s) => (
            <li key={s}>
              <StatusTag status={s} compact />
            </li>
          ))}
        </ul>
      </section>

      {icalOpen && <ICalModal open onClose={() => setIcalOpen(false)} />}
    </>
  );
}
