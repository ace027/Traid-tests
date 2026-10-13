import { QUALITIES } from '@sonarr/shared';
import type { QualityModel } from '../parser/index.js';
import type { DownloadDecision } from './types.js';

const WEIGHTS = new Map<number, number>(QUALITIES.map((q, i) => [q.id, i + 1]));

/** Quality weight: position in QUALITIES (lowest first) plus one; unknown ids weigh 0. */
export function qualityWeight(qualityId: number): number {
  return WEIGHTS.get(qualityId) ?? 0;
}

/** > 0 when `a` is preferred over `b`: quality weight, then revision version, then REAL count. */
export function compareQuality(a: QualityModel, b: QualityModel): number {
  return (
    qualityWeight(a.quality.id) - qualityWeight(b.quality.id) ||
    a.revision.version - b.revision.version ||
    a.revision.real - b.revision.real
  );
}

/** True when `a` is the same quality as `b` with a newer revision (PROPER/REPACK/REAL). */
export function isRevisionUpgrade(a: QualityModel, b: QualityModel): boolean {
  return (
    a.quality.id === b.quality.id &&
    (a.revision.version > b.revision.version || (a.revision.version === b.revision.version && a.revision.real > b.revision.real))
  );
}

function compareDecisions(a: DownloadDecision, b: DownloadDecision): number {
  if (a.approved !== b.approved) return a.approved ? -1 : 1;
  const ra = a.remoteEpisode.release;
  const rb = b.remoteEpisode.release;
  const qa = a.remoteEpisode.parsed?.quality;
  const qb = b.remoteEpisode.parsed?.quality;
  const weight = qualityWeight(qb?.quality.id ?? -1) - qualityWeight(qa?.quality.id ?? -1);
  if (weight) return weight;
  const revision = (qb?.revision.version ?? 0) - (qa?.revision.version ?? 0) || (qb?.revision.real ?? 0) - (qa?.revision.real ?? 0);
  if (revision) return revision;
  if (ra.indexerPriority !== rb.indexerPriority) return ra.indexerPriority - rb.indexerPriority;
  if (ra.protocol !== rb.protocol) return ra.protocol === 'usenet' ? -1 : 1;
  if (ra.protocol === 'torrent') {
    const seeders = (rb.seeders ?? 0) - (ra.seeders ?? 0);
    if (seeders) return seeders;
  }
  return (Date.parse(rb.publishDate) || 0) - (Date.parse(ra.publishDate) || 0);
}

/**
 * Orders decisions best first: approved first, quality weight desc, revision desc, indexer priority asc,
 * usenet before torrent, seeders desc (torrents), newest publish date first. Stable; returns a new array.
 */
export function sortDecisions(decisions: readonly DownloadDecision[]): DownloadDecision[] {
  return [...decisions].sort(compareDecisions);
}
