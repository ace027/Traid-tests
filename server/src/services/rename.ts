import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { QualityModel, RenamePreview } from '@sonarr/shared';
import { schema } from '../db/index.js';
import type { EpisodeFileRow, SeriesRow } from '../decision/types.js';
import { destinationFor } from '../import/decisions.js';
import { transferFile } from '../import/transfer.js';
import { recordEvent } from './history.js';
import { isInside } from './paths.js';

export class RenameNotFoundError extends Error {}

function seriesOrThrow(app: FastifyInstance, seriesId: number): SeriesRow {
  const series = app.db.select().from(schema.series).where(eq(schema.series.id, seriesId)).get();
  if (!series) throw new RenameNotFoundError(`Series ${seriesId} not found`);
  return series;
}

/** The naming result for an existing file, relative to the series folder; null when no episode is linked. */
function expectedRelativePath(app: FastifyInstance, series: SeriesRow, file: EpisodeFileRow): { newPath: string; episodeNumbers: number[]; episodeIds: number[] } | null {
  const episodes = app.db
    .select()
    .from(schema.episodes)
    .where(eq(schema.episodes.episodeFileId, file.id))
    .all()
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  if (episodes.length === 0) return null;
  const input: Parameters<typeof destinationFor>[1] = { series, episodes, quality: JSON.parse(file.quality) as QualityModel };
  if (file.releaseGroup) input.releaseGroup = file.releaseGroup;
  const dest = destinationFor(app.db, input, file.path);
  return { newPath: path.relative(series.path, dest), episodeNumbers: episodes.map((e) => e.episodeNumber), episodeIds: episodes.map((e) => e.id) };
}

/** Files of the series (optionally one season) whose current relative path differs from the naming result. */
export function getRenamePreview(app: FastifyInstance, seriesId: number, seasonNumber?: number): RenamePreview[] {
  const series = seriesOrThrow(app, seriesId);
  const where =
    seasonNumber === undefined
      ? eq(schema.episodeFiles.seriesId, seriesId)
      : and(eq(schema.episodeFiles.seriesId, seriesId), eq(schema.episodeFiles.seasonNumber, seasonNumber));
  const out: RenamePreview[] = [];
  for (const file of app.db.select().from(schema.episodeFiles).where(where).all()) {
    const expected = expectedRelativePath(app, series, file);
    if (!expected || expected.newPath === file.relativePath) continue;
    out.push({
      seriesId,
      seasonNumber: file.seasonNumber,
      episodeNumbers: expected.episodeNumbers,
      episodeFileId: file.id,
      existingPath: file.relativePath,
      newPath: expected.newPath,
    });
  }
  return out.sort((a, b) => a.seasonNumber - b.seasonNumber || (a.episodeNumbers[0] ?? 0) - (b.episodeNumbers[0] ?? 0));
}

export interface RenameOutcome {
  renamed: number;
  errors: string[];
}

function realInside(parent: string, child: string): boolean {
  try {
    return isInside(fs.realpathSync(parent), fs.realpathSync(child));
  } catch {
    return false;
  }
}

/**
 * Renames the given files of a series to the naming result. Files are moved within the series folder only: a
 * file (or target) outside it is refused. Records episodeFileRenamed per file.
 */
export async function renameFiles(app: FastifyInstance, seriesId: number, episodeFileIds: readonly number[]): Promise<RenameOutcome> {
  const series = seriesOrThrow(app, seriesId);
  const outcome: RenameOutcome = { renamed: 0, errors: [] };
  for (const id of new Set(episodeFileIds)) {
    const file = app.db
      .select()
      .from(schema.episodeFiles)
      .where(and(eq(schema.episodeFiles.id, id), eq(schema.episodeFiles.seriesId, seriesId)))
      .get();
    if (!file) {
      outcome.errors.push(`Episode file ${id} not found`);
      continue;
    }
    const expected = expectedRelativePath(app, series, file);
    if (!expected || expected.newPath === file.relativePath) continue;
    const target = path.join(series.path, expected.newPath);
    if (!realInside(series.path, file.path) || !isInside(series.path, target)) {
      outcome.errors.push(`${file.relativePath}: file is outside the series folder`);
      continue;
    }
    let renamedTo: string;
    try {
      renamedTo = await transferFile(file.path, target, 'move');
    } catch (err) {
      outcome.errors.push(`${file.relativePath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const relativePath = path.relative(series.path, renamedTo);
    app.db.update(schema.episodeFiles).set({ path: renamedTo, relativePath }).where(eq(schema.episodeFiles.id, file.id)).run();
    recordEvent(app, 'episodeFileRenamed', {
      seriesId,
      episodeIds: expected.episodeIds,
      sourceTitle: file.relativePath,
      quality: JSON.parse(file.quality) as QualityModel,
      data: { sourcePath: file.path, sourceRelativePath: file.relativePath, path: renamedTo, relativePath },
    });
    app.events.publish('episodefile', 'updated', { id: file.id, seriesId });
    outcome.renamed++;
  }
  if (outcome.renamed > 0) app.events.publish('series', 'updated', { id: seriesId });
  return outcome;
}

/** All files of the series. */
export function seriesFileIds(app: FastifyInstance, seriesId: number): number[] {
  return app.db
    .select({ id: schema.episodeFiles.id })
    .from(schema.episodeFiles)
    .where(eq(schema.episodeFiles.seriesId, seriesId))
    .all()
    .map((r) => r.id);
}
