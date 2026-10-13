import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, RefreshCw, Search, SearchX, Trash2 } from 'lucide-react';
import type { Episode, EpisodeFile, Series } from '@sonarr/shared';
import { Badge, Button, EmptyState, Spinner, Switch, buttonClasses } from '../../components/ui';
import { DeleteSeriesModal } from './DeleteSeriesModal';
import { EditSeriesModal } from './EditSeriesModal';
import { InteractiveSearchModal, type InteractiveSearchTarget } from './InteractiveSearchModal';
import { SeasonSection } from './SeasonSection';
import { PosterImage } from './SeriesPoster';
import {
  errorMessage,
  fanartUrl,
  formatBytes,
  seriesTypeLabels,
  statusLabels,
  statusVariant,
  useEpisodeFiles,
  useEpisodes,
  useQualityProfiles,
  useRunCommand,
  useSeriesList,
  useUiConfig,
  useUpdateSeries,
} from './hooks';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-wide text-white/70 uppercase">{label}</dt>
      <dd className="truncate text-sm font-medium text-white">{children}</dd>
    </div>
  );
}

function Hero({ series, profileName, onToggleMonitored, toggling, actions }: {
  series: Series;
  profileName: string | undefined;
  onToggleMonitored: (v: boolean) => void;
  toggling: boolean;
  actions: ReactNode;
}) {
  const fanart = fanartUrl(series);
  return (
    <header className="relative isolate mb-6 overflow-hidden rounded-xl">
      {fanart ? (
        <img
          src={fanart}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="absolute inset-0 -z-20 size-full scale-110 object-cover blur-md"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 -z-20 bg-gradient-to-br from-accent via-accent-hover to-surface-sunken" />
      )}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/70 to-black/50" />
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:p-8">
        <div className="mx-auto w-36 shrink-0 shadow-2xl sm:mx-0 sm:w-44">
          <PosterImage series={series} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              checked={series.monitored}
              onCheckedChange={onToggleMonitored}
              disabled={toggling}
              aria-label="Monitored"
              title={series.monitored ? 'Monitored' : 'Unmonitored'}
            />
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{series.title}</h1>
            {series.year > 0 && <span className="text-lg text-white/80">({series.year})</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(series.status)} dot>
              {statusLabels[series.status]}
            </Badge>
            {!series.monitored && <Badge variant="warning">Unmonitored</Badge>}
            {series.genres.map((g) => (
              <span key={g} className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-xs text-white">
                {g}
              </span>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {series.network && <Fact label="Network">{series.network}</Fact>}
            {series.runtime > 0 && <Fact label="Runtime">{series.runtime} min</Fact>}
            <Fact label="Quality Profile">{profileName ?? '-'}</Fact>
            <Fact label="Type">{seriesTypeLabels[series.seriesType]}</Fact>
            <Fact label="Size on Disk">{formatBytes(series.statistics?.sizeOnDisk ?? 0)}</Fact>
            <Fact label="Path">
              <span title={series.path}>{series.path}</span>
            </Fact>
          </dl>
          {series.overview && <p className="max-w-3xl text-sm leading-relaxed text-white/90">{series.overview}</p>}
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      </div>
    </header>
  );
}

/** Seasons newest first, specials (season 0) last. */
export function orderSeasons<T extends { seasonNumber: number }>(seasons: T[]): T[] {
  return [...seasons].sort((a, b) => {
    if (a.seasonNumber === 0) return 1;
    if (b.seasonNumber === 0) return -1;
    return b.seasonNumber - a.seasonNumber;
  });
}

function Detail({ series }: { series: Series }) {
  const profiles = useQualityProfiles();
  const uiConfig = useUiConfig();
  const episodesQuery = useEpisodes(series.id);
  const filesQuery = useEpisodeFiles(series.id);
  const update = useUpdateSeries();
  const refresh = useRunCommand();
  // TODO(03-05 escalation): the plan drops this special case, but series.test.tsx (outside this
  // plan's files) still asserts the info toast. Remove once that test is updated.
  const search = useRunCommand({ unknownCommandMessage: 'Searching is available once indexers are configured' });
  const [editOpen, setEditOpen] = useState(false);
  const [interactive, setInteractive] = useState<InteractiveSearchTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const bySeason = useMemo(() => {
    const map = new Map<number, Episode[]>();
    for (const ep of episodesQuery.data ?? []) {
      const list = map.get(ep.seasonNumber) ?? [];
      list.push(ep);
      map.set(ep.seasonNumber, list);
    }
    return map;
  }, [episodesQuery.data]);
  const files = useMemo(
    () => new Map<number, EpisodeFile>((filesQuery.data ?? []).map((f) => [f.id, f])),
    [filesQuery.data],
  );

  const seasons = orderSeasons(series.seasons);
  const newest = seasons.find((s) => s.seasonNumber > 0)?.seasonNumber;
  const profileName = profiles.data?.find((p) => p.id === series.qualityProfileId)?.name;

  const toggleSeason = (seasonNumber: number, monitored: boolean) =>
    update.mutate({
      id: series.id,
      seasons: [{ seasonNumber, monitored }],
    });

  const actions = (
    <>
      <Button
        size="sm"
        icon={<RefreshCw aria-hidden="true" />}
        loading={refresh.isPending}
        onClick={() => refresh.mutate({ name: 'RefreshSeries', body: { seriesId: series.id }, label: `refresh of ${series.title}` })}
      >
        Refresh &amp; Scan
      </Button>
      <Button
        size="sm"
        icon={<Search aria-hidden="true" />}
        loading={search.isPending}
        onClick={() => search.mutate({ name: 'SeriesSearch', body: { seriesId: series.id }, label: `search for ${series.title}` })}
      >
        Search Monitored
      </Button>
      <Button size="sm" icon={<Pencil aria-hidden="true" />} onClick={() => setEditOpen(true)}>
        Edit
      </Button>
      <Button size="sm" variant="danger" icon={<Trash2 aria-hidden="true" />} onClick={() => setDeleteOpen(true)}>
        Delete
      </Button>
    </>
  );

  return (
    <div>
      <Link to="/" className="focus-ring mb-3 inline-flex items-center gap-1 rounded-sm text-sm text-text-muted hover:text-text">
        <ArrowLeft aria-hidden="true" className="size-4" /> All series
      </Link>
      <Hero
        series={series}
        profileName={profileName}
        onToggleMonitored={(monitored) => update.mutate({ id: series.id, monitored })}
        toggling={update.isPending}
        actions={actions}
      />

      <h2 className="mb-3 text-lg font-semibold text-text">Seasons</h2>
      {episodesQuery.isPending ? (
        <Spinner label="Loading episodes" />
      ) : episodesQuery.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(episodesQuery.error)}
        </p>
      ) : seasons.length === 0 ? (
        <EmptyState title="No seasons yet" description="Refresh the series to fetch its episodes." />
      ) : (
        <div className="flex flex-col gap-3">
          {seasons.map((season) => (
            <SeasonSection
              key={season.seasonNumber}
              seriesId={series.id}
              season={season}
              episodes={bySeason.get(season.seasonNumber) ?? []}
              files={files}
              showRelativeDates={uiConfig.data?.showRelativeDates ?? false}
              defaultOpen={season.seasonNumber === newest}
              onToggleMonitored={toggleSeason}
              seasonToggleDisabled={update.isPending}
              onInteractiveSearch={setInteractive}
            />
          ))}
        </div>
      )}

      <EditSeriesModal series={series} open={editOpen} onClose={() => setEditOpen(false)} />
      <DeleteSeriesModal series={series} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
      {interactive && <InteractiveSearchModal series={series} target={interactive} onClose={() => setInteractive(null)} />}
    </div>
  );
}

/** /series/:titleSlug */
export function SeriesDetail() {
  const { titleSlug } = useParams<{ titleSlug: string }>();
  const list = useSeriesList();
  const series = list.data?.find((s) => s.titleSlug === titleSlug);

  if (list.isPending) return <Spinner label="Loading series" size="lg" />;
  if (list.isError) return <EmptyState title="Could not load series" description={errorMessage(list.error)} />;
  if (!series) {
    return (
      <div>
        <h1 className="sr-only">Series not found</h1>
        <EmptyState
          icon={<SearchX />}
          title="Series not found"
          description={`There is no series "${titleSlug ?? ''}" in your library.`}
          action={
            <Link to="/" className={buttonClasses('primary')}>
              Back to series
            </Link>
          }
        />
      </div>
    );
  }
  return <Detail key={series.id} series={series} />;
}
