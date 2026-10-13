import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import type { Series, SeriesImage } from '@sonarr/shared';
import { cn } from '../../lib/cn';
import { initials, posterUrl, statusLabels } from './hooks';

/**
 * 2/3 poster box: lazy, async-decoded image with an initials tile when the series
 * has no poster or the image fails to load. Decorative (alt="") since the title is
 * always rendered next to it.
 */
export function PosterImage({
  series,
  className,
}: {
  series: { title: string; images: SeriesImage[]; remotePoster?: string };
  className?: string;
}) {
  const url = posterUrl(series);
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        'relative aspect-[2/3] w-full overflow-hidden rounded-md bg-gradient-to-br from-accent-soft to-surface-sunken',
        className,
      )}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          data-testid="poster-fallback"
          className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tracking-wide text-accent"
        >
          {initials(series.title)}
        </div>
      )}
    </div>
  );
}

export type ProgressTone = 'success' | 'accent' | 'danger' | 'neutral';

/** success when complete, accent when continuing, danger when ended with missing episodes. */
export function progressTone(s: Pick<Series, 'status' | 'monitored' | 'statistics'>): ProgressTone {
  const files = s.statistics?.episodeFileCount ?? 0;
  const total = s.statistics?.episodeCount ?? 0;
  if (total > 0 && files >= total) return 'success';
  if (s.status === 'continuing' || s.status === 'upcoming') return 'accent';
  if (!s.monitored) return 'neutral';
  return files < total ? 'danger' : 'neutral';
}

const toneClass: Record<ProgressTone, string> = {
  success: 'bg-success',
  accent: 'bg-accent',
  danger: 'bg-danger',
  neutral: 'bg-text-subtle',
};

export function EpisodeProgress({
  series,
  className,
  showLabel = true,
}: {
  series: Pick<Series, 'status' | 'monitored' | 'statistics'>;
  className?: string;
  showLabel?: boolean;
}) {
  const files = series.statistics?.episodeFileCount ?? 0;
  const total = series.statistics?.episodeCount ?? 0;
  const pct = total > 0 ? Math.min(100, (files / total) * 100) : 0;
  const tone = progressTone(series);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label="Episodes downloaded"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={files}
        aria-valuetext={`${files} of ${total} episodes`}
        data-tone={tone}
        className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div className={cn('h-full rounded-full transition-[width]', toneClass[tone])} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <span className="shrink-0 text-xs text-text-muted tabular-nums">
          {files}/{total}
        </span>
      )}
    </div>
  );
}

/** Poster grid card; the whole card links to the series page. */
export function SeriesPoster({ series }: { series: Series }) {
  return (
    <li className="group">
      <Link
        to={`/series/${series.titleSlug}`}
        className="focus-ring block rounded-lg border border-border bg-surface-raised p-1.5 shadow-sm transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="relative">
          <PosterImage series={series} />
          <span
            className={cn(
              'absolute top-0 right-2 drop-shadow',
              series.monitored ? 'text-accent' : 'text-text-subtle',
            )}
            title={series.monitored ? 'Monitored' : 'Unmonitored'}
          >
            <Bookmark aria-hidden="true" className={cn('size-5', series.monitored && 'fill-current')} />
            <span className="sr-only">{series.monitored ? 'Monitored' : 'Unmonitored'}</span>
          </span>
          <div
            aria-hidden="true"
            className={cn(
              'absolute inset-0 flex flex-col justify-end gap-1.5 rounded-md bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5',
              'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          >
            <p className="line-clamp-2 text-sm leading-tight font-semibold text-white">{series.title}</p>
            <div className="flex flex-wrap gap-1">
              {series.network && (
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] text-white">{series.network}</span>
              )}
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] text-white">
                {statusLabels[series.status]}
              </span>
            </div>
          </div>
        </div>
        <div className="px-0.5 pt-2 pb-0.5">
          <p className="truncate text-sm font-medium text-text">{series.title}</p>
          <EpisodeProgress series={series} className="mt-1" />
        </div>
      </Link>
    </li>
  );
}
