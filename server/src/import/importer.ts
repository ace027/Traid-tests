import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { MediaManagementConfig, QualityModel } from '@sonarr/shared';
import { schema } from '../db/index.js';
import type { EpisodeFileRow } from '../decision/types.js';
import { upsertEpisodeFile, unlinkEpisodeFile } from '../services/episodeFiles.js';
import { recordEvent } from '../services/history.js';
import { getMediaManagementConfig } from '../services/mediaConfig.js';
import { isInside } from '../services/paths.js';
import { VIDEO_EXTENSIONS } from '../services/diskScan.js';
import { destinationFor } from './decisions.js';
import { transferFile } from './transfer.js';
import type { ImportDecision, ImportOptions, ImportResult, SeriesRow } from './types.js';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Only string values: history data is Record<string, string>. */
function stringData(values: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

function insideRealpath(parent: string, child: string): boolean {
  try {
    return isInside(fs.realpathSync(parent), fs.realpathSync(child));
  } catch {
    return false;
  }
}

/**
 * Removes a replaced episode file: moved into recycleBin/{series folder}/{relative path} when a recycle bin is
 * configured, else deleted (only when it really is inside the series folder). Records episodeFileDeleted
 * (reason 'upgrade') and drops the row. Throws when the file exists but could not be removed.
 */
async function replaceOldFile(app: FastifyInstance, series: SeriesRow, file: EpisodeFileRow, media: MediaManagementConfig): Promise<void> {
  if (fs.existsSync(file.path) && insideRealpath(series.path, file.path)) {
    if (media.recycleBin) {
      await transferFile(file.path, path.join(media.recycleBin, path.basename(series.path), file.relativePath), 'move');
    } else {
      await fs.promises.unlink(file.path);
    }
  }
  const episodeIds = app.db
    .select({ id: schema.episodes.id })
    .from(schema.episodes)
    .where(eq(schema.episodes.episodeFileId, file.id))
    .all()
    .map((e) => e.id);
  recordEvent(app, 'episodeFileDeleted', {
    seriesId: series.id,
    episodeIds,
    sourceTitle: file.relativePath,
    quality: JSON.parse(file.quality) as QualityModel,
    data: stringData({ reason: 'upgrade', path: file.path, recycleBin: media.recycleBin || undefined }),
  });
  unlinkEpisodeFile(app.db, file.id);
  app.events.publish('episodefile', 'deleted', { id: file.id, seriesId: series.id });
}

/** Copies sibling extra files (configured extensions) next to the imported episode under its new base name. */
async function importExtraFiles(app: FastifyInstance, source: string, imported: string, media: MediaManagementConfig): Promise<void> {
  const exts = new Set(
    media.extraFileExtensions
      .split(',')
      .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean)
      .map((e) => `.${e}`),
  );
  if (exts.size === 0) return;
  const dir = path.dirname(source);
  const stem = path.basename(source, path.extname(source));
  const newStem = imported.slice(0, imported.length - path.extname(imported).length);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const videos = entries.filter((e) => e.isFile() && VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase())).length;
  for (const e of entries) {
    if (!e.isFile() || !exts.has(path.extname(e.name).toLowerCase())) continue;
    // "Show.S01E01.en.srt" keeps ".en.srt"; with a lone video any extra file belongs to it
    const suffix = e.name.startsWith(stem) ? e.name.slice(stem.length) : videos === 1 ? path.extname(e.name) : null;
    if (suffix === null) continue;
    try {
      await transferFile(path.join(dir, e.name), `${newStem}${suffix}`, 'copy');
    } catch (err) {
      app.log.warn({ err, file: e.name }, 'Unable to import extra file');
    }
  }
}

