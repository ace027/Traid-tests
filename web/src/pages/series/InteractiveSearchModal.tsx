import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, SearchX, TriangleAlert } from 'lucide-react';
import type { Episode, ReleaseResource, Series } from '@sonarr/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  Select,
  Spinner,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  buttonClasses,
  type SortDirection,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { ProtocolBadge, useIndexers } from '../settings/IndexerModal';
import { episodeCode } from './SeasonSection';
import { errorMessage, formatBytes, seasonName, useGrabRelease, useReleases, type ReleaseSearchParams } from './hooks';

export type InteractiveSearchTarget = { kind: 'episode'; episode: Episode } | { kind: 'season'; seasonNumber: number };

/** '45 minutes', '1 hour', '5 hours', '1 day', '3 days'. */
export function formatAge(release: Pick<ReleaseResource, 'age' | 'ageHours'>): string {
  const hours = Number.isFinite(release.ageHours) ? release.ageHours : release.age * 24;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (hours < 1) return plural(Math.max(1, Math.round(hours * 60)), 'minute');
  if (hours < 24) return plural(Math.floor(hours), 'hour');
  return plural(Number.isFinite(release.age) ? Math.floor(release.age) : Math.floor(hours / 24), 'day');
}

/** 'WEBDL-1080p', with 'Proper' or 'Repack' for revision 2+. */
export function qualityLabel(release: Pick<ReleaseResource, 'quality'>): string {
  const name = release.quality?.quality?.name ?? 'Unknown';
  const rev = release.quality?.revision;
  if (rev && rev.version > 1) return `${name} ${rev.isRepack ? 'Repack' : 'Proper'}`;
  return name;
}

export type ReleaseSortKey = 'protocol' | 'age' | 'title' | 'indexer' | 'size' | 'peers' | 'quality' | 'rejections';

const comparators: Record<ReleaseSortKey, (a: ReleaseResource, b: ReleaseResource) => number> = {
  protocol: (a, b) => a.protocol.localeCompare(b.protocol),
  age: (a, b) => (a.ageHours ?? a.age * 24) - (b.ageHours ?? b.age * 24),
  title: (a, b) => a.title.localeCompare(b.title),
  indexer: (a, b) => a.indexer.localeCompare(b.indexer),
  size: (a, b) => a.size - b.size,
  peers: (a, b) => (a.seeders ?? -1) - (b.seeders ?? -1),
  quality: (a, b) =>
    a.qualityWeight - b.qualityWeight || (a.quality?.revision?.version ?? 0) - (b.quality?.revision?.version ?? 0),
  rejections: (a, b) => a.rejections.length - b.rejections.length,
};

export function sortReleases(releases: ReleaseResource[], key: ReleaseSortKey | null, direction: SortDirection): ReleaseResource[] {
  if (!key) return releases;
  const sign = direction === 'ascending' ? 1 : -1;
  // Stable: ties keep the server's prioritized order.
  return releases
    .map((r, i) => [r, i] as const)
    .sort(([a, ia], [b, ib]) => sign * comparators[key](a, b) || ia - ib)
    .map(([r]) => r);
}

/** Below md each row becomes a stacked card; the cell label comes from data-label. */
const cardTable =
  'max-md:block max-md:[&_tbody]:block max-md:[&_tbody]:divide-y-0 max-md:[&_thead]:sr-only max-md:[&_tr]:mb-3 max-md:[&_tr]:block max-md:[&_tr]:rounded-lg max-md:[&_tr]:border max-md:[&_tr]:border-border max-md:[&_tr]:p-3';
const cardCell =
  'max-md:flex max-md:items-start max-md:gap-3 max-md:px-0 max-md:py-1 max-md:before:w-24 max-md:before:shrink-0 max-md:before:pt-0.5 max-md:before:text-xs max-md:before:font-semibold max-md:before:text-text-muted max-md:before:uppercase max-md:before:content-[attr(data-label)]';

