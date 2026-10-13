import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  Inbox,
  Pause,
  RefreshCw,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Episode, QueueResource, Series } from '@sonarr/shared';
import { Badge, Button, EmptyState, PageHeader, Switch, TBody, THead, Table, Td, Th, Tr, buttonClasses, type BadgeVariant } from '../../components/ui';
import { api, queryKeys } from '../../lib/api';
import { cn } from '../../lib/cn';
import { ProtocolBadge } from '../settings/IndexerModal';
import { errorMessage, formatBytes } from '../settings/hooks';
import { useSeriesList } from '../series/hooks';
import { episodeCode } from '../series/SeasonSection';
import { RemoveQueueItemModal } from './RemoveQueueItemModal';
import {
  formatTimeLeft,
  queueProgress,
  useQueue,
  useQueueStatus,
  useRefreshQueue,
  useRemoveQueueItem,
  useRemoveQueueItems,
  type QueueParams,
  type QueueSortKey,
} from './hooks';

export const QUEUE_PAGE_SIZE = 20;

type DisplayStatus = 'downloading' | 'paused' | 'queued' | 'completed' | 'failed' | 'warning';

const statusDisplay: Record<DisplayStatus, { label: string; icon: LucideIcon; className: string }> = {
  downloading: { label: 'Downloading', icon: ArrowDownToLine, className: 'text-accent' },
  paused: { label: 'Paused', icon: Pause, className: 'text-text-muted' },
  queued: { label: 'Queued', icon: Clock, className: 'text-text-muted' },
  completed: { label: 'Completed', icon: CircleCheck, className: 'text-success' },
  failed: { label: 'Failed', icon: CircleX, className: 'text-danger' },
  warning: { label: 'Warning', icon: TriangleAlert, className: 'text-warning' },
};

export function displayStatus(item: Pick<QueueResource, 'status' | 'trackedDownloadStatus'>): DisplayStatus {
  if (item.status === 'failed' || item.trackedDownloadStatus === 'error') return 'failed';
  if (item.status === 'warning' || item.trackedDownloadStatus === 'warning') return 'warning';
  return item.status;
}

