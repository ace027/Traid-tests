import type { RunResult } from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { QualityModel } from '@sonarr/shared';
import { schema } from '../db/index.js';

/** The database or a transaction of it. */
export type DbOrTx = BaseSQLiteDatabase<'sync', RunResult, typeof schema>;

export interface EpisodeFileInput {
  seriesId: number;
  seasonNumber: number;
  /** Absolute path; unique across all series. */
  path: string;
  relativePath: string;
  size: number;
  quality: QualityModel;
  releaseGroup?: string | null;
  /** Episodes the file covers; other episodes linked to the file are unlinked. */
  episodeIds: number[];
  dateAdded?: string;
}

export interface UpsertResult {
  id: number;
  added: boolean;
  updated: boolean;
}

/**
 * Inserts or updates the episode file row for `input.path` and links exactly `input.episodeIds` to it.
 * A row with the same path that belongs to another series is taken over (path is unique).
 */
export function upsertEpisodeFile(db: DbOrTx, input: EpisodeFileInput): UpsertResult {
  const values = {
    seriesId: input.seriesId,
    seasonNumber: input.seasonNumber,
    relativePath: input.relativePath,
    path: input.path,
    size: input.size,
    quality: JSON.stringify(input.quality),
    releaseGroup: input.releaseGroup ?? null,
  };
  const cur = db.select().from(schema.episodeFiles).where(eq(schema.episodeFiles.path, input.path)).get();
  let id: number;
  let added = false;
  let updated = false;
  if (cur && cur.seriesId === input.seriesId) {
    id = cur.id;
    updated =
      cur.seasonNumber !== values.seasonNumber ||
      cur.relativePath !== values.relativePath ||
      cur.size !== values.size ||
      cur.quality !== values.quality ||
      cur.releaseGroup !== values.releaseGroup;
    if (updated) db.update(schema.episodeFiles).set(values).where(eq(schema.episodeFiles.id, cur.id)).run();
  } else {
    if (cur) unlinkEpisodeFile(db, cur.id);
    id = db
      .insert(schema.episodeFiles)
      .values({ ...values, dateAdded: input.dateAdded ?? new Date().toISOString() })
      .returning()
      .get().id;
    added = true;
  }
  const want = new Set(input.episodeIds);
  for (const e of db.select().from(schema.episodes).where(eq(schema.episodes.episodeFileId, id)).all()) {
    if (!want.has(e.id)) db.update(schema.episodes).set({ episodeFileId: null }).where(eq(schema.episodes.id, e.id)).run();
  }
  for (const episodeId of want) {
    const e = db.select({ fileId: schema.episodes.episodeFileId }).from(schema.episodes).where(eq(schema.episodes.id, episodeId)).get();
    if (e && e.fileId !== id) db.update(schema.episodes).set({ episodeFileId: id }).where(eq(schema.episodes.id, episodeId)).run();
  }
  return { id, added, updated };
}

/** Unlinks the file's episodes and deletes the row (never touches the disk). Returns the unlinked episode ids. */
export function unlinkEpisodeFile(db: DbOrTx, id: number): number[] {
  const eps = db.select({ id: schema.episodes.id }).from(schema.episodes).where(eq(schema.episodes.episodeFileId, id)).all();
  db.update(schema.episodes).set({ episodeFileId: null }).where(eq(schema.episodes.episodeFileId, id)).run();
  db.delete(schema.episodeFiles).where(eq(schema.episodeFiles.id, id)).run();
  return eps.map((e) => e.id);
}
