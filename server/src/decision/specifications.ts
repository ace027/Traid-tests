import { QUALITIES, type TrackedDownloadState } from '@sonarr/shared';
import type { QualityModel } from '../parser/index.js';
import { compareQuality, isRevisionUpgrade, qualityWeight } from './prioritize.js';
import { rejection, type EpisodeRow, type Rejection, type RemoteEpisode, type SearchContext, type SeriesRow } from './types.js';

export interface ProfileInfo {
  upgradeAllowed: boolean;
  /** Quality id. */
  cutoff: number;
  allowed: ReadonlySet<number>;
}

/** Everything a specification looks at, loaded by the engine so the specifications stay pure. */
export interface SpecInput {
  remote: RemoteEpisode & { series: SeriesRow };
  quality: QualityModel;
  ctx: SearchContext;
  profile: ProfileInfo;
  /** MB per minute for the release quality; undefined when no definition exists. */
  sizeLimits?: { minSize: number; maxSize: number | null };
  /** Qualities of the files already on disk for the release's episodes. */
  existingFiles: QualityModel[];
  /** Non-special episodes of the release's season (full season packs only). */
  seasonEpisodes: EpisodeRow[];
  /** Qualities of queue items that share an episode with the release, with the item state when known. */
  queued: QueuedQuality[];
  /** Qualities grabbed within RECENT_GRAB_HOURS for the release's episodes. */
  recentGrabs: QualityModel[];
  blocklisted: boolean;
  /** From the indexer settings; undefined for usenet or unknown indexers. */
  minimumSeeders?: number;
}

export type QueuedQuality = QualityModel & { trackedDownloadState?: TrackedDownloadState };

export type Specification = (input: SpecInput) => Rejection | null;

/** Queue items in these states no longer block a release: they failed or are already imported. */
export const INACTIVE_QUEUE_STATES: ReadonlySet<TrackedDownloadState> = new Set(['failed', 'failedPending', 'imported']);

export const RECENT_GRAB_HOURS = 12;
const MB = 1024 * 1024;

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function isAired(ep: EpisodeRow, now: Date): boolean {
  if (ep.airDateUtc) return Date.parse(ep.airDateUtc) <= now.getTime();
  if (ep.airDate) return ep.airDate <= now.toISOString().slice(0, 10);
  return false;
}

const qualityName = (id: number) => QUALITIES.find((q) => q.id === id)?.name ?? 'Unknown';

/** Interactive searches of explicitly requested episodes skip the monitored checks. */
const explicitlyRequested = (ctx: SearchContext) => ctx.interactive && ctx.searchCriteria !== undefined;

export const notRequested: Specification = ({ remote, ctx }) => {
  const c = ctx.searchCriteria;
  if (!c) return null;
  if (remote.series.id !== c.series.id) return rejection("Episode wasn't requested");
  if (c.seasonNumber !== undefined) {
    return remote.episodes.every((e) => e.seasonNumber === c.seasonNumber) ? null : rejection("Episode wasn't requested");
  }
  const ids = new Set(c.episodes.map((e) => e.id));
  return remote.episodes.some((e) => ids.has(e.id)) ? null : rejection("Episode wasn't requested");
};

export const qualityAllowed: Specification = ({ quality, profile }) =>
  profile.allowed.has(quality.quality.id) ? null : rejection(`Quality ${quality.quality.name} is not wanted in profile`);

export const seriesMonitored: Specification = ({ remote, ctx }) =>
  explicitlyRequested(ctx) || remote.series.monitored ? null : rejection('Series is not monitored');

export const episodeMonitored: Specification = ({ remote, ctx }) => {
  // Full season packs are covered by fullSeasonPack.
  if (explicitlyRequested(ctx) || remote.parsed?.fullSeason) return null;
  const eps = remote.episodes;
  const monitored = eps.filter((e) => e.monitored).length;
  if (monitored === eps.length) return null;
  if (eps.length === 1) return rejection('Episode is not monitored');
  if (monitored === 0) return rejection('No episodes in the release are monitored');
  return rejection('One or more episodes is not monitored');
};

