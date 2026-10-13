import { useEffect, useId, useState, type ReactNode } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, ListChecks, Search } from 'lucide-react';
import type { EpisodeFile } from '@sonarr/shared';
import { Badge, Button, ConfirmDialog, EmptyState, PageHeader, Select, TBody, THead, Table, Td, Th, Tr } from '../../components/ui';
import { api, queryKeys } from '../../lib/api';
import { LoadError, Pager, SeriesLink, SkeletonRows } from '../activity/History';
import { formatAbsolute } from '../activity/historyHooks';
import { episodeCode, formatAirDate } from '../series/SeasonSection';
import {
  useMonitorEpisodes,
  useWanted,
  useWantedSearch,
  type WantedItem,
  type WantedKind,
  type WantedParams,
  type WantedSortKey,
} from './hooks';

export const WANTED_PAGE_SIZE = 20;

export interface WantedTableProps {
  kind: WantedKind;
  title: string;
  description: string;
  /** Empty state for the monitored list. */
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon: ReactNode;
}

const filterOptions = [
  { value: 'monitored', label: 'Monitored' },
  { value: 'unmonitored', label: 'Unmonitored' },
];

/** Current file of each cutoff unmet record: from the record, else from the cached episode files. */
function useCurrentFiles(kind: WantedKind, records: WantedItem[]): Map<number, EpisodeFile> {
  const seriesIds =
    kind === 'cutoff' ? [...new Set(records.filter((r) => !r.episodeFile && r.episodeFileId > 0).map((r) => r.seriesId))] : [];
  const queries = useQueries({
    queries: seriesIds.map((seriesId) => ({
      queryKey: queryKeys.episodeFiles(seriesId),
      queryFn: () => api.get<EpisodeFile[]>('episodefile', { query: { seriesId } }),
      staleTime: 60_000,
    })),
  });
  const files = new Map<number, EpisodeFile>();
  for (const q of queries) for (const f of q.data ?? []) files.set(f.id, f);
  for (const r of records) if (r.episodeFile) files.set(r.episodeFile.id, r.episodeFile);
  return files;
}

