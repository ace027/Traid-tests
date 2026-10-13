import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  EyeOff,
  History as HistoryIcon,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { historyEventTypes, type Episode, type HistoryEventType, type HistoryResource, type Series } from '@sonarr/shared';
import { Badge, Button, EmptyState, PageHeader, Select, TBody, THead, Table, Td, Th, Tr } from '../../components/ui';
import { api, queryKeys } from '../../lib/api';
import { cn } from '../../lib/cn';
import { errorMessage } from '../settings/hooks';
import { useSeriesList } from '../series/hooks';
import { episodeCode } from '../series/SeasonSection';
import {
  formatAbsolute,
  formatRelative,
  historyDetails,
  historyEventLabels,
  useHistory,
  type HistoryParams,
} from './historyHooks';

export const HISTORY_PAGE_SIZE = 20;

const eventDisplay: Record<HistoryEventType, { icon: LucideIcon; className: string }> = {
  grabbed: { icon: ArrowDownToLine, className: 'text-accent' },
  downloadFolderImported: { icon: CircleCheck, className: 'text-success' },
  downloadFailed: { icon: CircleX, className: 'text-danger' },
  episodeFileDeleted: { icon: Trash2, className: 'text-danger' },
  episodeFileRenamed: { icon: Pencil, className: 'text-info' },
  downloadIgnored: { icon: EyeOff, className: 'text-text-muted' },
};

/** Event icon plus its text label (never colour alone). */
export function EventLabel({ eventType }: { eventType: HistoryEventType }) {
  const { icon: Icon, className } = eventDisplay[eventType] ?? eventDisplay.downloadIgnored;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', className)} />
      <span>{historyEventLabels[eventType] ?? eventType}</span>
    </span>
  );
}

/** Relative date with the full date and time as tooltip. */
export function DateCell({ iso }: { iso: string | undefined }) {
  return (
    <time dateTime={iso} title={formatAbsolute(iso)} className="whitespace-nowrap">
      {formatRelative(iso)}
    </time>
  );
}

