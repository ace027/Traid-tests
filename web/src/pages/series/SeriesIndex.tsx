import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, FolderInput, LayoutGrid, List, Plus, RefreshCw, ScanSearch, Search, Table2, Tv } from 'lucide-react';
import type { QualityProfile, Series } from '@sonarr/shared';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
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
import { EpisodeProgress, PosterImage, SeriesPoster } from './SeriesPoster';
import {
  errorMessage,
  formatBytes,
  statusLabels,
  statusVariant,
  useQualityProfiles,
  useRunCommand,
  useSeriesList,
} from './hooks';

export type SeriesView = 'posters' | 'overview' | 'table';
export type SeriesSortKey =
  | 'title'
  | 'network'
  | 'qualityProfile'
  | 'added'
  | 'year'
  | 'episodes'
  | 'sizeOnDisk'
  | 'nextAiring';
export type SeriesFilter = 'all' | 'monitored' | 'unmonitored' | 'continuing' | 'ended' | 'missing';

export interface SeriesIndexPrefs {
  view: SeriesView;
  sortKey: SeriesSortKey;
  sortDir: 'asc' | 'desc';
  filter: SeriesFilter;
}

export const PREFS_KEY = 'sonarr.seriesIndex';
const DEFAULT_PREFS: SeriesIndexPrefs = { view: 'posters', sortKey: 'title', sortDir: 'asc', filter: 'all' };

const sortLabels: Record<SeriesSortKey, string> = {
  title: 'Title',
  network: 'Network',
  qualityProfile: 'Quality Profile',
  added: 'Added',
  year: 'Year',
  episodes: 'Episodes',
  sizeOnDisk: 'Size on Disk',
  nextAiring: 'Next Airing',
};

const filterLabels: Record<SeriesFilter, string> = {
  all: 'All',
  monitored: 'Monitored Only',
  unmonitored: 'Unmonitored',
  continuing: 'Continuing',
  ended: 'Ended',
  missing: 'Missing Episodes',
};

const views: { value: SeriesView; label: string; icon: typeof LayoutGrid }[] = [
  { value: 'posters', label: 'Posters', icon: LayoutGrid },
  { value: 'overview', label: 'Overview', icon: List },
  { value: 'table', label: 'Table', icon: Table2 },
];

function loadPrefs(): SeriesIndexPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SeriesIndexPrefs>;
    return {
      view: parsed.view && parsed.view in { posters: 1, overview: 1, table: 1 } ? parsed.view : DEFAULT_PREFS.view,
      sortKey: parsed.sortKey && parsed.sortKey in sortLabels ? parsed.sortKey : DEFAULT_PREFS.sortKey,
      sortDir: parsed.sortDir === 'desc' ? 'desc' : 'asc',
      filter: parsed.filter && parsed.filter in filterLabels ? parsed.filter : DEFAULT_PREFS.filter,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function usePrefs() {
  const [prefs, setPrefs] = useState<SeriesIndexPrefs>(loadPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage full or disabled: preferences just won't persist
    }
  }, [prefs]);
  return [prefs, (patch: Partial<SeriesIndexPrefs>) => setPrefs((p) => ({ ...p, ...patch }))] as const;
}

const matchesFilter = (s: Series, f: SeriesFilter) => {
  switch (f) {
    case 'monitored':
      return s.monitored;
    case 'unmonitored':
      return !s.monitored;
    case 'continuing':
      return s.status === 'continuing';
    case 'ended':
      return s.status === 'ended';
    case 'missing':
      return (s.statistics?.episodeFileCount ?? 0) < (s.statistics?.episodeCount ?? 0);
    default:
      return true;
  }
};

function sortValue(s: Series, key: SeriesSortKey, profileNames: Map<number, string>): string | number {
  switch (key) {
    case 'title':
      return s.sortTitle || s.title.toLowerCase();
    case 'network':
      return (s.network ?? '').toLowerCase();
    case 'qualityProfile':
      return (profileNames.get(s.qualityProfileId) ?? '').toLowerCase();
    case 'added':
      return s.added;
    case 'year':
      return s.year;
    case 'episodes':
      return s.statistics?.episodeCount ? s.statistics.episodeFileCount / s.statistics.episodeCount : 0;
    case 'sizeOnDisk':
      return s.statistics?.sizeOnDisk ?? 0;
    case 'nextAiring':
      // Series without a next airing sort last when ascending.
      return s.statistics?.nextAiring ?? '9999';
  }
}

export function sortSeries(list: Series[], key: SeriesSortKey, dir: 'asc' | 'desc', profileNames = new Map<number, string>()) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key, profileNames);
    const vb = sortValue(b, key, profileNames);
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return cmp !== 0 ? cmp * sign : a.sortTitle.localeCompare(b.sortTitle);
  });
}

