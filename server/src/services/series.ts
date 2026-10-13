import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  monitorEpisodes,
  validationError,
  type AddSeriesInput,
  type Season,
  type SeasonStatistics,
  type Series,
  type SeriesImage,
  type SeriesStatistics,
  type UpdateSeriesInput,
} from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';
import { MetadataError, type ProviderEpisode } from './metadata/types.js';

type SeriesRow = typeof schema.series.$inferSelect;

export interface StatsEntry {
  series: SeriesStatistics;
  seasons: Map<number, SeasonStatistics>;
}

const zeroStats = (): SeasonStatistics => ({
  episodeFileCount: 0,
  episodeCount: 0,
  totalEpisodeCount: 0,
  sizeOnDisk: 0,
  percentOfEpisodes: 0,
});

const percent = (files: number, eps: number) => (eps === 0 ? 100 : Math.min(100, (files / eps) * 100));

/** Statistics for all series (or the given ids) from two grouped queries; never one query per series. */
export function getSeriesStatistics(db: Db, seriesIds?: number[], now: Date = new Date()): Map<number, StatsEntry> {
  const nowIso = now.toISOString();
  const filter = (col: string) =>
    seriesIds ? sql` WHERE ${sql.raw(col)} IN (${sql.join(seriesIds.map((i) => sql`${i}`), sql`, `)})` : sql``;
  const epRows = seriesIds && seriesIds.length === 0 ? [] : db.all<{
    series_id: number;
    season_number: number;
    total: number;
    files: number;
    counted: number;
    prev: string | null;
    next: string | null;
  }>(sql`SELECT series_id, season_number, COUNT(*) AS total, COUNT(episode_file_id) AS files,
      SUM(CASE WHEN monitored = 1 AND (episode_file_id IS NOT NULL OR (air_date_utc IS NOT NULL AND air_date_utc <= ${nowIso})) THEN 1 ELSE 0 END) AS counted,
      MAX(CASE WHEN air_date_utc <= ${nowIso} THEN air_date_utc END) AS prev,
      MIN(CASE WHEN air_date_utc > ${nowIso} THEN air_date_utc END) AS next
    FROM episodes${filter('series_id')} GROUP BY series_id, season_number`);
  const sizeRows = seriesIds && seriesIds.length === 0 ? [] : db.all<{ series_id: number; season_number: number; size: number }>(
    sql`SELECT series_id, season_number, COALESCE(SUM(size), 0) AS size FROM episode_files${filter('series_id')} GROUP BY series_id, season_number`,
  );
  const sizes = new Map(sizeRows.map((r) => [`${r.series_id}:${r.season_number}`, r.size]));

  const out = new Map<number, StatsEntry>();
  for (const r of epRows) {
    let entry = out.get(r.series_id);
    if (!entry) {
      entry = { series: { ...zeroStats(), seasonCount: 0 }, seasons: new Map() };
      out.set(r.series_id, entry);
    }
    const size = sizes.get(`${r.series_id}:${r.season_number}`) ?? 0;
    const s: SeasonStatistics = {
      episodeFileCount: r.files,
      episodeCount: r.counted ?? 0,
      totalEpisodeCount: r.total,
      sizeOnDisk: size,
      percentOfEpisodes: percent(r.files, r.counted ?? 0),
    };
    if (r.prev) s.previousAiring = r.prev;
    if (r.next) s.nextAiring = r.next;
    entry.seasons.set(r.season_number, s);
    const t = entry.series;
    t.episodeFileCount += s.episodeFileCount;
    t.episodeCount += s.episodeCount;
    t.totalEpisodeCount += s.totalEpisodeCount;
    t.sizeOnDisk += s.sizeOnDisk;
    if (r.season_number > 0) t.seasonCount++;
    if (s.previousAiring && (!t.previousAiring || s.previousAiring > t.previousAiring)) t.previousAiring = s.previousAiring;
    if (s.nextAiring && (!t.nextAiring || s.nextAiring < t.nextAiring)) t.nextAiring = s.nextAiring;
  }
  for (const e of out.values()) e.series.percentOfEpisodes = percent(e.series.episodeFileCount, e.series.episodeCount);
  return out;
}