export const fullSeasonPack: Specification = ({ remote, ctx, seasonEpisodes }) => {
  if (!remote.parsed?.fullSeason) return null;
  const checkMonitored = !explicitlyRequested(ctx);
  const ok = seasonEpisodes.every((e) => isAired(e, ctx.now) && (!checkMonitored || e.monitored));
  return ok ? null : rejection('Full season pack: not all episodes are monitored/aired');
};

export const size: Specification = ({ remote, sizeLimits }) => {
  const bytes = remote.release.size;
  if (!sizeLimits || !(bytes > 0) || remote.episodes.length === 0) return null;
  const fallback = remote.series.runtime > 0 ? remote.series.runtime : remote.series.seriesType === 'anime' ? 30 : 45;
  const minutes = remote.parsed?.fullSeason
    ? remote.episodes.reduce((sum, e) => sum + (e.runtime > 0 ? e.runtime : fallback), 0)
    : fallback * remote.episodes.length;
  const min = sizeLimits.minSize * minutes * MB;
  if (bytes < min) return rejection(`${formatSize(bytes)} is smaller than minimum allowed ${formatSize(min)}`);
  if (sizeLimits.maxSize !== null && sizeLimits.maxSize > 0) {
    const max = sizeLimits.maxSize * minutes * MB;
    if (bytes > max) return rejection(`${formatSize(bytes)} is larger than maximum allowed ${formatSize(max)}`);
  }
  return null;
};

const meetsCutoff = (q: QualityModel, profile: ProfileInfo) => qualityWeight(q.quality.id) >= qualityWeight(profile.cutoff);

export const upgradeDisk: Specification = ({ quality, profile, existingFiles }) => {
  for (const existing of existingFiles) {
    const name = qualityName(existing.quality.id);
    if (meetsCutoff(existing, profile) && !isRevisionUpgrade(quality, existing)) {
      return rejection(`Existing file meets cutoff: ${name}`);
    }
    if (compareQuality(quality, existing) <= 0) {
      return rejection(`Existing file on disk is of equal or higher preference: ${name}`);
    }
    if (!profile.upgradeAllowed && !isRevisionUpgrade(quality, existing)) {
      return rejection('Existing file and the Quality profile does not allow upgrades');
    }
  }
  return null;
};

export const queue: Specification = ({ quality, profile, queued }) => {
  for (const q of queued) {
    if (q.trackedDownloadState && INACTIVE_QUEUE_STATES.has(q.trackedDownloadState)) continue;
    const name = qualityName(q.quality.id);
    if (meetsCutoff(q, profile) && !isRevisionUpgrade(quality, q)) {
      return rejection(`Release in queue already meets cutoff: ${name}`, 'temporary');
    }
    if (compareQuality(quality, q) <= 0) {
      return rejection(`Release in queue is of equal or higher preference: ${name}`, 'temporary');
    }
  }
  return null;
};

export const blocklisted: Specification = ({ blocklisted }) => (blocklisted ? rejection('Release is blocklisted') : null);

export const minimumSeeders: Specification = ({ remote, minimumSeeders }) => {
  const { protocol, seeders } = remote.release;
  if (protocol !== 'torrent' || minimumSeeders === undefined || seeders === undefined) return null;
  return seeders < minimumSeeders ? rejection(`Not enough seeders: ${seeders}. Minimum seeders: ${minimumSeeders}`) : null;
};

/** RSS only: a release for episodes grabbed recently at equal or better quality waits for the queue. */
export const recentlyGrabbed: Specification = ({ ctx, quality, recentGrabs }) => {
  if (ctx.searchCriteria) return null;
  return recentGrabs.some((g) => compareQuality(quality, g) <= 0) ? rejection('Has been grabbed recently', 'temporary') : null;
};

/** Run in this order; every rejection is collected. */
export const SPECIFICATIONS: readonly Specification[] = [
  notRequested,
  qualityAllowed,
  seriesMonitored,
  episodeMonitored,
  fullSeasonPack,
  size,
  upgradeDisk,
  queue,
  blocklisted,
  minimumSeeders,
  recentlyGrabbed,
];
