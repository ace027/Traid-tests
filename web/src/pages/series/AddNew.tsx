import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderInput, Search, SearchX, Settings } from 'lucide-react';
import type { SeriesLookup } from '@sonarr/shared';
import { Badge, EmptyState, PageHeader, Spinner, buttonClasses } from '../../components/ui';
import { AddSeriesModal } from './AddSeriesModal';
import { PosterImage } from './SeriesPoster';
import {
  errorMessage,
  statusLabels,
  statusVariant,
  useDebouncedValue,
  useQualityProfiles,
  useRootFolders,
  useSeriesList,
  useSeriesLookup,
} from './hooks';

function ResultCard({
  item,
  existingSlug,
  onSelect,
}: {
  item: SeriesLookup;
  existingSlug: string | undefined;
  onSelect: (item: SeriesLookup) => void;
}) {
  const stretched = 'focus-ring rounded-sm text-left after:absolute after:inset-0 after:content-[""]';
  return (
    <li className="group relative flex gap-4 rounded-lg border border-border bg-surface-raised p-3 shadow-sm transition-colors focus-within:border-accent hover:border-border-strong hover:bg-surface-hover/40 sm:p-4">
      <div className="w-20 shrink-0 sm:w-28">
        <PosterImage series={item} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-lg font-semibold text-text">
            {existingSlug ? (
              <Link to={`/series/${existingSlug}`} className={stretched}>
                {item.title}
              </Link>
            ) : (
              <button type="button" onClick={() => onSelect(item)} className={stretched}>
                {item.title}
              </button>
            )}
          </h2>
          {item.year > 0 && <span className="text-sm text-text-muted">({item.year})</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.network && <Badge>{item.network}</Badge>}
          <Badge variant={statusVariant(item.status)} dot>
            {statusLabels[item.status]}
          </Badge>
          {existingSlug && (
            <Badge variant="accent" className="relative z-10">
              Already in library
            </Badge>
          )}
        </div>
        <p className="line-clamp-3 text-sm text-text-muted">{item.overview || 'No overview available.'}</p>
      </div>
    </li>
  );
}

/** Search TVmaze (by name or 'tvdb:123') and add a series. */
export function AddNew() {
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 300);
  const lookup = useSeriesLookup(debounced);
  const library = useSeriesList();
  const rootFolders = useRootFolders();
  const profiles = useQualityProfiles();
  const [selected, setSelected] = useState<SeriesLookup | null>(null);

  const existing = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of library.data ?? []) map.set(s.tvMazeId, s.titleSlug);
    return map;
  }, [library.data]);

  const trimmed = debounced.trim();
  const setupMissing =
    (rootFolders.isSuccess && rootFolders.data.length === 0) || (profiles.isSuccess && profiles.data.length === 0);
  const results = lookup.data ?? [];

  return (
    <div>
      <PageHeader title="Add New" description="Search by name, or use tvdb:123 / imdb:tt123 / tvmaze:123." />

      {setupMissing && (
        <div
          role="note"
          className="mb-6 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-text sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            {rootFolders.data?.length === 0 ? 'No root folders are configured. ' : ''}
            {profiles.data?.length === 0 ? 'No quality profiles exist. ' : ''}
            Series cannot be added until both are set up.
          </p>
          <div className="flex gap-2">
            {rootFolders.data?.length === 0 && (
              <Link to="/settings/mediamanagement" className={buttonClasses('secondary', 'sm')}>
                <Settings aria-hidden="true" /> Media Management
              </Link>
            )}
            {profiles.data?.length === 0 && (
              <Link to="/settings/profiles" className={buttonClasses('secondary', 'sm')}>
                <Settings aria-hidden="true" /> Profiles
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="relative mb-6">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          // Autofocus is the point of this page: the user came here to type.
          autoFocus
          aria-label="Search for a series"
          placeholder="eg. Breaking Bad, tvdb:81189"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="focus-ring h-14 w-full rounded-xl border border-control-border bg-surface-raised pr-12 pl-12 text-lg text-text shadow-sm placeholder:text-text-subtle hover:border-text-muted"
        />
        {lookup.isFetching && <Spinner label="Searching" className="absolute top-1/2 right-4 -translate-y-1/2" />}
      </div>

      {trimmed.length < 2 ? (
        <EmptyState
          icon={<Search />}
          title="Find a series to add"
          description="Start typing a show name. Already have a folder full of shows? Import them instead."
          action={
            <Link to="/add/import" className={buttonClasses('secondary')}>
              <FolderInput aria-hidden="true" /> Library Import
            </Link>
          }
        />
      ) : lookup.isError ? (
        <EmptyState icon={<SearchX />} title="Search failed" description={errorMessage(lookup.error)} />
      ) : lookup.isSuccess && results.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={`No results for "${trimmed}"`}
          description="Check the spelling or try a tvdb:, imdb: or tvmaze: id."
        />
      ) : (
        <section aria-label="Search results" aria-busy={lookup.isPending}>
          <ul className="flex flex-col gap-3">
            {results.map((item) => (
              <ResultCard
                key={item.tvMazeId}
                item={item}
                existingSlug={existing.get(item.tvMazeId) ?? ((item as { id?: number }).id ? item.titleSlug : undefined)}
                onSelect={setSelected}
              />
            ))}
          </ul>
        </section>
      )}

      <AddSeriesModal series={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