/** Status icon with screen reader text; messages open in a small popover. */
function StatusCell({ item }: { item: QueueResource }) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const status = displayStatus(item);
  const { label, icon: Icon, className } = statusDisplay[status];
  const messages = [
    ...(item.errorMessage ? [{ title: item.errorMessage, messages: [] as string[] }] : []),
    ...item.statusMessages,
  ];
  const icon = <Icon aria-hidden="true" className={cn('size-5', className)} />;

  if (messages.length === 0) {
    return (
      <span title={label} className="inline-flex">
        {icon}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <div
      className="relative inline-flex"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        title={label}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex rounded-md p-0.5 hover:bg-surface-hover"
      >
        {icon}
        <span className="sr-only">{label}, show status messages</span>
      </button>
      {open && (
        <div
          id={popoverId}
          className="absolute top-full left-0 z-20 mt-1 w-72 max-w-[80vw] rounded-lg border border-border bg-surface-raised p-3 text-left text-sm shadow-lg"
        >
          <p className="mb-1 font-semibold text-text">{label}</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-text-muted">
            {messages.map((m, i) => (
              <li key={i} className="break-words [overflow-wrap:anywhere]">
                {m.title}
                {m.messages.length > 0 && (
                  <ul className="list-[circle] pl-4">
                    {m.messages.map((msg, j) => (
                      <li key={j}>{msg}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Progress({ item }: { item: QueueResource }) {
  const pct = queueProgress(item);
  const status = displayStatus(item);
  const bar: Record<DisplayStatus, string> = {
    downloading: 'bg-accent',
    paused: 'bg-text-muted',
    queued: 'bg-text-muted',
    completed: 'bg-success',
    failed: 'bg-danger',
    warning: 'bg-warning',
  };
  return (
    <div className="flex min-w-36 flex-col gap-1">
      <div
        role="progressbar"
        aria-label={`Progress for ${item.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div className={cn('h-full rounded-full transition-[width]', bar[status])} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between gap-2 text-xs text-text-muted tabular-nums">
        <span className="font-medium text-text">{pct}%</span>
        <span>{item.sizeleft > 0 ? `${formatBytes(item.sizeleft)} left` : formatBytes(item.size)}</span>
      </div>
    </div>
  );
}

function episodeLabel(item: QueueResource, episodes: Map<number, Episode>): string {
  if (item.episodeIds.length === 1) {
    const ep = episodes.get(item.episodeIds[0]);
    return ep ? `${episodeCode(ep)} - ${ep.title || 'TBA'}` : '-';
  }
  // Season packs (several episodes, or a season without episode ids).
  return item.seasonNumber !== undefined ? `Season ${item.seasonNumber}` : '-';
}

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 4 }, (_, r) => (
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

function SortTh({
  sortKey,
  current,
  onSort,
  children,
}: {
  sortKey: QueueSortKey;
  current: Pick<QueueParams, 'sortKey' | 'sortDirection'>;
  onSort: (key: QueueSortKey) => void;
  children: ReactNode;
}) {
  return (
    <Th sortable sortDirection={current.sortKey === sortKey ? current.sortDirection : null} onSort={() => onSort(sortKey)}>
      {children}
    </Th>
  );
}

const COLUMN_COUNT = 11;

export function Queue() {
  const [params, setParams] = useState<QueueParams>({
    page: 1,
    pageSize: QUEUE_PAGE_SIZE,
    sortKey: 'timeleft',
    sortDirection: 'ascending',
    includeUnknownSeriesItems: false,
  });
  const queue = useQueue(params);
  const status = useQueueStatus();
  const seriesList = useSeriesList();
  const refresh = useRefreshQueue();
  const removeOne = useRemoveQueueItem();
  const removeMany = useRemoveQueueItems();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [toRemove, setToRemove] = useState<QueueResource[]>([]);
  const unknownSwitchId = useId();

  const records = queue.data?.records ?? [];
  const total = queue.data?.totalRecords ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));

  // Drop selections for items that left the queue.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(records.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [records]);

  // Clamp the page when items disappear from the last page.
  useEffect(() => {
    if (queue.data && params.page > totalPages) setParams((p) => ({ ...p, page: totalPages }));
  }, [queue.data, params.page, totalPages]);

  const seriesById = useMemo(
    () => new Map<number, Series>((seriesList.data ?? []).map((s) => [s.id, s])),
    [seriesList.data],
  );

  // Episode titles for single-episode items, one cached request per series on the page.
  const seriesIds = [...new Set(records.filter((r) => r.seriesId && r.episodeIds.length === 1).map((r) => r.seriesId!))];
  const episodeQueries = useQueries({
    queries: seriesIds.map((seriesId) => ({
      queryKey: queryKeys.episodes(seriesId),
      queryFn: () => api.get<Episode[]>('episode', { query: { seriesId } }),
      staleTime: 60_000,
    })),
  });
  const episodes = new Map<number, Episode>();
  for (const q of episodeQueries) for (const ep of q.data ?? []) episodes.set(ep.id, ep);

  const onSort = (sortKey: QueueSortKey) =>
    setParams((p) => ({
      ...p,
      page: 1,
      sortKey,
      sortDirection: p.sortKey === sortKey && p.sortDirection === 'ascending' ? 'descending' : 'ascending',
    }));

  const allSelected = records.length > 0 && records.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(records.map((r) => r.id)));
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmRemove = (options: { removeFromClient: boolean; blocklist: boolean }) => {
    const done = { onSuccess: () => setToRemove([]) };
    if (toRemove.length === 1) {
      removeOne.mutate({ id: toRemove[0].id, title: toRemove[0].title, ...options }, done);
    } else {
      const ids = toRemove.map((r) => r.id);
      removeMany.mutate({ ids, ...options }, {
        onSuccess: () => {
          setToRemove([]);
          setSelected(new Set());
        },
      });
    }
  };

  const unknownCount = status.data?.unknownCount ?? 0;

  return (
    <>
      {/* Section heading: the nav maps /activity/queue to 'Activity' (layout.test.tsx); the page title is 'Queue'. */}
      <h1 className="sr-only">Activity</h1>
      <PageHeader
        title="Queue"
        description="Downloads Sonarr is tracking in your download clients."
        actions={
          <>
            <div className="flex items-center gap-2">
              <Switch
                id={unknownSwitchId}
                checked={params.includeUnknownSeriesItems}
                onCheckedChange={(v) => setParams((p) => ({ ...p, page: 1, includeUnknownSeriesItems: v }))}
              />
              <label htmlFor={unknownSwitchId} className="text-sm text-text">
                Show unknown
              </label>
            </div>
            <Button
              variant="danger"
              icon={<X aria-hidden="true" />}
              disabled={selected.size === 0}
              onClick={() => setToRemove(records.filter((r) => selected.has(r.id)))}
            >
              Remove selected{selected.size > 0 ? ` (${selected.size})` : ''}
            </Button>
            <Button icon={<RefreshCw aria-hidden="true" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>
              Refresh
            </Button>
          </>
        }
      />

      {queue.isError && !queue.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          <span>Could not load the queue: {errorMessage(queue.error)}</span>
          <Button size="sm" onClick={() => void queue.refetch()}>
            Retry
          </Button>
        </div>
      ) : queue.data && records.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Queue is empty"
          description={
            !params.includeUnknownSeriesItems && unknownCount > 0
              ? `${unknownCount} unknown ${unknownCount === 1 ? 'item is' : 'items are'} hidden. Turn on "Show unknown" to see them.`
              : 'Nothing is downloading right now.'
          }
          action={
            <Link to="/wanted/missing" className={buttonClasses('secondary')}>
              Search for missing episodes
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
          {queue.isPending && (
            <p role="status" className="sr-only">
              Loading queue
            </p>
          )}
          <Table caption="Download queue" captionHidden aria-busy={queue.isPending || undefined}>
            <THead>
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    disabled={records.length === 0}
                    onChange={toggleAll}
                    className="focus-ring size-4 rounded border-control-border accent-accent"
                  />
                </Th>
                <Th className="w-12">
                  <span className="sr-only">Status</span>
                </Th>
                <SortTh sortKey="series" current={params} onSort={onSort}>
                  Series
                </SortTh>
                <Th>Episode</Th>
                <Th>Quality</Th>
                <Th>Protocol</Th>
                <Th>Indexer</Th>
                <Th>Download Client</Th>
                <SortTh sortKey="progress" current={params} onSort={onSort}>
                  Progress
                </SortTh>
                <SortTh sortKey="timeleft" current={params} onSort={onSort}>
                  Time Left
                </SortTh>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {queue.isPending ? (
                <SkeletonRows columns={COLUMN_COUNT} />
              ) : (
                records.map((item) => {
                  const series = item.seriesId ? seriesById.get(item.seriesId) : undefined;
                  return (
                    <Tr key={item.id} data-testid={`queue-${item.id}`}>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.title}`}
                          checked={selected.has(item.id)}
                          onChange={() => toggleOne(item.id)}
                          className="focus-ring size-4 rounded border-control-border accent-accent"
                        />
                      </Td>
                      <Td>
                        <StatusCell item={item} />
                      </Td>
                      <Td className="max-w-80 min-w-48">
                        {series ? (
                          <Link to={`/series/${series.titleSlug}`} className="focus-ring rounded-sm font-medium text-accent hover:underline">
                            {series.title}
                          </Link>
                        ) : item.seriesId ? (
                          <span className="font-medium">Series {item.seriesId}</span>
                        ) : (
                          <Badge variant="warning">Unknown series</Badge>
                        )}
                        <p className="mt-0.5 text-xs break-words text-text-muted [overflow-wrap:anywhere]">{item.title}</p>
                      </Td>
                      <Td className="min-w-40">{episodeLabel(item, episodes)}</Td>
                      <Td>
                        <Badge variant="neutral">{item.quality?.quality?.name ?? 'Unknown'}</Badge>
                      </Td>
                      <Td>
                        <ProtocolBadge protocol={item.protocol} />
                      </Td>
                      <Td className="whitespace-nowrap">{item.indexer || '-'}</Td>
                      <Td className="whitespace-nowrap">{item.downloadClient || '-'}</Td>
                      <Td>
                        <Progress item={item} />
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{formatTimeLeft(item.timeleft)}</Td>
                      <Td>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${item.title}`}
                          title="Remove"
                          icon={<X aria-hidden="true" />}
                          onClick={() => setToRemove([item])}
                        />
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
          <nav aria-label="Queue pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2 text-sm text-text-muted">
            <span>
              {total} {total === 1 ? 'item' : 'items'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronLeft aria-hidden="true" />}
                disabled={params.page <= 1}
                onClick={() => setParams((p) => ({ ...p, page: p.page - 1 }))}
              >
                Prev
              </Button>
              <span aria-live="polite">
                Page {params.page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                iconRight={<ChevronRight aria-hidden="true" />}
                disabled={params.page >= totalPages}
                onClick={() => setParams((p) => ({ ...p, page: p.page + 1 }))}
              >
                Next
              </Button>
            </div>
          </nav>
        </div>
      )}

      {toRemove.length > 0 && (
        <RemoveQueueItemModal
          key={toRemove.map((r) => r.id).join(',')}
          items={toRemove}
          loading={removeOne.isPending || removeMany.isPending}
          onConfirm={confirmRemove}
          onClose={() => setToRemove([])}
        />
      )}
    </>
  );
}