export function toApiSeries(row: SeriesRow, stats: StatsEntry | undefined, seasons: { seasonNumber: number; monitored: boolean }[]): Series {
  const s: Series = {
    id: row.id,
    title: row.title,
    sortTitle: row.sortTitle,
    status: row.status as Series['status'],
    overview: row.overview,
    network: row.network,
    airTime: row.airTime,
    images: JSON.parse(row.images) as SeriesImage[],
    seasons: seasons
      .slice()
      .sort((a, b) => a.seasonNumber - b.seasonNumber)
      .map((x): Season => {
        const ss = stats?.seasons.get(x.seasonNumber);
        return { seasonNumber: x.seasonNumber, monitored: x.monitored, statistics: ss ?? zeroStats() };
      }),
    year: row.year,
    path: row.path,
    qualityProfileId: row.qualityProfileId,
    seasonFolder: row.seasonFolder,
    monitored: row.monitored,
    monitorNewItems: row.monitorNewItems as Series['monitorNewItems'],
    runtime: row.runtime,
    tvdbId: row.tvdbId ?? 0,
    tvMazeId: row.tvmazeId,
    imdbId: row.imdbId,
    firstAired: row.firstAired,
    seriesType: row.seriesType as Series['seriesType'],
    cleanTitle: row.cleanTitle,
    titleSlug: row.titleSlug,
    rootFolderPath: row.rootFolderPath,
    certification: row.certification,
    genres: JSON.parse(row.genres) as string[],
    tags: JSON.parse(row.tags) as number[],
    added: row.added,
    ratings: JSON.parse(row.ratings) as Series['ratings'],
    statistics: stats?.series ?? { ...zeroStats(), seasonCount: 0 },
  };
  if (row.addOptions) s.addOptions = JSON.parse(row.addOptions);
  return s;
}

export function listSeries(db: Db): Series[] {
  const rows = db.select().from(schema.series).orderBy(schema.series.sortTitle).all();
  const seasons = db.select().from(schema.seasons).all();
  const stats = getSeriesStatistics(db);
  return rows.map((r) =>
    toApiSeries(r, stats.get(r.id), seasons.filter((s) => s.seriesId === r.id)),
  );
}