function ReleaseRow({
  release,
  onConfirmRejected,
}: {
  release: ReleaseResource;
  onConfirmRejected: (release: ReleaseResource, grab: () => void) => void;
}) {
  const grab = useGrabRelease();
  const [showReasons, setShowReasons] = useState(false);
  const reasonsId = useId();
  const rejected = release.rejections.length > 0;
  const torrent = release.protocol === 'torrent';

  const doGrab = () => grab.mutate({ guid: release.guid, indexerId: release.indexerId, title: release.title });
  const onGrab = () => (rejected ? onConfirmRejected(release, doGrab) : doGrab());

  return (
    <Tr data-testid={`release-${release.indexerId}-${release.guid}`}>
      <Td data-label="Source" className={cardCell}>
        <ProtocolBadge protocol={release.protocol} />
      </Td>
      <Td data-label="Age" className={cn(cardCell, 'whitespace-nowrap text-text-muted')} title={new Date(release.publishDate).toLocaleString()}>
        {formatAge(release)}
      </Td>
      <Td data-label="Title" className={cn(cardCell, 'min-w-64 font-medium')}>
        <span className="break-words [overflow-wrap:anywhere]">{release.title}</span>
      </Td>
      <Td data-label="Indexer" className={cn(cardCell, 'whitespace-nowrap')}>
        {release.indexer}
      </Td>
      <Td data-label="Size" className={cn(cardCell, 'whitespace-nowrap tabular-nums')}>
        {formatBytes(release.size)}
      </Td>
      <Td data-label="Peers" className={cn(cardCell, 'whitespace-nowrap tabular-nums')}>
        {torrent ? (
          <span title={`${release.seeders ?? 0} seeders, ${release.leechers ?? 0} leechers`}>
            {release.seeders ?? 0} / {release.leechers ?? 0}
            <span className="sr-only"> seeders / leechers</span>
          </span>
        ) : (
          <span aria-label="Not applicable">-</span>
        )}
      </Td>
      <Td data-label="Quality" className={cardCell}>
        <Badge variant="neutral" className="whitespace-nowrap">
          {qualityLabel(release)}
        </Badge>
      </Td>
      <Td data-label="Status" className={cardCell}>
        {rejected ? (
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              aria-expanded={showReasons}
              aria-controls={reasonsId}
              onClick={() => setShowReasons((v) => !v)}
              className="focus-ring inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium whitespace-nowrap text-warning hover:bg-surface-hover"
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              {release.temporarilyRejected ? 'Temporarily rejected' : 'Rejected'} ({release.rejections.length})
              <span className="sr-only">, {showReasons ? 'hide' : 'show'} reasons</span>
            </button>
            {showReasons && (
              <ul id={reasonsId} className="flex max-w-xs list-disc flex-col gap-0.5 pl-5 text-xs text-text-muted">
                {release.rejections.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <Badge variant="success">
            <Check aria-hidden="true" className="size-3" />
            Approved
          </Badge>
        )}
      </Td>
      <Td data-label="Grab" className={cardCell}>
        <Button
          size="sm"
          variant={grab.isSuccess ? 'ghost' : 'secondary'}
          loading={grab.isPending}
          disabled={!release.downloadAllowed}
          title={release.downloadAllowed ? undefined : 'This release could not be matched to the series'}
          icon={grab.isSuccess ? <Check aria-hidden="true" className="text-success" /> : <Download aria-hidden="true" />}
          onClick={onGrab}
        >
          <span className="sr-only">
            {grab.isSuccess ? 'Grabbed' : 'Grab'} {release.title}
          </span>
        </Button>
      </Td>
    </Tr>
  );
}

const sortOptions: { value: ReleaseSortKey | ''; label: string }[] = [
  { value: '', label: 'Best match' },
  { value: 'quality', label: 'Quality' },
  { value: 'age', label: 'Age' },
  { value: 'size', label: 'Size' },
  { value: 'peers', label: 'Peers' },
  { value: 'title', label: 'Title' },
  { value: 'indexer', label: 'Indexer' },
];

function Results({
  releases,
  onConfirmRejected,
}: {
  releases: ReleaseResource[];
  onConfirmRejected: (release: ReleaseResource, grab: () => void) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'approved'>('all');
  const [sortKey, setSortKey] = useState<ReleaseSortKey | null>(null);
  const [direction, setDirection] = useState<SortDirection>('ascending');

  const approvedCount = releases.filter((r) => r.rejections.length === 0).length;
  const shown = useMemo(
    () => sortReleases(filter === 'approved' ? releases.filter((r) => r.rejections.length === 0) : releases, sortKey, direction),
    [releases, filter, sortKey, direction],
  );

  const onSort = (key: ReleaseSortKey) => {
    if (sortKey === key) setDirection((d) => (d === 'ascending' ? 'descending' : 'ascending'));
    else {
      setSortKey(key);
      setDirection('ascending');
    }
  };
  const th = (key: ReleaseSortKey, label: string) => (
    <Th sortable sortDirection={sortKey === key ? direction : null} onSort={() => onSort(key)}>
      {label}
    </Th>
  );

  const segment = (value: 'all' | 'approved', label: string) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={cn(
        'focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        filter === value ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted hover:text-text',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter releases" className="inline-flex rounded-lg border border-border bg-surface-sunken p-0.5">
          {segment('all', `All (${releases.length})`)}
          {segment('approved', `Approved (${approvedCount})`)}
        </div>
        <label className="flex items-center gap-2 text-sm text-text md:hidden">
          Sort by
          <Select
            value={sortKey ?? ''}
            options={sortOptions}
            onChange={(e) => {
              const key = e.target.value as ReleaseSortKey | '';
              setSortKey(key || null);
              setDirection(key === 'quality' || key === 'size' || key === 'peers' ? 'descending' : 'ascending');
            }}
          />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No approved releases. Show all releases to see the rejected ones.</p>
      ) : (
        <Table caption="Releases" captionHidden className={cardTable}>
          <THead>
            <tr>
              {th('protocol', 'Source')}
              {th('age', 'Age')}
              {th('title', 'Title')}
              {th('indexer', 'Indexer')}
              {th('size', 'Size')}
              {th('peers', 'Peers')}
              {th('quality', 'Quality')}
              {th('rejections', 'Status')}
              <Th>
                <span className="sr-only">Grab</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {shown.map((release) => (
              <ReleaseRow key={`${release.indexerId}:${release.guid}`} release={release} onConfirmRejected={onConfirmRejected} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function SearchBody({
  params,
  onConfirmRejected,
}: {
  params: ReleaseSearchParams;
  onConfirmRejected: (release: ReleaseResource, grab: () => void) => void;
}) {
  const indexers = useIndexers();
  const hasInteractive = (indexers.data ?? []).some((i) => i.enableInteractiveSearch);
  // If the indexer list fails to load, search anyway and let the server answer.
  const canSearch = indexers.isError || hasInteractive;
  const releases = useReleases(params, canSearch);

  if (indexers.isPending) return <Spinner label="Loading indexers" />;
  if (!canSearch) {
    const none = (indexers.data ?? []).length === 0;
    return (
      <EmptyState
        icon={<SearchX />}
        title={none ? 'No indexers configured' : 'Interactive search is disabled'}
        description={
          none
            ? 'Add an indexer in Settings > Indexers to search for releases.'
            : 'None of your indexers has interactive search enabled. Turn it on in Settings > Indexers.'
        }
        action={
          <Link to="/settings/indexers" className={buttonClasses('primary')}>
            Go to Settings &gt; Indexers
          </Link>
        }
      />
    );
  }
  if (releases.isPending) {
    return (
      <div className="flex flex-col items-center gap-2 py-10">
        <Spinner label="Searching indexers..." size="lg" />
        <p aria-hidden="true" className="text-sm text-text-muted">
          Searching indexers...
        </p>
      </div>
    );
  }
  if (releases.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
        <p>Search failed: {errorMessage(releases.error)}</p>
        <Button size="sm" onClick={() => void releases.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (releases.data.length === 0) {
    return (
      <EmptyState
        icon={<SearchX />}
        title="No results found"
        description="None of your indexers returned a release for this search."
        action={
          <Button loading={releases.isFetching} onClick={() => void releases.refetch()}>
            Search again
          </Button>
        }
      />
    );
  }
  return <Results releases={releases.data} onConfirmRejected={onConfirmRejected} />;
}

export interface InteractiveSearchModalProps {
  series: Pick<Series, 'id' | 'title'>;
  /** What to search for; the modal is open while set. */
  target: InteractiveSearchTarget | null;
  onClose: () => void;
}

/** Searches every interactive indexer for an episode or season and lets the user grab a release. */
export function InteractiveSearchModal({ series, target, onClose }: InteractiveSearchModalProps) {
  const [confirm, setConfirm] = useState<{ release: ReleaseResource; grab: () => void } | null>(null);

  const params: ReleaseSearchParams | null = !target
    ? null
    : target.kind === 'episode'
      ? { episodeId: target.episode.id }
      : { seriesId: series.id, seasonNumber: target.seasonNumber };
  const subject = !target ? '' : target.kind === 'episode' ? episodeCode(target.episode) : seasonName(target.seasonNumber);

  return (
    <>
      <Modal
        open={target !== null}
        onClose={onClose}
        title={`Interactive Search - ${series.title} ${subject}`}
        size="xl"
      >
        {params && (
          <SearchBody
            key={JSON.stringify(params)}
            params={params}
            onConfirmRejected={(release, grab) => setConfirm({ release, grab })}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={confirm !== null}
        title="Grab rejected release?"
        message={
          confirm && (
            <span className="break-words [overflow-wrap:anywhere]">
              This release was rejected: {confirm.release.rejections.join('; ')}. Grab anyway?
            </span>
          )
        }
        confirmLabel="Grab anyway"
        danger={false}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.grab();
          setConfirm(null);
        }}
      />
    </>
  );
}