/** Missing and Cutoff Unmet share this table: selection, sorting, paging, searches and monitoring. */
export function WantedTable({ kind, title, description, emptyTitle, emptyDescription, emptyIcon }: WantedTableProps) {
  const [params, setParams] = useState<WantedParams>({
    page: 1,
    pageSize: WANTED_PAGE_SIZE,
    sortKey: 'airDateUtc',
    sortDirection: 'descending',
    monitored: true,
    includeSeries: true,
  });
  const wanted = useWanted(kind, params);
  const search = useWantedSearch(kind);
  const qc = useQueryClient();
  const monitor = useMonitorEpisodes({
    onSuccess: () => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: queryKeys.wantedAll });
    },
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [searchingId, setSearchingId] = useState<number | null>(null);
  const filterId = useId();

  const records = wanted.data?.records ?? [];
  const total = wanted.data?.totalRecords ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const files = useCurrentFiles(kind, records);

  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(records.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [records]);

  useEffect(() => {
    if (wanted.data && params.page > totalPages) setParams((p) => ({ ...p, page: totalPages }));
  }, [wanted.data, params.page, totalPages]);

  const onSort = (sortKey: WantedSortKey) =>
    setParams((p) => ({
      ...p,
      page: 1,
      sortKey,
      sortDirection:
        p.sortKey === sortKey
          ? p.sortDirection === 'ascending'
            ? 'descending'
            : 'ascending'
          : sortKey === 'airDateUtc'
            ? 'descending'
            : 'ascending',
    }));
  const sortDir = (key: WantedSortKey) => (params.sortKey === key ? params.sortDirection : null);

  const allSelected = records.length > 0 && records.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(records.map((r) => r.id)));
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = records.filter((r) => selected.has(r.id)).map((r) => r.id);
  const listName = kind === 'missing' ? 'missing' : 'cutoff unmet';
  const columnCount = kind === 'cutoff' ? 7 : 6;
  const emptyMonitored = params.monitored;

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="text-sm text-text">
              Filter
            </label>
            <Select
              id={filterId}
              value={params.monitored ? 'monitored' : 'unmonitored'}
              options={filterOptions}
              onChange={(e) => {
                setSelected(new Set());
                setParams((p) => ({ ...p, page: 1, monitored: e.target.value === 'monitored' }));
              }}
            />
          </div>
        }
        toolbar={
          <>
            <Button
              icon={<Search aria-hidden="true" />}
              disabled={selectedIds.length === 0}
              onClick={() => search.searchEpisodes(selectedIds, { onSuccess: () => setSelected(new Set()) })}
            >
              Search selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </Button>
            <Button icon={<ListChecks aria-hidden="true" />} disabled={total === 0 || !params.monitored}
              title={params.monitored ? undefined : 'Search all only covers monitored episodes'}
              onClick={() => setConfirmAll(true)}
            >
              Search all
            </Button>
            <Button
              icon={params.monitored ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              disabled={selectedIds.length === 0}
              loading={monitor.isPending}
              onClick={() => monitor.mutate({ episodeIds: selectedIds, monitored: !params.monitored })}
            >
              {params.monitored ? 'Unmonitor selected' : 'Monitor selected'}
            </Button>
          </>
        }
      />

      {wanted.isError && !wanted.data ? (
        <LoadError what={`${listName} episodes`} error={wanted.error} onRetry={() => void wanted.refetch()} />
      ) : wanted.data && records.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={emptyMonitored ? emptyTitle : `No unmonitored ${listName} episodes`}
          description={emptyMonitored ? emptyDescription : 'Switch the filter to Monitored to see the rest.'}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
          {wanted.isPending && (
            <p role="status" className="sr-only">
              Loading {listName} episodes
            </p>
          )}
          <Table caption={`${title} episodes`} captionHidden aria-busy={wanted.isPending || undefined}>
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
                <Th sortable sortDirection={sortDir('series.sortTitle')} onSort={() => onSort('series.sortTitle')}>
                  Series
                </Th>
                <Th>Episode</Th>
                <Th>Episode Title</Th>
                <Th sortable sortDirection={sortDir('airDateUtc')} onSort={() => onSort('airDateUtc')}>
                  Air Date
                </Th>
                {kind === 'cutoff' && <Th>Quality</Th>}
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {wanted.isPending ? (
                <SkeletonRows columns={columnCount} />
              ) : (
                records.map((ep) => {
                  const code = episodeCode(ep);
                  const label = `${ep.series?.title ?? `Series ${ep.seriesId}`} ${code}`;
                  const file = ep.episodeFile ?? files.get(ep.episodeFileId);
                  const iso = ep.airDateUtc ?? ep.airDate;
                  return (
                    <Tr key={ep.id} data-testid={`wanted-${ep.id}`}>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${label}`}
                          checked={selected.has(ep.id)}
                          onChange={() => toggleOne(ep.id)}
                          className="focus-ring size-4 rounded border-control-border accent-accent"
                        />
                      </Td>
                      <Td className="min-w-40">
                        <SeriesLink series={ep.series} seriesId={ep.seriesId} />
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{code}</Td>
                      <Td className="min-w-48">{ep.title || 'TBA'}</Td>
                      <Td className="whitespace-nowrap">
                        <time dateTime={iso} title={formatAbsolute(iso)}>
                          {formatAirDate(ep, true)}
                        </time>
                      </Td>
                      {kind === 'cutoff' && (
                        <Td>
                          <Badge variant="warning">{file?.quality.quality.name ?? 'Unknown'}</Badge>
                        </Td>
                      )}
                      <Td className="py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Search ${label}`}
                          title="Automatic search"
                          icon={<Search aria-hidden="true" />}
                          loading={search.isPending && searchingId === ep.id}
                          onClick={() => {
                            setSearchingId(ep.id);
                            search.searchEpisodes([ep.id]);
                          }}
                        />
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
          <Pager
            label={`${title} pages`}
            page={params.page}
            totalRecords={total}
            pageSize={params.pageSize}
            noun={['episode', 'episodes']}
            onPage={(page) => setParams((p) => ({ ...p, page }))}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmAll}
        title={`Search all ${listName} episodes`}
        message={`This searches your indexers for ${total} ${listName} ${total === 1 ? 'episode' : 'episodes'}. Large searches can take a while and use up indexer API limits.`}
        confirmLabel="Search"
        danger={false}
        loading={search.isPending}
        onConfirm={() => search.searchAll({ onSuccess: () => setConfirmAll(false) })}
        onCancel={() => setConfirmAll(false)}
      />
    </>
  );
}
