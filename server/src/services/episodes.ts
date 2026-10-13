import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Episode, EpisodeFile, QualityModel } from '@sonarr/shared';
import { schema } from '../db/index.js';

type EpisodeRow = typeof schema.episodes.$inferSelect;
type FileRow = typeof schema.episodeFiles.$inferSelect;

export function toApiEpisode(row: EpisodeRow): Episode {
  const ep: Episode = {
    id: row.id,
    seriesId: row.seriesId,
    tvMazeId: row.tvmazeId,
    episodeFileId: row.episodeFileId ?? 0,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    title: row.title,
    overview: row.overview,
    runtime: row.runtime,
    hasFile: row.episodeFileId !== null,
    monitored: row.monitored,
  };
  if (row.absoluteEpisodeNumber !== null) ep.absoluteEpisodeNumber = row.absoluteEpisodeNumber;
  if (row.airDate) ep.airDate = row.airDate;
  if (row.airDateUtc) ep.airDateUtc = row.airDateUtc;
  return ep;
}

export function toApiEpisodeFile(row: FileRow): EpisodeFile {
  const f: EpisodeFile = {
    id: row.id,
    seriesId: row.seriesId,
    seasonNumber: row.seasonNumber,
    relativePath: row.relativePath,
    path: row.path,
    size: row.size,
    dateAdded: row.dateAdded,
    quality: JSON.parse(row.quality) as QualityModel,
  };
  if (row.releaseGroup) f.releaseGroup = row.releaseGroup;
  return f;
}

function isStrictlyInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Deletes an episode file row (unlinking its episodes) and removes the file from disk,
 * but only when its realpath is inside the series folder. A file that is already gone
 * from disk still has its row deleted. Returns false when the row does not exist.
 */
export function deleteEpisodeFile(app: FastifyInstance, id: number): { deletedFromDisk: boolean } | undefined {
  const db = app.db;
  const file = db.select().from(schema.episodeFiles).where(eq(schema.episodeFiles.id, id)).get();
  if (!file) return undefined;
  const series = db.select().from(schema.series).where(eq(schema.series.id, file.seriesId)).get();

  let deletedFromDisk = false;
  if (series) {
    try {
      const realFile = fs.realpathSync(file.path);
      const realSeries = fs.realpathSync(series.path);
      if (isStrictlyInside(realSeries, realFile)) {
        fs.unlinkSync(file.path);
        deletedFromDisk = true;
      }
    } catch {
      // missing on disk or series folder gone: only the row is removed
    }
  }

  const unlinked = db.transaction((tx) => {
    const eps = tx.select({ id: schema.episodes.id }).from(schema.episodes).where(eq(schema.episodes.episodeFileId, id)).all();
    tx.update(schema.episodes).set({ episodeFileId: null }).where(eq(schema.episodes.episodeFileId, id)).run();
    tx.delete(schema.episodeFiles).where(eq(schema.episodeFiles.id, id)).run();
    return eps.map((e) => e.id);
  });
  app.events.publish('episodefile', 'deleted', { id, seriesId: file.seriesId });
  if (unlinked.length) app.events.publish('episode', 'updated', { episodeIds: unlinked, seriesId: file.seriesId });
  return { deletedFromDisk };
}
