import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema } from '../db/index.js';
import { MetadataError } from './metadata/types.js';
import { getSeries } from './series.js';

const iso = (v: string | undefined) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export interface RefreshResult {
  added: number;
  updated: number;
  removed: number;
}

export async function refreshSeries(app: FastifyInstance, seriesId: number): Promise<RefreshResult> {
  const db = app.db;
  const row = db.select().from(schema.series).where(eq(schema.series.id, seriesId)).get();
  if (!row) throw new Error(`Series ${seriesId} not found`);

  let meta;
  try {
    meta = await app.metadata.getSeries(row.tvmazeId);
  } catch (e) {
    if (e instanceof MetadataError) throw new Error(`Metadata refresh failed: ${e.message}`);
    throw e;
  }
  const { series: info, episodes: provEpisodes } = meta;
  const result: RefreshResult = { added: 0, updated: 0, removed: 0 };
  const now = new Date().toISOString();
  const newItemsMonitored = row.monitored && row.monitorNewItems === 'all';

  db.transaction((tx) => {
    const set: Partial<typeof schema.series.$inferInsert> = {
      title: info.title,
      sortTitle: info.sortTitle || info.title.toLowerCase(),
      cleanTitle: info.cleanTitle,
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
      imdbId: info.imdbId ?? row.imdbId,
      lastInfoSync: now,
    };
    if (!row.tvdbId && info.tvdbId) {
      const clash = tx.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.tvdbId, info.tvdbId)).get();
      if (!clash) set.tvdbId = info.tvdbId;
    }
    tx.update(schema.series).set(set).where(eq(schema.series.id, seriesId)).run();

    const seasons = new Map(
      tx.select().from(schema.seasons).where(eq(schema.seasons.seriesId, seriesId)).all().map((s) => [s.seasonNumber, s]),
    );
    const wantSeasons = new Set<number>(info.seasons.map((s) => s.seasonNumber));
    for (const e of provEpisodes) wantSeasons.add(e.seasonNumber);
    for (const n of wantSeasons) {
      if (!seasons.has(n)) {
        tx.insert(schema.seasons).values({ seriesId, seasonNumber: n, monitored: n > 0 && newItemsMonitored }).run();
        seasons.set(n, { id: 0, seriesId, seasonNumber: n, monitored: n > 0 && newItemsMonitored });
      }
    }

    const existing = new Map(
      tx.select().from(schema.episodes).where(eq(schema.episodes.seriesId, seriesId)).all().map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e]),
    );
    const seen = new Set<string>();
    for (const e of provEpisodes) {
      const key = `${e.seasonNumber}:${e.episodeNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const values = {
        tvmazeId: e.tvMazeId,
        absoluteEpisodeNumber: e.absoluteEpisodeNumber ?? null,
        title: e.title,
        overview: e.overview,
        airDate: e.airDate ?? null,
        airDateUtc: iso(e.airDateUtc),
        runtime: e.runtime,
      };
      const cur = existing.get(key);
      if (cur) {
        const changed = (Object.keys(values) as (keyof typeof values)[]).some((k) => cur[k] !== values[k]);
        if (changed) {
          tx.update(schema.episodes).set(values).where(eq(schema.episodes.id, cur.id)).run();
          result.updated++;
        }
      } else {
        const monitored = e.seasonNumber > 0 && newItemsMonitored && !!seasons.get(e.seasonNumber)?.monitored;
        tx.insert(schema.episodes)
          .values({ seriesId, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, ...values, monitored })
          .run();
        result.added++;
      }
    }
    // vanished episodes: removed only when they have no file
    for (const [key, cur] of existing) {
      if (seen.has(key) || cur.episodeFileId !== null) continue;
      tx.delete(schema.episodes).where(eq(schema.episodes.id, cur.id)).run();
      result.removed++;
    }
    // vanished seasons: only when nothing is left in them
    for (const [n, s] of seasons) {
      if (wantSeasons.has(n) || s.id === 0) continue;
      const left = tx
        .select({ id: schema.episodes.id })
        .from(schema.episodes)
        .where(and(eq(schema.episodes.seriesId, seriesId), eq(schema.episodes.seasonNumber, n)))
        .get();
      if (!left) tx.delete(schema.seasons).where(eq(schema.seasons.id, s.id)).run();
    }
  });

  if (result.added || result.updated || result.removed) app.events.publish('episode', 'updated', { seriesId });
  app.events.publish('series', 'updated', getSeries(db, seriesId) as unknown as Record<string, unknown>);
  return result;
}

export function registerRefreshCommand(app: FastifyInstance): void {
  app.commands.register('RefreshSeries', async ({ body, updateMessage }) => {
    const only = typeof body.seriesId === 'number' ? body.seriesId : undefined;
    const ids =
      only !== undefined
        ? [only]
        : app.db.select({ id: schema.series.id }).from(schema.series).orderBy(schema.series.id).all().map((r) => r.id);
    const total: RefreshResult = { added: 0, updated: 0, removed: 0 };
    const errors: string[] = [];
    for (const id of ids) {
      try {
        const r = await refreshSeries(app, id);
        total.added += r.added;
        total.updated += r.updated;
        total.removed += r.removed;
      } catch (e) {
        if (ids.length === 1) throw e;
        errors.push(`Series ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // a failed refresh must not block the disk scan of the others
    app.commands.enqueue('RescanSeries', only !== undefined ? { seriesId: only } : {}, 'manual');
    const summary = `Refreshed ${ids.length - errors.length} series: ${total.added} episodes added, ${total.updated} updated, ${total.removed} removed`;
    if (errors.length) throw new Error([...errors, summary].join('\n'));
    updateMessage(summary);
  });
}