export function formatAiring(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function OverviewList({ series, profileNames }: { series: Series[]; profileNames: Map<number, string> }) {
  return (
    <ul className="flex flex-col gap-3">
      {series.map((s) => (
        <li
          key={s.id}
          className="relative flex gap-4 rounded-lg border border-border bg-surface-raised p-3 shadow-sm transition-colors focus-within:border-accent hover:bg-surface-hover/40"
        >
          <div className="w-16 shrink-0 sm:w-24">
            <PosterImage series={s} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-text">
                <Link
                  to={`/series/${s.titleSlug}`}
                  className="focus-ring rounded-sm after:absolute after:inset-0 after:content-[''] hover:text-accent"
                >
                  {s.title}
                </Link>
              </h2>
              <Badge variant={statusVariant(s.status)} dot>
                {statusLabels[s.status]}
              </Badge>
              {!s.monitored && <Badge>Unmonitored</Badge>}
            </div>
            <p className="line-clamp-2 text-sm text-text-muted">{s.overview || 'No overview available.'}</p>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
              {s.network && <Stat label="Network">{s.network}</Stat>}
              <Stat label="Quality">{profileNames.get(s.qualityProfileId) ?? '-'}</Stat>
              <Stat label="Seasons">{s.statistics?.seasonCount ?? s.seasons.filter((x) => x.seasonNumber > 0).length}</Stat>
              <Stat label="Size">{formatBytes(s.statistics?.sizeOnDisk ?? 0)}</Stat>
              {s.statistics?.nextAiring && <Stat label="Next airing">{formatAiring(s.statistics.nextAiring)}</Stat>}
            </dl>
            <EpisodeProgress series={s} className="max-w-sm" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="font-medium text-text">{children}</dd>
    </div>
  );
}

function SeriesTable({
  series,
  profileNames,
  prefs,
  onSort,
}: {
  series: Series[];
  profileNames: Map<number, string>;
  prefs: SeriesIndexPrefs;
  onSort: (key: SeriesSortKey) => void;
}) {
  const dir = (key: SeriesSortKey): SortDirection | null =>
    prefs.sortKey === key ? (prefs.sortDir === 'asc' ? 'ascending' : 'descending') : null;
  const sortTh = (key: SeriesSortKey, label = sortLabels[key]) => (
    <Th sortable sortDirection={dir(key)} onSort={() => onSort(key)}>
      {label}
    </Th>
  );
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
      <Table caption="Series" captionHidden>
        <THead>
          <tr>
            <Th>Status</Th>
            {sortTh('title', 'Series Title')}
            {sortTh('network')}
            {sortTh('qualityProfile')}
            {sortTh('nextAiring')}
            <Th>Seasons</Th>
            {sortTh('episodes')}
            {sortTh('sizeOnDisk')}
          </tr>
        </THead>
        <TBody>
          {series.map((s) => (
            <Tr key={s.id}>
              <Td>
                <Badge variant={statusVariant(s.status)} dot>
                  {statusLabels[s.status]}
                </Badge>
              </Td>
              <Td className="font-medium">
                <Link to={`/series/${s.titleSlug}`} className="focus-ring rounded-sm hover:text-accent">
                  {s.title}
                </Link>
              </Td>
              <Td className="text-text-muted">{s.network ?? '-'}</Td>
              <Td className="text-text-muted">{profileNames.get(s.qualityProfileId) ?? '-'}</Td>
              <Td className="text-text-muted">{formatAiring(s.statistics?.nextAiring)}</Td>
              <Td className="tabular-nums">{s.statistics?.seasonCount ?? s.seasons.filter((x) => x.seasonNumber > 0).length}</Td>
              <Td className="min-w-36">
                <EpisodeProgress series={s} />
              </Td>
              <Td className="whitespace-nowrap tabular-nums">{formatBytes(s.statistics?.sizeOnDisk ?? 0)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function FooterStats({ series }: { series: Series[] }) {
  const totals = series.reduce(
    (acc, s) => {
      acc.monitored += s.monitored ? 1 : 0;
      acc.episodes += s.statistics?.totalEpisodeCount ?? 0;
      acc.files += s.statistics?.episodeFileCount ?? 0;
      acc.size += s.statistics?.sizeOnDisk ?? 0;
      return acc;
    },
    { monitored: 0, episodes: 0, files: 0, size: 0 },
  );
  const items: [string, string | number][] = [
    ['Series', series.length],
    ['Monitored', totals.monitored],
    ['Unmonitored', series.length - totals.monitored],
    ['Episodes', totals.episodes],
    ['Files', totals.files],
    ['Total size', formatBytes(totals.size)],
  ];
  return (
    <footer className="mt-8 border-t border-border pt-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md bg-surface-raised px-3 py-2">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="text-lg font-semibold text-text tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </footer>
  );
}

/** Library overview: posters, overview list or table, with sort, filter and search. */
export function SeriesIndex() {
  const seriesQuery = useSeriesList();
  const profiles = useQualityProfiles();
  const runCommand = useRunCommand();
  const [prefs, setPrefs] = usePrefs();
  const [text, setText] = useState('');

  const profileNames = useMemo(
    () => new Map((profiles.data ?? []).map((p: QualityProfile) => [p.id, p.name])),
    [profiles.data],
  );
  const all = seriesQuery.data ?? [];
  const visible = useMemo(() => {
    const q = text.trim().toLowerCase();
    const filtered = all.filter(
      (s) => matchesFilter(s, prefs.filter) && (!q || s.title.toLowerCase().includes(q) || (s.network ?? '').toLowerCase().includes(q)),
    );
    return sortSeries(filtered, prefs.sortKey, prefs.sortDir, profileNames);
  }, [all, text, prefs.filter, prefs.sortKey, prefs.sortDir, profileNames]);

  const onHeaderSort = (key: SeriesSortKey) =>
    setPrefs(prefs.sortKey === key ? { sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' } : { sortKey: key, sortDir: 'asc' });

  const toolbar = (
    <>
      <div className="flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="View">
        {views.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={prefs.view === value}
            onClick={() => setPrefs({ view: value })}
            className={cn(
              'focus-ring inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition-colors',
              prefs.view === value ? 'bg-accent-soft text-accent' : 'text-text-muted hover:text-text',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </button>
        ))}
      </div>
      <Select
        aria-label="Sort by"
        className="w-40"
        value={prefs.sortKey}
        onChange={(e) => setPrefs({ sortKey: e.target.value as SeriesSortKey })}
        options={(Object.keys(sortLabels) as SeriesSortKey[]).map((k) => ({ value: k, label: sortLabels[k] }))}
      />
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Sort direction: ${prefs.sortDir === 'asc' ? 'ascending' : 'descending'}`}
        title="Toggle sort direction"
        onClick={() => setPrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}
        icon={prefs.sortDir === 'asc' ? <ArrowUpNarrowWide aria-hidden="true" /> : <ArrowDownWideNarrow aria-hidden="true" />}
      />
      <Select
        aria-label="Filter"
        className="w-44"
        value={prefs.filter}
        onChange={(e) => setPrefs({ filter: e.target.value as SeriesFilter })}
        options={(Object.keys(filterLabels) as SeriesFilter[]).map((k) => ({ value: k, label: filterLabels[k] }))}
      />
      <div className="relative min-w-40 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          aria-label="Filter series by title"
          placeholder="Filter series"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="focus-ring h-9 w-full rounded-md border border-control-border bg-surface-sunken pr-3 pl-9 text-sm text-text placeholder:text-text-subtle"
        />
      </div>
    </>
  );

  const actions = (
    <>
      <Button
        size="sm"
        icon={<RefreshCw aria-hidden="true" />}
        loading={runCommand.isPending && runCommand.variables?.name === 'RefreshSeries'}
        onClick={() => runCommand.mutate({ name: 'RefreshSeries', label: 'library update' })}
      >
        Update library
      </Button>
      <Button
        size="sm"
        icon={<ScanSearch aria-hidden="true" />}
        loading={runCommand.isPending && runCommand.variables?.name === 'RescanSeries'}
        onClick={() => runCommand.mutate({ name: 'RescanSeries', label: 'rescan of all series' })}
      >
        Rescan all
      </Button>
      <Link to="/add/new" className={buttonClasses('primary', 'sm')}>
        <Plus aria-hidden="true" /> Add New
      </Link>
    </>
  );

  if (seriesQuery.isPending) {
    return (
      <div>
        <PageHeader title="Series" />
        <Spinner label="Loading series" size="lg" />
      </div>
    );
  }

  if (seriesQuery.isError) {
    return (
      <div>
        <PageHeader title="Series" />
        <EmptyState title="Could not load series" description={errorMessage(seriesQuery.error)} />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div>
        <PageHeader title="Series" />
        <EmptyState
          icon={<Tv />}
          title="Your library is empty"
          description="Search for a show to add, or import the series folders you already have on disk."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/add/new" className={buttonClasses('primary')}>
                <Plus aria-hidden="true" /> Add New
              </Link>
              <Link to="/add/import" className={buttonClasses('secondary')}>
                <FolderInput aria-hidden="true" /> Library Import
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Series" actions={actions} toolbar={toolbar} />
      <p className="sr-only" role="status">
        {visible.length} of {all.length} series shown
      </p>
      {visible.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="No series match"
          description="Try a different filter or search text."
          action={
            <Button
              onClick={() => {
                setText('');
                setPrefs({ filter: 'all' });
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : prefs.view === 'posters' ? (
        <ul aria-label="Series" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
          {visible.map((s) => (
            <SeriesPoster key={s.id} series={s} />
          ))}
        </ul>
      ) : prefs.view === 'overview' ? (
        <OverviewList series={visible} profileNames={profileNames} />
      ) : (
        <SeriesTable series={visible} profileNames={profileNames} prefs={prefs} onSort={onHeaderSort} />
      )}
      <FooterStats series={all} />
    </div>
  );
}