/** Prev / Next paging footer shared by the activity and wanted tables. */
export function Pager({
  label,
  page,
  totalRecords,
  pageSize,
  noun = ['item', 'items'],
  onPage,
}: {
  label: string;
  page: number;
  totalRecords: number;
  pageSize: number;
  noun?: [string, string];
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2 text-sm text-text-muted"
    >
      <span>
        {totalRecords} {totalRecords === 1 ? noun[0] : noun[1]}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<ChevronLeft aria-hidden="true" />}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </Button>
        <span aria-live="polite">
          Page {page} of {totalPages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          iconRight={<ChevronRight aria-hidden="true" />}
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

export function SkeletonRows({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 animate-pulse rounded bg-surface-hover" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      <span>
        Could not load {what}: {errorMessage(error)}
      </span>
      <Button size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function SeriesLink({ series, seriesId }: { series: Series | undefined; seriesId: number | undefined }): ReactNode {
  if (series) {
    return (
      <Link to={`/series/${series.titleSlug}`} className="focus-ring rounded-sm font-medium text-accent hover:underline">
        {series.title}
      </Link>
    );
  }
  return seriesId ? <span className="font-medium">Series {seriesId}</span> : <span className="text-text-muted">-</span>;
}

/** Episodes for the series on the page, one cached request per series (same keys as the series pages). */
export function useEpisodeLookup(seriesIds: number[]): Map<number, Episode> {
  const unique = [...new Set(seriesIds.filter((id) => id > 0))];
  const queries = useQueries({
    queries: unique.map((seriesId) => ({
      queryKey: queryKeys.episodes(seriesId),
      queryFn: () => api.get<Episode[]>('episode', { query: { seriesId } }),
      staleTime: 60_000,
    })),
  });
  const map = new Map<number, Episode>();
  for (const q of queries) for (const ep of q.data ?? []) map.set(ep.id, ep);
  return map;
}

export function useSeriesById(): Map<number, Series> {
  const seriesList = useSeriesList();
  return useMemo(() => new Map<number, Series>((seriesList.data ?? []).map((s) => [s.id, s])), [seriesList.data]);
}

const filterOptions = [
  { value: '', label: 'All' },
  ...historyEventTypes.map((t) => ({ value: t, label: historyEventLabels[t] })),
];

const COLUMN_COUNT = 7;

export function History() {
  const [params, setParams] = useState<HistoryParams>({
    page: 1,
    pageSize: HISTORY_PAGE_SIZE,
    sortKey: 'date',
    sortDirection: 'descending',
  });
  const history = useHistory(params);
  const seriesById = useSeriesById();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const filterId = useId();
  const detailsIdBase = useId();

  const records = history.data?.records ?? [];
  const total = history.data?.totalRecords ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));

  useEffect(() => {
    if (history.data && params.page > totalPages) setParams((p) => ({ ...p, page: totalPages }));
  }, [history.data, params.page, totalPages]);

  const episodes = useEpisodeLookup(records.filter((r) => r.episodeId).map((r) => r.seriesId));

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const episodeLabel = (item: HistoryResource) => {
    const ep = item.episodeId ? episodes.get(item.episodeId) : undefined;
    if (ep) return `${episodeCode(ep)} - ${ep.title || 'TBA'}`;
    const { seasonNumber, episodeNumber } = item.data ?? {};
    if (seasonNumber && episodeNumber) return episodeCode({ seasonNumber: Number(seasonNumber), episodeNumber: Number(episodeNumber) });
    return '-';
  };

  const filtered = params.eventType !== undefined;

  return (
    <>
      <PageHeader
        title="History"
        description="Grabs, imports, failures and file changes, newest first."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="text-sm text-text">
              Event type
            </label>
            <Select
              id={filterId}
              value={params.eventType ?? ''}
              options={filterOptions}
              onChange={(e) => {
                const value = e.target.value as HistoryEventType | '';
                setExpanded(new Set());
                setParams((p) => ({ ...p, page: 1, eventType: value === '' ? undefined : value }));
              }}
            />
          </div>
        }
      />

      {history.isError && !history.data ? (
        <LoadError what="history" error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data && records.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon />}
          title={filtered ? 'No matching events' : 'No history yet'}
          description={
            filtered
              ? `There are no ${historyEventLabels[params.eventType!].toLowerCase()} events. Choose another event type.`
              : 'Grabs, imports and file changes will appear here.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
          {history.isPending && (
            <p role="status" className="sr-only">
              Loading history
            </p>
          )}
          <Table caption="History" captionHidden aria-busy={history.isPending || undefined}>
            <THead>
              <tr>
                <Th className="w-10">
                  <span className="sr-only">Details</span>
                </Th>
                <Th>Event</Th>
                <Th>Series</Th>
                <Th>Episode</Th>
                <Th>Source Title</Th>
                <Th>Quality</Th>
                <Th>Date</Th>
              </tr>
            </THead>
            <TBody>
              {history.isPending ? (
                <SkeletonRows columns={COLUMN_COUNT} />
              ) : (
                records.map((item) => {
                  const open = expanded.has(item.id);
                  const detailsId = `${detailsIdBase}-${item.id}`;
                  const details = historyDetails(item.data);
                  return (
                    <Fragment key={item.id}>
                      <Tr data-testid={`history-${item.id}`}>
                        <Td className="py-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={open}
                            aria-controls={open ? detailsId : undefined}
                            aria-label={`${open ? 'Hide' : 'Show'} details for ${item.sourceTitle}`}
                            title={open ? 'Hide details' : 'Show details'}
                            icon={<ChevronDown aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />}
                            onClick={() => toggle(item.id)}
                          />
                        </Td>
                        <Td>
                          <EventLabel eventType={item.eventType} />
                        </Td>
                        <Td className="min-w-40">
                          <SeriesLink series={seriesById.get(item.seriesId)} seriesId={item.seriesId} />
                        </Td>
                        <Td className="min-w-40">{episodeLabel(item)}</Td>
                        <Td className="max-w-96 min-w-56 break-words [overflow-wrap:anywhere]">{item.sourceTitle}</Td>
                        <Td>
                          <Badge variant="neutral">{item.quality?.quality?.name ?? 'Unknown'}</Badge>
                        </Td>
                        <Td>
                          <DateCell iso={item.date} />
                        </Td>
                      </Tr>
                      {open && (
                        <tr id={detailsId} className="bg-surface">
                          <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                            {details.length === 0 ? (
                              <p className="text-sm text-text-muted">No further details were recorded for this event.</p>
                            ) : (
                              <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
                                {details.map((d, i) => (
                                  <div key={i} className="contents">
                                    <dt className="font-medium text-text-muted">{d.label}</dt>
                                    <dd className="break-words text-text [overflow-wrap:anywhere]">{d.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TBody>
          </Table>
          <Pager
            label="History pages"
            page={params.page}
            totalRecords={total}
            pageSize={params.pageSize}
            noun={['event', 'events']}
            onPage={(page) => {
              setExpanded(new Set());
              setParams((p) => ({ ...p, page }));
            }}
          />
        </div>
      )}
    </>
  );
}
