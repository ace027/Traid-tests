import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema } from '../db/index.js';
import { makeDecisions } from '../decision/engine.js';
import { qualityWeight, sortDecisions } from '../decision/prioritize.js';
import { isAired } from '../decision/specifications.js';
import type { DownloadDecision, EpisodeRow, SearchCriteria, SeriesRow } from '../decision/types.js';
import { getIndexerClients, recordFailure, recordSuccess, type IndexerPurpose } from '../indexers/registry.js';
import type { IndexerClient, IndexerRow, ReleaseInfo, SearchCriteria as IndexerCriteria, SearchSeries } from '../indexers/types.js';
import type { QualityModel } from '../parser/index.js';
import { grabRelease } from './grab.js';

export const SEARCH_BATCH_SIZE = 50;

export function toSearchSeries(series: SeriesRow): SearchSeries {
  return {
    title: series.title,
    tvdbId: series.tvdbId,
    tvMazeId: series.tvmazeId,
    imdbId: series.imdbId,
    cleanTitle: series.cleanTitle,
  };
}

/**
 * Indexer queries for episodes of one series: daily series search per air date, anime by absolute number
 * (one query listing every number), everything else per season/episode.
 */
export function buildCriteria(series: SeriesRow, episodes: readonly EpisodeRow[]): IndexerCriteria[] {
  const s = toSearchSeries(series);
  const out: IndexerCriteria[] = [];
  const absolute: number[] = [];
  for (const e of episodes) {
    if (series.seriesType === 'daily' && e.airDate) {
      out.push({ type: 'daily', series: s, airDate: e.airDate });
    } else if (series.seriesType === 'anime' && e.absoluteEpisodeNumber !== null) {
      absolute.push(e.absoluteEpisodeNumber);
    } else {
      out.push({ type: 'episode', series: s, seasonNumber: e.seasonNumber, episodeNumbers: [e.episodeNumber] });
    }
  }
  if (absolute.length > 0) out.push({ type: 'anime', series: s, absoluteEpisodeNumbers: absolute });
  return out;
}

export function seasonCriteria(series: SeriesRow, seasonNumber: number): IndexerCriteria {
  return { type: 'season', series: toSearchSeries(series), seasonNumber };
}

export const releaseKey = (r: Pick<ReleaseInfo, 'indexerId' | 'guid'>) => `${r.indexerId}:${r.guid}`;