export function getSeries(db: Db, id: number): Series | undefined {
  const row = db.select().from(schema.series).where(eq(schema.series.id, id)).get();
  if (!row) return undefined;
  const seasons = db.select().from(schema.seasons).where(eq(schema.seasons.seriesId, id)).all();
  return toApiSeries(row, getSeriesStatistics(db, [id]).get(id), seasons);
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** realpath of the deepest existing ancestor of p, re-joined with the missing remainder. */
function realpathLoose(p: string): string {
  const rest: string[] = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function realRootFolders(db: Db): { path: string; real: string }[] {
  return db
    .select()
    .from(schema.rootFolders)
    .all()
    .map((r) => ({ path: r.path, real: realpathLoose(r.path) }));
}

export function folderName(title: string, year: number): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim() || 'Series';
  return year > 0 ? `${clean} (${year})` : clean;
}

const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function mapMetadataError(e: unknown): never {
  if (e instanceof MetadataError) {
    if (e.status === 404) throw validationError('tvMazeId', 'Series not found');
    throw Object.assign(new Error(e.message), { statusCode: 503 });
  }
  throw e;
}

const iso = (v: string | undefined) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

function insertChunks<T extends object>(rows: T[], size: number, fn: (chunk: T[]) => void): void {
  for (let i = 0; i < rows.length; i += size) fn(rows.slice(i, i + size));
}

function assertTags(db: Db, tagIds: number[]): void {
  if (tagIds.length === 0) return;
  const found = db.select({ id: schema.tags.id }).from(schema.tags).where(inArray(schema.tags.id, tagIds)).all();
  if (found.length !== new Set(tagIds).size) throw validationError('tags', 'Tag does not exist');
}

function resolveContainingRoot(db: Db, target: string): { root: string; resolved: string } | undefined {
  const real = realpathLoose(target);
  const root = realRootFolders(db).find((r) => isInside(r.real, real));
  return root ? { root: root.path, resolved: path.resolve(target) } : undefined;
}

export async function addSeries(app: FastifyInstance, input: AddSeriesInput): Promise<Series> {
  const db = app.db;
  if (!db.select().from(schema.qualityProfiles).where(eq(schema.qualityProfiles.id, input.qualityProfileId)).get()) {
    throw validationError('qualityProfileId', 'Quality profile does not exist');
  }
  assertTags(db, input.tags);

  let explicitPath: string | undefined;
  let rootFolderPath: string | undefined;
  if (input.path) {
    if (!path.isAbsolute(input.path)) throw validationError('path', 'Path must be an absolute path');
    const hit = resolveContainingRoot(db, input.path);
    if (!hit) throw validationError('path', 'Path is not inside a configured root folder');
    explicitPath = hit.resolved;
    rootFolderPath = hit.root;
  } else {
    const wanted = path.resolve(input.rootFolderPath!);
    const root = db.select().from(schema.rootFolders).where(eq(schema.rootFolders.path, wanted)).get();
    if (!root) throw validationError('rootFolderPath', `Root folder '${wanted}' does not exist`);
    rootFolderPath = root.path;
  }

  const dupMessage = 'This series has already been added';
  const dupCheck = (tvmazeId: number, tvdbId: number | null | undefined) => {
    if (db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.tvmazeId, tvmazeId)).get()) {
      throw validationError('tvdbId', dupMessage);
    }
    if (tvdbId && db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.tvdbId, tvdbId)).get()) {
      throw validationError('tvdbId', dupMessage);
    }
  };
  dupCheck(input.tvMazeId, input.tvdbId);

  let meta;
  try {
    meta = await app.metadata.getSeries(input.tvMazeId);
  } catch (e) {
    mapMetadataError(e);
  }
  const { series: info, episodes: provEpisodes } = meta;
  const tvdbId = input.tvdbId ?? (info.tvdbId || null);
  dupCheck(info.tvMazeId, tvdbId);

  const title = info.title;
  const baseSlug = info.titleSlug || slugify(title) || `series-${info.tvMazeId}`;
  const slugTaken = (s: string) =>
    !!db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.titleSlug, s)).get();
  const pathTaken = (p: string) =>
    !!db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.path, p)).get();

  let titleSlug = baseSlug;
  if (slugTaken(titleSlug) && info.year > 0) titleSlug = `${baseSlug}-${info.year}`;
  for (let n = 2; slugTaken(titleSlug); n++) titleSlug = `${baseSlug}-${n}`;

  let seriesPath: string;
  if (explicitPath) {
    seriesPath = explicitPath;
    if (pathTaken(seriesPath)) throw validationError('path', 'Path is already used by another series');
  } else {
    seriesPath = path.join(rootFolderPath, folderName(title, info.year));
    if (pathTaken(seriesPath)) seriesPath = path.join(rootFolderPath, `${folderName(title, info.year)} (${info.tvMazeId})`);
  }

  const now = new Date();
  const eps: ProviderEpisode[] = provEpisodes;
  const flags = monitorEpisodes(
    input.addOptions.monitor,
    eps.map((e) => ({ seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, airDateUtc: iso(e.airDateUtc), hasFile: false })),
    now,
  );
  const seasonNumbers = new Set<number>(info.seasons.map((s) => s.seasonNumber));
  for (const e of eps) seasonNumbers.add(e.seasonNumber);
  const seasonMonitored = new Map<number, boolean>();
  eps.forEach((e, i) => {
    if (flags[i]) seasonMonitored.set(e.seasonNumber, true);
  });

  const created = db.transaction((tx) => {
    const row = tx
      .insert(schema.series)
      .values({
        tvdbId,
        tvmazeId: info.tvMazeId,
        imdbId: info.imdbId ?? null,
        title,
        sortTitle: info.sortTitle || title.toLowerCase(),
        cleanTitle: info.cleanTitle,
        titleSlug,
        status: info.status,
        overview: info.overview,
        network: info.network ?? null,
        airTime: info.airTime ?? null,
        runtime: info.runtime,
        year: info.year,
        firstAired: info.firstAired ?? null,
        genres: JSON.stringify(info.genres),
        images: JSON.stringify(info.images),
        ratings: JSON.stringify(info.ratings),
        certification: info.certification ?? null,
        seriesType: input.seriesType,
        path: seriesPath,
        rootFolderPath,
        qualityProfileId: input.qualityProfileId,
        seasonFolder: input.seasonFolder,
        monitored: input.monitored,
        monitorNewItems: input.monitorNewItems,
        tags: JSON.stringify(input.tags),
        addOptions: JSON.stringify(input.addOptions),
        added: now.toISOString(),
        lastInfoSync: now.toISOString(),
      })
      .returning()
      .get();
    insertChunks(
      [...seasonNumbers].map((n) => ({ seriesId: row.id, seasonNumber: n, monitored: n > 0 && !!seasonMonitored.get(n) })),
      200,
      (c) => tx.insert(schema.seasons).values(c).run(),
    );
    insertChunks(
      eps.map((e, i) => ({
        seriesId: row.id,
        tvmazeId: e.tvMazeId,
        seasonNumber: e.seasonNumber,
        episodeNumber: e.episodeNumber,
        absoluteEpisodeNumber: e.absoluteEpisodeNumber ?? null,
        title: e.title,
        overview: e.overview,
        airDate: e.airDate ?? null,
        airDateUtc: iso(e.airDateUtc),
        runtime: e.runtime,
        monitored: flags[i]!,
      })),
      100,
      (c) => tx.insert(schema.episodes).values(c).run(),
    );
    return row;
  });

  const api = getSeries(db, created.id)!;
  app.events.publish('series', 'created', api as unknown as Record<string, unknown>);
  if (app.commands.has('RescanSeries')) app.commands.enqueue('RescanSeries', { seriesId: created.id }, 'manual');
  if (input.addOptions.searchForMissingEpisodes && app.commands.has('MissingEpisodeSearch')) {
    app.commands.enqueue('MissingEpisodeSearch', { seriesId: created.id }, 'manual');
  }
  return api;
}