async function importOne(app: FastifyInstance, decision: ImportDecision, opts: ImportOptions, media: MediaManagementConfig): Promise<ImportResult> {
  const db = app.db;
  const series = db.select().from(schema.series).where(eq(schema.series.id, decision.series!.id)).get();
  if (!series) return { decision, result: 'failed', message: 'Series no longer exists' };
  const ids = decision.episodes.map((e) => e.id);
  const episodes = db.select().from(schema.episodes).where(inArray(schema.episodes.id, ids)).all();
  if (episodes.length !== ids.length) return { decision, result: 'failed', message: 'Episode(s) no longer exist' };

  const source = decision.source.path;
  const naming: Parameters<typeof destinationFor>[1] = { series, episodes, quality: decision.quality };
  if (decision.releaseGroup) naming.releaseGroup = decision.releaseGroup;
  if (decision.sceneName) naming.sceneName = decision.sceneName;
  const dest = destinationFor(db, naming, source);
  if (!isInside(series.path, dest)) return { decision, result: 'failed', message: `Destination is outside the series folder: ${dest}` };

  const fileIds = [...new Set(episodes.flatMap((e) => (e.episodeFileId === null ? [] : [e.episodeFileId])))];
  const oldFiles = fileIds.length
    ? db.select().from(schema.episodeFiles).where(inArray(schema.episodeFiles.id, fileIds)).all().filter((f) => f.path !== source)
    : [];

  let importedPath: string;
  try {
    // transfer first (an occupied destination gets a " (n)" suffix) so a failed transfer never costs the old file
    importedPath = await transferFile(source, dest, opts.mode);
  } catch (err) {
    app.log.warn({ err, source }, 'Import failed');
    return { decision, result: 'failed', message: `Failed to import ${path.basename(source)}: ${errorMessage(err)}` };
  }
  for (const f of oldFiles) {
    try {
      await replaceOldFile(app, series, f, media);
    } catch (err) {
      app.log.warn({ err, path: f.path }, 'Unable to remove the replaced episode file');
      unlinkEpisodeFile(db, f.id);
    }
  }
  // the old file held the exact destination name: move the new file into its place
  if (importedPath !== dest && oldFiles.some((o) => o.path === dest) && !fs.existsSync(dest)) {
    try {
      await fs.promises.rename(importedPath, dest);
      importedPath = dest;
    } catch (err) {
      app.log.warn({ err, importedPath }, 'Unable to move the imported file to its destination name');
    }
  }

  let id: number;
  try {
    const size = (await fs.promises.stat(importedPath)).size;
    ({ id } = upsertEpisodeFile(db, {
      seriesId: series.id,
      seasonNumber: episodes[0]!.seasonNumber,
      path: importedPath,
      relativePath: path.relative(series.path, importedPath),
      size,
      quality: decision.quality,
      releaseGroup: decision.releaseGroup ?? null,
      episodeIds: ids,
    }));
  } catch (err) {
    app.log.error({ err, importedPath, source, mode: opts.mode }, 'Imported file has no episode file record (orphan on disk)');
    return { decision, result: 'failed', message: `Failed to record ${path.basename(importedPath)}: ${errorMessage(err)}` };
  }
  const downloadId = decision.downloadId ?? opts.downloadId;
  recordEvent(app, 'downloadFolderImported', {
    seriesId: series.id,
    episodeIds: ids,
    sourceTitle: decision.sceneName ?? path.basename(source),
    quality: decision.quality,
    downloadId: downloadId ?? null,
    data: stringData({ droppedPath: source, importedPath, downloadClient: opts.downloadClient, downloadId, releaseGroup: decision.releaseGroup }),
  });
  if (media.importExtraFiles) await importExtraFiles(app, source, importedPath, media);

  app.events.publish('episodefile', 'created', { id, seriesId: series.id });
  app.events.publish('episode', 'updated', { seriesId: series.id, episodeIds: ids });
  return { decision, result: 'imported', message: `Imported ${path.basename(importedPath)}`, importedPath };
}

/**
 * Imports the approved decisions (largest multi-episode files first; an episode is imported once per batch)
 * and returns one result per decision in input order. A failed transfer leaves the source untouched.
 */
export async function importDecisions(app: FastifyInstance, decisions: readonly ImportDecision[], opts: ImportOptions): Promise<ImportResult[]> {
  const media = getMediaManagementConfig(app.db);
  const results = new Map<ImportDecision, ImportResult>();
  const order = decisions
    .filter((d) => d.approved && d.series)
    .sort((a, b) => b.episodes.length - a.episodes.length || b.source.size - a.source.size);
  const claimed = new Set<number>();
  const touched = new Set<number>();
  for (const d of order) {
    if (d.episodes.some((e) => claimed.has(e.id))) {
      results.set(d, { decision: d, result: 'rejected', message: 'Episode(s) already imported from another file in this download' });
      continue;
    }
    let r: ImportResult;
    try {
      r = await importOne(app, d, opts, media);
    } catch (err) {
      app.log.warn({ err, source: d.source.path }, 'Import failed');
      r = { decision: d, result: 'failed', message: `Failed to import ${path.basename(d.source.path)}: ${errorMessage(err)}` };
    }
    results.set(d, r);
    if (r.result === 'imported') {
      d.episodes.forEach((e) => claimed.add(e.id));
      touched.add(d.series!.id);
    }
  }
  for (const id of touched) app.events.publish('series', 'updated', { id });
  return decisions.map(
    (d) =>
      results.get(d) ?? {
        decision: d,
        result: 'rejected',
        message: d.rejections.map((r) => r.reason).join(', ') || 'Rejected',
      },
  );
}
