import { and, asc, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { QUALITIES, type Paged, type Series, type WantedRecord } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { qualityWeight } from '../decision/prioritize.js';
import { toApiEpisode } from './episodes.js';
import { getSeries } from './series.js';

export type WantedSortKey = 'airDateUtc' | 'series.sortTitle' | 'episodeTitle';

export interface WantedOptions {
  page: number;
  pageSize: number;
  sortKey: WantedSortKey;
  sortDirection: 'ascending' | 'descending';
  monitored?: boolean;
  includeSeries?: boolean;
}

const airSort = sql`coalesce(${schema.episodes.airDateUtc}, ${schema.episodes.airDate})`;

function orderBy(opts: WantedOptions): SQL[] {
  const dir = opts.sortDirection === 'ascending' ? asc : desc;
  const primary =
    opts.sortKey === 'series.sortTitle' ? schema.series.sortTitle : opts.sortKey === 'episodeTitle' ? schema.episodes.title : airSort;
  return [dir(primary), dir(schema.episodes.id)];
}

const monitoredCond = (monitored: boolean): SQL =>
  monitored
    ? and(eq(schema.episodes.monitored, true), eq(schema.series.monitored, true))!
    : or(eq(schema.episodes.monitored, false), eq(schema.series.monitored, false))!;

function toRecords(app: FastifyInstance, rows: (typeof schema.episodes.$inferSelect)[], includeSeries: boolean): WantedRecord[] {
  const cache = new Map<number, Series | undefined>();
  return rows.map((row) => {
    if (!cache.has(row.seriesId)) cache.set(row.seriesId, getSeries(app.db, row.seriesId));
    const record = toApiEpisode(row) as WantedRecord;
    if (includeSeries) record.series = cache.get(row.seriesId)!;
    return record;
  });
}

function paged(opts: WantedOptions, totalRecords: number, records: WantedRecord[]): Paged<WantedRecord> {
  return { page: opts.page, pageSize: opts.pageSize, sortKey: opts.sortKey, sortDirection: opts.sortDirection, totalRecords, records };
}

/** Aired, file-less, non-special episodes. */
export function listMissing(app: FastifyInstance, opts: WantedOptions, now = new Date()): Paged<WantedRecord> {
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const where = and(
    isNull(schema.episodes.episodeFileId),
    sql`${schema.episodes.seasonNumber} > 0`,
    or(
      and(isNotNull(schema.episodes.airDateUtc), sql`${schema.episodes.airDateUtc} <= ${nowIso}`),
      and(isNull(schema.episodes.airDateUtc), isNotNull(schema.episodes.airDate), sql`${schema.episodes.airDate} <= ${today}`),
    ),
    monitoredCond(opts.monitored ?? true),
  );
  const total =
    app.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.episodes)
      .innerJoin(schema.series, eq(schema.series.id, schema.episodes.seriesId))
      .where(where)
      .get()?.n ?? 0;
  const rows = app.db
    .select({ e: schema.episodes })
    .from(schema.episodes)
    .innerJoin(schema.series, eq(schema.series.id, schema.episodes.seriesId))
    .where(where)
    .orderBy(...orderBy(opts))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize)
    .all()
    .map((r) => r.e);
  return paged(opts, total, toRecords(app, rows, opts.includeSeries ?? true));
}

/** SQL equivalent of qualityWeight() for a quality id expression (unknown ids weigh 0). */
function weightExpr(idExpr: SQL): SQL {
  const whens = QUALITIES.map((q) => sql`when ${q.id} then ${qualityWeight(q.id)}`);
  return sql`(case ${idExpr} ${sql.join(whens, sql` `)} else 0 end)`;
}

/** Episodes with a file whose quality weighs less than the series profile cutoff. */
export function listCutoffUnmet(app: FastifyInstance, opts: WantedOptions): Paged<WantedRecord> {
  const fileWeight = weightExpr(sql`json_extract(${schema.episodeFiles.quality}, '$.quality.id')`);
  const cutoffWeight = weightExpr(sql`${schema.qualityProfiles.cutoff}`);
  const where = and(
    isNotNull(schema.episodes.episodeFileId),
    monitoredCond(opts.monitored ?? true),
    sql`${fileWeight} < ${cutoffWeight}`,
  );
  const total =
    app.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.episodes)
      .innerJoin(schema.series, eq(schema.series.id, schema.episodes.seriesId))
      .innerJoin(schema.episodeFiles, eq(schema.episodeFiles.id, schema.episodes.episodeFileId))
      .innerJoin(schema.qualityProfiles, eq(schema.qualityProfiles.id, schema.series.qualityProfileId))
      .where(where)
      .get()?.n ?? 0;
  const rows = app.db
    .select({ e: schema.episodes })
    .from(schema.episodes)
    .innerJoin(schema.series, eq(schema.series.id, schema.episodes.seriesId))
    .innerJoin(schema.episodeFiles, eq(schema.episodeFiles.id, schema.episodes.episodeFileId))
    .innerJoin(schema.qualityProfiles, eq(schema.qualityProfiles.id, schema.series.qualityProfileId))
    .where(where)
    .orderBy(...orderBy(opts))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize)
    .all()
    .map((r) => r.e);
  return paged(opts, total, toRecords(app, rows, opts.includeSeries ?? true));
}
