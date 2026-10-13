import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Episode, EpisodeFile, Season } from '@sonarr/shared';
import { Badge, Button, Switch, TBody, THead, Table, Td, Th, Tr, type BadgeVariant } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatBytes, seasonName, useMonitorEpisode, useMonitorEpisodes } from './hooks';

export type EpisodeStatus = 'downloaded' | 'missing' | 'unaired' | 'unmonitored';

export function episodeStatus(ep: Episode, now = Date.now()): EpisodeStatus {
  if (ep.hasFile) return 'downloaded';
  if (!ep.monitored) return 'unmonitored';
  const airs = ep.airDateUtc ?? ep.airDate;
  if (!airs || new Date(airs).getTime() > now) return 'unaired';
  return 'missing';
}

const statusBadge: Record<EpisodeStatus, { label: string; variant: BadgeVariant }> = {
  downloaded: { label: 'Downloaded', variant: 'success' },
  missing: { label: 'Missing', variant: 'danger' },
  unaired: { label: 'Unaired', variant: 'info' },
  unmonitored: { label: 'Unmonitored', variant: 'neutral' },
};

const DAY = 86_400_000;

/** 'Today', 'Tomorrow', 'in 3 days', '2 days ago' within a week; a short date otherwise. */
export function formatAirDate(ep: Pick<Episode, 'airDate' | 'airDateUtc'>, relative: boolean, now = new Date()): string {
  const iso = ep.airDateUtc ?? ep.airDate;
  if (!iso) return 'TBA';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'TBA';
  if (relative) {
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(date) - startOf(now)) / DAY);
    if (Math.abs(days) <= 7) {
      if (days === 0) return 'Today';
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(days, 'day');
    }
  }
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const episodeCode = (ep: Pick<Episode, 'seasonNumber' | 'episodeNumber'>) =>
  `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;

export interface SeasonSectionProps {
  season: Season;
  episodes: Episode[];
  files: Map<number, EpisodeFile>;
  showRelativeDates: boolean;
  defaultOpen?: boolean;
  onToggleMonitored: (seasonNumber: number, monitored: boolean) => void;
  seasonToggleDisabled?: boolean;
}

/** Collapsible season: monitored switch, progress and size in the header; episode table in the body. */
export function SeasonSection({
  season,
  episodes,
  files,
  showRelativeDates,
  defaultOpen = false,
  onToggleMonitored,
  seasonToggleDisabled,
}: SeasonSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const monitorOne = useMonitorEpisode();
  const monitorMany = useMonitorEpisodes();
  const name = seasonName(season.seasonNumber);

  const fileCount = season.statistics?.episodeFileCount ?? episodes.filter((e) => e.hasFile).length;
  const epCount = season.statistics?.episodeCount ?? episodes.length;
  const size = season.statistics?.sizeOnDisk ?? 0;
  const complete = epCount > 0 && fileCount >= epCount;
  const sorted = [...episodes].sort((a, b) => b.episodeNumber - a.episodeNumber);

  return (
    <section
      aria-label={name}
      className={cn(
        'overflow-hidden rounded-lg border bg-surface-raised shadow-sm',
        season.monitored ? 'border-border' : 'border-border opacity-90',
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
        <Switch
          checked={season.monitored}
          onCheckedChange={(v) => onToggleMonitored(season.seasonNumber, v)}
          disabled={seasonToggleDisabled}
          aria-label={`Monitor ${name}`}
        />
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
            className="focus-ring flex w-full items-center gap-3 rounded-md py-1.5 text-left"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn('size-4 shrink-0 text-text-muted transition-transform', open && 'rotate-90')}
            />
            <span className="text-base font-semibold text-text">{name}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                complete ? 'bg-success-soft text-success' : fileCount > 0 ? 'bg-accent-soft text-accent' : 'bg-surface-hover text-text-muted',
              )}
            >
              {fileCount}/{epCount}
            </span>
            <span className="ml-auto hidden text-sm text-text-muted sm:inline">{size > 0 ? formatBytes(size) : ''}</span>
          </button>
        </h3>
      </div>
      <div id={bodyId} hidden={!open} className="border-t border-border">
        {open && (
          <>
            {episodes.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-muted">No episodes in this season.</p>
            ) : (
              <Table caption={`${name} episodes`} captionHidden>
                <THead>
                  <tr>
                    <Th className="w-12">
                      <span className="sr-only">Monitored</span>
                    </Th>
                    <Th className="w-14">#</Th>
                    <Th>Title</Th>
                    <Th>Air Date</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <TBody>
                  {sorted.map((ep) => {
                    const status = episodeStatus(ep);
                    const badge = statusBadge[status];
                    const file = ep.episodeFileId ? files.get(ep.episodeFileId) : undefined;
                    return (
                      <Tr key={ep.id} data-testid={`episode-${ep.id}`}>
                        <Td>
                          <Switch
                            checked={ep.monitored}
                            onCheckedChange={(monitored) => monitorOne.mutate({ id: ep.id, monitored })}
                            aria-label={`Monitor ${episodeCode(ep)} ${ep.title}`}
                            className="scale-90"
                          />
                        </Td>
                        <Td className="text-text-muted tabular-nums">{ep.episodeNumber}</Td>
                        <Td className="font-medium">{ep.title || 'TBA'}</Td>
                        <Td className="whitespace-nowrap text-text-muted">{formatAirDate(ep, showRelativeDates)}</Td>
                        <Td>
                          <Badge variant={badge.variant}>
                            {badge.label}
                            {status === 'downloaded' && file ? ` (${file.quality.quality.name})` : ''}
                          </Badge>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
            {episodes.length > 0 && (
              <div className="flex justify-end gap-2 border-t border-border bg-surface px-4 py-2">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={monitorMany.isPending && monitorMany.variables?.monitored === true}
                  onClick={() => monitorMany.mutate({ episodeIds: episodes.map((e) => e.id), monitored: true })}
                >
                  Monitor all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={monitorMany.isPending && monitorMany.variables?.monitored === false}
                  onClick={() => monitorMany.mutate({ episodeIds: episodes.map((e) => e.id), monitored: false })}
                >
                  Unmonitor all
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
