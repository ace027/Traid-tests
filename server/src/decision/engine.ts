import { and, eq, gte, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { QueueResource } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { parseIndexerSettings, type IndexerRow, type ReleaseInfo } from '../indexers/types.js';
import { parseTitle, type ParsedEpisodeInfo, type QualityModel } from '../parser/index.js';
import { isBlocklisted } from '../services/blocklist.js';
import { getQueue } from '../services/queue.js';
import { RECENT_GRAB_HOURS, SPECIFICATIONS, type ProfileInfo, type SpecInput } from './specifications.js';
import {
  rejection,
  type DownloadDecision,
  type EpisodeRow,
  type Rejection,
  type RemoteEpisode,
  type SearchContext,
  type SeriesRow,
} from './types.js';

export const REJECT_UNPARSEABLE = 'Unable to parse release';
export const REJECT_UNKNOWN_SERIES = 'Unknown Series';
export const REJECT_UNKNOWN_EPISODES = 'Unable to identify correct episode(s) using release name and scene mappings';

/** Same normalisation as the parser's cleanSeriesTitle: lowercase letters/digits, leading "the " dropped. */
export function cleanTitle(title: string): string {
  const lower = title.toLowerCase();
  return (lower.startsWith('the ') ? lower.slice(4) : lower).replace(/[^\p{L}\p{N}]/gu, '');
}

function titleKeys(s: SeriesRow): Set<string> {
  const noYear = s.title.replace(/\s*\(\d{4}\)\s*$/, '');
  const keys = new Set([cleanTitle(s.title), cleanTitle(noYear), s.cleanTitle]);
  if (s.year > 0) keys.add(`${cleanTitle(noYear)}${s.year}`);
  return keys;
}

function titleMatches(s: SeriesRow, parsed: ParsedEpisodeInfo): boolean {
  if (!titleKeys(s).has(parsed.cleanSeriesTitle)) return false;
  return parsed.year === undefined || s.year === 0 || s.year === parsed.year;
}

function idMatches(s: SeriesRow, release: ReleaseInfo): boolean {
  return (!!release.tvdbId && s.tvdbId === release.tvdbId) || (!!release.tvMazeId && s.tvmazeId === release.tvMazeId);
}

/**
 * tvdbId, then tvMazeId, then clean title (with and without year). With search criteria the criteria series
 * wins when it matches. A title matching several series is ambiguous and maps to none.
 */
export function mapSeries(
  release: ReleaseInfo,
  parsed: ParsedEpisodeInfo,
  allSeries: readonly SeriesRow[],
  ctx: Pick<SearchContext, 'searchCriteria'>,
): SeriesRow | undefined {
  const c = ctx.searchCriteria?.series;
  if (c && (idMatches(c, release) || titleMatches(c, parsed))) return c;
  if (release.tvdbId) {
    const s = allSeries.find((x) => x.tvdbId === release.tvdbId);
    if (s) return s;
  }
  if (release.tvMazeId) {
    const s = allSeries.find((x) => x.tvmazeId === release.tvMazeId);
    if (s) return s;
  }
  const byTitle = allSeries.filter((s) => titleMatches(s, parsed));
  return byTitle.length === 1 ? byTitle[0] : undefined;
}

/** Daily by air date, anime by absolute number (then season/episode), full season, then season/episode. */
export function mapEpisodes(parsed: ParsedEpisodeInfo, episodes: readonly EpisodeRow[]): EpisodeRow[] {
  let found: EpisodeRow[] = [];
  if (parsed.isDaily && parsed.airDate) {
    found = episodes.filter((e) => e.airDate === parsed.airDate);
  } else if (parsed.absoluteEpisodeNumbers.length > 0) {
    const abs = new Set(parsed.absoluteEpisodeNumbers);
    found = episodes.filter((e) => e.absoluteEpisodeNumber !== null && abs.has(e.absoluteEpisodeNumber));
    if (found.length === 0 && parsed.episodeNumbers.length > 0) found = bySeasonEpisode(parsed, episodes);
  } else if (parsed.fullSeason) {
    found = parsed.seasonNumber === 0 ? [] : episodes.filter((e) => e.seasonNumber === parsed.seasonNumber);
  } else {
    found = bySeasonEpisode(parsed, episodes);
  }
  return [...found].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
}

function bySeasonEpisode(parsed: ParsedEpisodeInfo, episodes: readonly EpisodeRow[]): EpisodeRow[] {
  const wanted = new Set(parsed.episodeNumbers);
  return episodes.filter((e) => e.seasonNumber === parsed.seasonNumber && wanted.has(e.episodeNumber));
}

function decision(remoteEpisode: RemoteEpisode, rejections: Rejection[]): DownloadDecision {
  return {
    remoteEpisode,
    rejections,
    approved: rejections.length === 0,
    temporarilyRejected: rejections.length > 0 && rejections.every((r) => r.type === 'temporary'),
  };
}

/** Per-call cache of the rows the specifications need. */
class DecisionData {
  private allSeries?: SeriesRow[];
  private readonly episodes = new Map<number, EpisodeRow[]>();
  private readonly profiles = new Map<number, ProfileInfo>();
  private defs?: Map<number, { minSize: number; maxSize: number | null }>;
  private indexers?: Map<number, IndexerRow>;
  private queueItems?: QueueResource[];
  private recent?: { episodeId: number | null; quality: QualityModel }[];

  constructor(
    private readonly app: FastifyInstance,
    private readonly now: Date,
  ) {}

  series(): SeriesRow[] {
    return (this.allSeries ??= this.app.db.select().from(schema.series).all());
  }

  episodesOf(seriesId: number): EpisodeRow[] {
    let eps = this.episodes.get(seriesId);
    if (!eps) {
      eps = this.app.db.select().from(schema.episodes).where(eq(schema.episodes.seriesId, seriesId)).all();
      this.episodes.set(seriesId, eps);
    }
    return eps;
  }

  profile(id: number): ProfileInfo {
    let p = this.profiles.get(id);
    if (!p) {
      const row = this.app.db.select().from(schema.qualityProfiles).where(eq(schema.qualityProfiles.id, id)).get();
      const items = row ? (JSON.parse(row.items) as { quality: number; allowed: boolean }[]) : [];
      p = {
        upgradeAllowed: row?.upgradeAllowed ?? false,
        cutoff: row?.cutoff ?? 0,
        allowed: new Set(items.filter((i) => i.allowed).map((i) => i.quality)),
      };
      this.profiles.set(id, p);
    }
    return p;
  }

  sizeLimits(qualityId: number): { minSize: number; maxSize: number | null } | undefined {
    this.defs ??= new Map(
      this.app.db
        .select()
        .from(schema.qualityDefinitions)
        .all()
        .map((d) => [d.quality, { minSize: d.minSize, maxSize: d.maxSize }]),
    );
    return this.defs.get(qualityId);
  }

  indexer(id: number): IndexerRow | undefined {
    this.indexers ??= new Map(this.app.db.select().from(schema.indexers).all().map((r) => [r.id, r]));
    return this.indexers.get(id);
  }

  fileQualities(episodes: EpisodeRow[]): QualityModel[] {
    const ids = [...new Set(episodes.flatMap((e) => (e.episodeFileId === null ? [] : [e.episodeFileId])))];
    if (ids.length === 0) return [];
    return this.app.db
      .select({ quality: schema.episodeFiles.quality })
      .from(schema.episodeFiles)
      .where(inArray(schema.episodeFiles.id, ids))
      .all()
      .map((f) => JSON.parse(f.quality) as QualityModel);
  }

  async loadQueue(): Promise<void> {
    this.queueItems ??= await getQueue(this.app).details({});
  }

  queued(seriesId: number, episodes: EpisodeRow[]): QualityModel[] {
    const ids = new Set(episodes.map((e) => e.id));
    return (this.queueItems ?? [])
      .filter((q) => q.seriesId === seriesId && q.episodeIds.some((id) => ids.has(id)))
      .map((q) => q.quality);
  }

  recentGrabs(episodes: EpisodeRow[]): QualityModel[] {
    if (!this.recent) {
      const since = new Date(this.now.getTime() - RECENT_GRAB_HOURS * 3600_000).toISOString();
      this.recent = this.app.db
        .select({ episodeId: schema.history.episodeId, quality: schema.history.quality })
        .from(schema.history)
        .where(and(eq(schema.history.eventType, 'grabbed'), gte(schema.history.date, since)))
        .all()
        .map((r) => ({ episodeId: r.episodeId, quality: JSON.parse(r.quality) as QualityModel }));
    }
    const ids = new Set(episodes.map((e) => e.id));
    return this.recent.filter((r) => r.episodeId !== null && ids.has(r.episodeId)).map((r) => r.quality);
  }
}

function evaluate(data: DecisionData, app: FastifyInstance, release: ReleaseInfo, ctx: SearchContext): DownloadDecision {
  const parsed = parseTitle(release.title);
  if (!parsed) return decision({ release, parsed: null, episodes: [] }, [rejection(REJECT_UNPARSEABLE)]);

  const series = mapSeries(release, parsed, data.series(), ctx);
  if (!series) return decision({ release, parsed, episodes: [] }, [rejection(REJECT_UNKNOWN_SERIES)]);

  const episodes = mapEpisodes(parsed, data.episodesOf(series.id));
  const remote = { release, parsed, series, episodes };
  if (episodes.length === 0) return decision(remote, [rejection(REJECT_UNKNOWN_EPISODES)]);

  const quality = parsed.quality;
  const indexer = release.protocol === 'torrent' ? data.indexer(release.indexerId) : undefined;
  const input: SpecInput = {
    remote,
    quality,
    ctx,
    profile: data.profile(series.qualityProfileId),
    sizeLimits: data.sizeLimits(quality.quality.id),
    existingFiles: data.fileQualities(episodes),
    seasonEpisodes: parsed.fullSeason ? episodes : [],
    queued: data.queued(series.id, episodes),
    recentGrabs: ctx.searchCriteria ? [] : data.recentGrabs(episodes),
    blocklisted: isBlocklisted(app.db, series.id, {
      title: release.title,
      torrentInfoHash: release.infoHash ?? null,
      indexer: release.indexer,
    }),
  };
  if (indexer) input.minimumSeeders = parseIndexerSettings(indexer).minimumSeeders;

  const rejections: Rejection[] = [];
  for (const spec of SPECIFICATIONS) {
    const r = spec(input);
    if (r) rejections.push(r);
  }
  return decision(remote, rejections);
}

/**
 * Parses each release, maps it to a series and episodes and runs every specification. Decisions are
 * returned in input order; use sortDecisions for priority order.
 */
export async function makeDecisions(
  app: FastifyInstance,
  releases: readonly ReleaseInfo[],
  ctx: SearchContext,
): Promise<DownloadDecision[]> {
  if (releases.length === 0) return [];
  const data = new DecisionData(app, ctx.now);
  await data.loadQueue();
  return releases.map((release) => {
    try {
      return evaluate(data, app, release, ctx);
    } catch (err) {
      app.log.warn({ err, title: release.title }, 'Unable to evaluate release');
      return decision({ release, parsed: null, episodes: [] }, [rejection(REJECT_UNPARSEABLE)]);
    }
  });
}