export function updateSeries(app: FastifyInstance, id: number, input: UpdateSeriesInput): Series | undefined {
  const db = app.db;
  const existing = db.select().from(schema.series).where(eq(schema.series.id, id)).get();
  if (!existing) return undefined;
  const set: Partial<typeof schema.series.$inferInsert> = {};
  if (input.qualityProfileId !== undefined) {
    if (!db.select().from(schema.qualityProfiles).where(eq(schema.qualityProfiles.id, input.qualityProfileId)).get()) {
      throw validationError('qualityProfileId', 'Quality profile does not exist');
    }
    set.qualityProfileId = input.qualityProfileId;
  }
  if (input.tags !== undefined) {
    assertTags(db, input.tags);
    set.tags = JSON.stringify(input.tags);
  }
  if (input.monitored !== undefined) set.monitored = input.monitored;
  if (input.monitorNewItems !== undefined) set.monitorNewItems = input.monitorNewItems;
  if (input.seriesType !== undefined) set.seriesType = input.seriesType;
  if (input.seasonFolder !== undefined) set.seasonFolder = input.seasonFolder;
  if (input.path !== undefined && input.path !== existing.path) {
    if (!path.isAbsolute(input.path)) throw validationError('path', 'Path must be an absolute path');
    const hit = resolveContainingRoot(db, input.path);
    if (!hit) throw validationError('path', 'Path is not inside a configured root folder');
    const other = db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.path, hit.resolved)).get();
    if (other && other.id !== id) throw validationError('path', 'Path is already used by another series');
    set.path = hit.resolved;
    set.rootFolderPath = hit.root;
  }
  db.transaction((tx) => {
    if (Object.keys(set).length) tx.update(schema.series).set(set).where(eq(schema.series.id, id)).run();
    for (const s of input.seasons ?? []) {
      const cur = tx
        .select()
        .from(schema.seasons)
        .where(and(eq(schema.seasons.seriesId, id), eq(schema.seasons.seasonNumber, s.seasonNumber)))
        .get();
      if (!cur) continue;
      if (cur.monitored === s.monitored) continue;
      tx.update(schema.seasons).set({ monitored: s.monitored }).where(eq(schema.seasons.id, cur.id)).run();
      tx.update(schema.episodes)
        .set({ monitored: s.monitored })
        .where(and(eq(schema.episodes.seriesId, id), eq(schema.episodes.seasonNumber, s.seasonNumber)))
        .run();
    }
  });
  const api = getSeries(db, id)!;
  app.events.publish('series', 'updated', api as unknown as Record<string, unknown>);
  return api;
}

export function deleteSeries(app: FastifyInstance, id: number, deleteFiles: boolean): boolean {
  const db = app.db;
  const row = db.select().from(schema.series).where(eq(schema.series.id, id)).get();
  if (!row) return false;
  if (deleteFiles && fs.existsSync(row.path)) {
    const real = fs.realpathSync(row.path);
    if (!realRootFolders(db).some((r) => isInside(r.real, real))) {
      throw validationError('deleteFiles', 'Series folder is not inside a configured root folder');
    }
    fs.rmSync(real, { recursive: true, force: true });
  }
  db.delete(schema.series).where(eq(schema.series.id, id)).run();
  app.events.publish('series', 'deleted', { id });
  return true;
}