/** Keeps the first release per (indexer, guid); the same guid from two indexers stays twice. */
export function dedupeReleases(releases: readonly ReleaseInfo[]): ReleaseInfo[] {
  const seen = new Set<string>();
  return releases.filter((r) => {
    const key = releaseKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Runs `query` against every enabled indexer for the purpose in parallel. Failures back the indexer off and
 * are logged; the other indexers' releases are still returned.
 */
export async function queryIndexers(
  app: FastifyInstance,
  purpose: IndexerPurpose,
  query: (client: IndexerClient) => Promise<ReleaseInfo[]>,
): Promise<{ releases: ReleaseInfo[]; failed: number; indexers: number }> {
  const clients = getIndexerClients(app, { purpose });
  const results = await Promise.allSettled(clients.map(({ client }) => query(client)));
  const releases: ReleaseInfo[] = [];
  let failed = 0;
  results.forEach((result, i) => {
    const row: IndexerRow = clients[i]!.row;
    if (result.status === 'fulfilled') {
      recordSuccess(row.id);
      for (const r of result.value) releases.push({ ...r, indexerId: row.id, indexer: row.name, indexerPriority: row.priority });
    } else {
      failed++;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      recordFailure(row.id, message);
      app.log.warn(`Indexer ${row.name} failed: ${message}`);
    }
  });
  return { releases: dedupeReleases(releases), failed, indexers: clients.length };
}

export async function searchIndexers(
  app: FastifyInstance,
  criteria: readonly IndexerCriteria[],
  purpose: IndexerPurpose,
): Promise<ReleaseInfo[]> {
  if (criteria.length === 0) return [];
  const { releases } = await queryIndexers(app, purpose, async (client) => {
    const out: ReleaseInfo[] = [];
    let firstError: unknown;
    let failures = 0;
    for (const c of criteria) {
      try {
        out.push(...(await client.search(c)));
      } catch (err) {
        failures++;
        firstError ??= err;
      }
    }
    if (failures === criteria.length) throw firstError;
    return out;
  });
  return releases;
}

const purposeOf = (interactive: boolean): IndexerPurpose => (interactive ? 'interactive' : 'automatic');

function episodesOfSeries(app: FastifyInstance, seriesId: number): EpisodeRow[] {
  return app.db.select().from(schema.episodes).where(eq(schema.episodes.seriesId, seriesId)).all();
}

function findSeries(app: FastifyInstance, id: number): SeriesRow | undefined {
  return app.db.select().from(schema.series).where(eq(schema.series.id, id)).get();
}

/** Searches the given episodes (any series) and returns decisions in priority order. */
export async function searchEpisodes(
  app: FastifyInstance,
  episodeIds: readonly number[],
  opts: { interactive: boolean },
): Promise<DownloadDecision[]> {
  if (episodeIds.length === 0) return [];
  const episodes = app.db.select().from(schema.episodes).where(inArray(schema.episodes.id, [...episodeIds])).all();
  const bySeries = new Map<number, EpisodeRow[]>();
  for (const e of episodes) bySeries.set(e.seriesId, [...(bySeries.get(e.seriesId) ?? []), e]);
  const decisions: DownloadDecision[] = [];
  for (const [seriesId, eps] of bySeries) {
    const series = findSeries(app, seriesId);
    if (!series) continue;
    const releases = await searchIndexers(app, buildCriteria(series, eps), purposeOf(opts.interactive));
    const searchCriteria: SearchCriteria = { series, episodes: eps };
    decisions.push(...(await makeDecisions(app, releases, { searchCriteria, interactive: opts.interactive, now: new Date() })));
  }
  return sortDecisions(decisions);
}

/** Season-pack query for one season; decisions accept any episode of the season. */
export async function searchSeason(
  app: FastifyInstance,
  series: SeriesRow,
  seasonNumber: number,
  opts: { interactive: boolean },
): Promise<DownloadDecision[]> {
  const episodes = episodesOfSeries(app, series.id).filter((e) => e.seasonNumber === seasonNumber);
  const releases = await searchIndexers(app, [seasonCriteria(series, seasonNumber)], purposeOf(opts.interactive));
  const searchCriteria: SearchCriteria = { series, episodes, seasonNumber };
  return sortDecisions(await makeDecisions(app, releases, { searchCriteria, interactive: opts.interactive, now: new Date() }));
}

export interface ProcessResult {
  grabbed: number;
  rejected: number;
}

/**
 * Grabs approved decisions best first, skipping any whose episodes were already grabbed in this run.
 * When nothing could be grabbed because every grab failed, the first grab error is thrown.
 */
export async function processDecisions(app: FastifyInstance, decisions: readonly DownloadDecision[]): Promise<ProcessResult> {
  const taken = new Set<number>();
  const errors: Error[] = [];
  let grabbed = 0;
  for (const d of sortDecisions(decisions)) {
    if (!d.approved) continue;
    const ids = d.remoteEpisode.episodes.map((e) => e.id);
    if (ids.some((id) => taken.has(id))) continue;
    try {
      await grabRelease(app, d, { interactive: false });
      grabbed++;
      for (const id of ids) taken.add(id);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      app.log.warn(`Unable to grab ${d.remoteEpisode.release.title}: ${e.message}`);
      errors.push(e);
    }
  }
  if (grabbed === 0 && errors.length > 0) throw errors[0]!;
  return { grabbed, rejected: decisions.filter((d) => !d.approved).length };
}

interface Totals {
  found: number;
  grabbed: number;
  failed?: number;
}

const add = (a: Totals, b: Totals): Totals => {
  const out: Totals = { found: a.found + b.found, grabbed: a.grabbed + b.grabbed };
  const failed = (a.failed ?? 0) + (b.failed ?? 0);
  if (failed > 0) out.failed = failed;
  return out;
};
const message = (t: Totals) => `Found ${t.found} releases, grabbed ${t.grabbed}` + (t.failed ? `, ${t.failed} search batches failed` : '');

async function runEpisodes(app: FastifyInstance, episodeIds: readonly number[]): Promise<Totals> {
  let totals: Totals = { found: 0, grabbed: 0 };
  let batches = 0;
  let firstError: unknown;
  for (let i = 0; i < episodeIds.length; i += SEARCH_BATCH_SIZE) {
    batches++;
    try {
      const decisions = await searchEpisodes(app, episodeIds.slice(i, i + SEARCH_BATCH_SIZE), { interactive: false });
      const { grabbed } = await processDecisions(app, decisions);
      totals = add(totals, { found: decisions.length, grabbed });
    } catch (err) {
      firstError ??= err;
      totals = add(totals, { found: 0, grabbed: 0, failed: 1 });
      app.log.warn(`Search batch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (batches > 0 && totals.failed === batches) throw firstError;
  return totals;
}

/** Season pack first; when no pack is grabbed, the missing monitored aired episodes one by one. */
async function runSeason(app: FastifyInstance, series: SeriesRow, seasonNumber: number): Promise<Totals> {
  const decisions = await searchSeason(app, series, seasonNumber, { interactive: false });
  const packs = decisions.filter((d) => d.approved && d.remoteEpisode.parsed?.fullSeason);
  let packResult = { grabbed: 0 };
  if (packs.length > 0) {
    try {
      packResult = await processDecisions(app, packs);
    } catch (err) {
      app.log.warn(`Season pack grab failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const totals: Totals = { found: decisions.length, grabbed: packResult.grabbed };
  if (packResult.grabbed > 0) return totals;
  const now = new Date();
  const missing = episodesOfSeries(app, series.id)
    .filter((e) => e.seasonNumber === seasonNumber && e.monitored && e.episodeFileId === null && isAired(e, now))
    .map((e) => e.id);
  return add(totals, await runEpisodes(app, missing));
}

const intArray = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((x) => Number.isInteger(x)) ? (v as number[]) : null;

function requireSeries(app: FastifyInstance, body: Record<string, unknown>): SeriesRow {
  const id = body.seriesId;
  if (!Number.isInteger(id)) throw new Error('seriesId is required');
  const series = findSeries(app, id as number);
  if (!series) throw new Error(`Series ${String(id)} not found`);
  return series;
}

/** Monitored series + monitored episode + aired + no file, ordered by air date. */
export function missingEpisodeIds(app: FastifyInstance, now = new Date()): number[] {
  return app.db
    .select({ id: schema.episodes.id, airDateUtc: schema.episodes.airDateUtc, airDate: schema.episodes.airDate })
    .from(schema.episodes)
    .innerJoin(schema.series, eq(schema.series.id, schema.episodes.seriesId))
    .where(
      and(
        eq(schema.series.monitored, true),
        eq(schema.episodes.monitored, true),
        isNull(schema.episodes.episodeFileId),
        sql`${schema.episodes.seasonNumber} > 0`,
      ),
    )
    .all()
    .filter((e) => isAired({ airDateUtc: e.airDateUtc, airDate: e.airDate } as EpisodeRow, now))
    .sort((a, b) => (a.airDateUtc ?? a.airDate ?? '').localeCompare(b.airDateUtc ?? b.airDate ?? ''))
    .map((e) => e.id);
}

/** Monitored episodes whose file quality is below the series profile cutoff. */
export function cutoffUnmetEpisodeIds(app: FastifyInstance): number[] {
  const cutoffs = new Map(app.db.select().from(schema.qualityProfiles).all().map((p) => [p.id, qualityWeight(p.cutoff)]));
  return app.db
    .select({ id: schema.episodes.id, profileId: schema.series.qualityProfileId, quality: schema.episodeFiles.quality })
    .from(schema.episodes)
    .innerJoin(schema.series, eq(schema.series.id, schema.episodes.seriesId))
    .innerJoin(schema.episodeFiles, eq(schema.episodeFiles.id, schema.episodes.episodeFileId))
    .where(and(eq(schema.series.monitored, true), eq(schema.episodes.monitored, true), isNotNull(schema.episodes.episodeFileId)))
    .all()
    .filter((r) => qualityWeight((JSON.parse(r.quality) as QualityModel).quality.id) < (cutoffs.get(r.profileId) ?? 0))
    .map((r) => r.id);
}

/** Registers EpisodeSearch, SeasonSearch, SeriesSearch, MissingEpisodeSearch and CutoffUnmetEpisodeSearch. */
export function registerSearchCommands(app: FastifyInstance): void {
  app.commands.register('EpisodeSearch', async ({ body, updateMessage }) => {
    const ids = intArray(body.episodeIds);
    if (!ids || ids.length === 0) throw new Error('episodeIds is required');
    updateMessage(message(await runEpisodes(app, ids)));
  });

  app.commands.register('SeasonSearch', async ({ body, updateMessage }) => {
    const series = requireSeries(app, body);
    if (!Number.isInteger(body.seasonNumber)) throw new Error('seasonNumber is required');
    updateMessage(message(await runSeason(app, series, body.seasonNumber as number)));
  });

  app.commands.register('SeriesSearch', async ({ body, updateMessage }) => {
    const series = requireSeries(app, body);
    const seasons = app.db
      .select()
      .from(schema.seasons)
      .where(and(eq(schema.seasons.seriesId, series.id), eq(schema.seasons.monitored, true)))
      .all()
      .filter((s) => s.seasonNumber > 0)
      .sort((a, b) => a.seasonNumber - b.seasonNumber);
    let totals: Totals = { found: 0, grabbed: 0 };
    for (const s of seasons) totals = add(totals, await runSeason(app, series, s.seasonNumber));
    updateMessage(message(totals));
  });

  app.commands.register('MissingEpisodeSearch', async ({ updateMessage }) => {
    updateMessage(message(await runEpisodes(app, missingEpisodeIds(app))));
  });

  app.commands.register('CutoffUnmetEpisodeSearch', async ({ updateMessage }) => {
    updateMessage(message(await runEpisodes(app, cutoffUnmetEpisodeIds(app))));
  });
}
