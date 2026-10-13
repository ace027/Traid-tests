import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { QUALITIES, type MediaManagementConfig, type QualityModel, type Series } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';
import { mapEpisodes, mapSeries } from '../decision/engine.js';
import { compareQuality, isRevisionUpgrade } from '../decision/prioritize.js';
import { rejection } from '../decision/types.js';
import type { ReleaseInfo } from '../indexers/types.js';
import { buildEpisodeFileName, buildSeasonFolderName, type NamingEpisode } from '../naming/naming.js';
import { parseTitle, type ParsedEpisodeInfo } from '../parser/index.js';
import { VIDEO_EXTENSIONS } from '../services/diskScan.js';
import { findGrabbedByDownloadId, type HistoryRow } from '../services/history.js';
import { getMediaManagementConfig, getNamingConfig } from '../services/mediaConfig.js';
import { IMPORT_REJECTIONS as R, type EpisodeRow, type ImportDecision, type Rejection, type SeriesRow } from './types.js';

export const MAX_IMPORT_DEPTH = 3;
export const SAMPLE_MAX_BYTES = 70 * 1024 * 1024;
const MB = 1024 * 1024;

export class ImportSourceError extends Error {}

export interface DecisionOptions {
  /** Tracked download: its grabbed history supplies the series, episodes and quality. */
  downloadId?: string;
  /** Forces the series; with episodeIds forces the episodes too. */
  seriesId?: number;
  episodeIds?: number[];
  quality?: QualityModel;
  releaseGroup?: string;
  /** Leave out files that already are episode files (manual import listing). */
  filterExistingFiles?: boolean;
}

export const UNKNOWN_QUALITY: QualityModel = { quality: QUALITIES[0]!, revision: { version: 1, real: 0, isRepack: false } };

const isVideo = (p: string) => VIDEO_EXTENSIONS.has(path.extname(p).toLowerCase());
const isSampleFolder = (name: string) => /^samples?$/i.test(name);

export function isSample(filePath: string, size: number): boolean {
  if (path.basename(filePath).toLowerCase().includes('sample') && size < SAMPLE_MAX_BYTES) return true;
  return path
    .dirname(filePath)
    .split(/[\\/]/)
    .some((part) => isSampleFolder(part));
}

interface Candidate {
  path: string;
  size: number;
}

/** Video files below a folder (depth 3, hidden entries and sample folders/files skipped), sorted by path. */
async function walk(dir: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir, depth: 0 }];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(cur.dir, { withFileTypes: true });
    } catch (err) {
      if (cur.depth === 0) throw new ImportSourceError(`Unable to read folder ${dir}: ${(err as Error).message}`);
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(cur.dir, e.name);
      if (e.isDirectory()) {
        if (cur.depth + 1 <= MAX_IMPORT_DEPTH && !isSampleFolder(e.name)) stack.push({ dir: full, depth: cur.depth + 1 });
      } else if (e.isFile() && isVideo(e.name)) {
        try {
          const { size } = await fs.promises.stat(full);
          if (!isSample(full, size)) out.push({ path: full, size });
        } catch {
          // vanished while listing
        }
      }
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Parses a name; null unless it identifies episodes (a full season is not a file). */
function parseUseful(name: string): ParsedEpisodeInfo | null {
  const p = parseTitle(name);
  if (!p || p.fullSeason) return null;
  return p.isDaily || p.absoluteEpisodeNumbers.length > 0 || p.episodeNumbers.length > 0 ? p : null;
}

const titleOnly = (title: string): ReleaseInfo => ({
  guid: '',
  title,
  size: 0,
  publishDate: '',
  downloadUrl: '',
  indexerId: 0,
  indexer: '',
  indexerPriority: 0,
  protocol: 'usenet',
  categories: [],
});

export function grabbedRows(db: Db, downloadId: string): HistoryRow[] {
  for (const id of new Set([downloadId, downloadId.toLowerCase(), downloadId.toUpperCase()])) {
    const rows = findGrabbedByDownloadId(db, id);
    if (rows.length > 0) return rows;
  }
  return [];
}

const sortEpisodes = (eps: EpisodeRow[]) =>
  [...new Map(eps.map((e) => [e.id, e])).values()].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);

function toNamingEpisode(e: EpisodeRow): NamingEpisode {
  const n: NamingEpisode = { seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, title: e.title };
  if (e.airDate) n.airDate = e.airDate;
  if (e.absoluteEpisodeNumber !== null) n.absoluteEpisodeNumber = e.absoluteEpisodeNumber;
  return n;
}

/** Destination path of an episode file: series folder / season folder (when enabled) / naming result + extension. */
export function destinationFor(
  db: Db,
  input: { series: SeriesRow; episodes: EpisodeRow[]; quality: QualityModel; releaseGroup?: string; sceneName?: string },
  sourcePath: string,
): string {
  const naming = getNamingConfig(db);
  const episodes = sortEpisodes(input.episodes);
  const nameInput: Parameters<typeof buildEpisodeFileName>[0] = {
    series: { title: input.series.title, year: input.series.year, seriesType: input.series.seriesType as Series['seriesType'] },
    episodes: episodes.map(toNamingEpisode),
    quality: input.quality,
    originalFileName: path.basename(sourcePath),
  };
  if (input.releaseGroup) nameInput.releaseGroup = input.releaseGroup;
  if (input.sceneName) nameInput.sceneName = input.sceneName;
  const name = buildEpisodeFileName(nameInput, naming);
  const season = episodes[0]?.seasonNumber ?? 0;
  const dir = input.series.seasonFolder ? path.join(input.series.path, buildSeasonFolderName(season, naming)) : input.series.path;
  return path.join(dir, `${name}${path.extname(sourcePath)}`);
}

interface Context {
  app: FastifyInstance;
  opts: DecisionOptions;
  media: MediaManagementConfig;
  allSeries: SeriesRow[];
  episodesOf: (seriesId: number) => EpisodeRow[];
  tracked?: { series?: SeriesRow; episodeIds: number[]; quality: QualityModel; sceneName: string; releaseGroup?: string };
  /** Number of candidate files; history episodes apply to a lone file only. */
  fileCount: number;
}

interface Mapping {
  series?: SeriesRow;
  episodes: EpisodeRow[];
  quality: QualityModel;
  releaseGroup?: string;
  rejection?: Rejection;
}

function mapFile(ctx: Context, file: Candidate): Mapping {
  const { opts, tracked } = ctx;
  const parsedFile = parseUseful(path.basename(file.path));
  // "Show.S01E01.720p-GRP/abc123.mkv": obfuscated file names fall back to the folder name
  const parsedFolder = parseUseful(path.basename(path.dirname(file.path)));
  const parsed = parsedFile ?? parsedFolder;

  const known = (q: QualityModel | undefined) => (q && q.quality.id !== 0 ? q : undefined);
  const quality =
    opts.quality ?? known(parseTitle(path.basename(file.path))?.quality) ?? known(tracked?.quality) ?? known(parsedFolder?.quality) ?? UNKNOWN_QUALITY;
  const releaseGroup = opts.releaseGroup ?? parsedFile?.releaseGroup ?? parsedFolder?.releaseGroup ?? tracked?.releaseGroup;
  const base: Mapping = { episodes: [], quality };
  if (releaseGroup) base.releaseGroup = releaseGroup;

  let series: SeriesRow | undefined;
  if (opts.seriesId !== undefined) series = ctx.allSeries.find((s) => s.id === opts.seriesId);
  else if (tracked?.series) series = tracked.series;
  else if (parsed) series = mapSeries(titleOnly(parsed.releaseTitle), parsed, ctx.allSeries, {});
  else return { ...base, rejection: rejection(R.unparseable) };
  if (!series) return { ...base, rejection: rejection(R.unknownSeries) };
  base.series = series;

  const all = ctx.episodesOf(series.id);
  if (opts.episodeIds?.length) {
    const wanted = new Set(opts.episodeIds);
    const found = all.filter((e) => wanted.has(e.id));
    if (found.length !== wanted.size) return { ...base, rejection: rejection(R.episodesNotFound) };
    return { ...base, episodes: sortEpisodes(found) };
  }
  let episodes = parsed ? mapEpisodes(parsed, all) : [];
  if (episodes.length === 0 && tracked && tracked.series?.id === series.id && ctx.fileCount === 1) {
    const ids = new Set(tracked.episodeIds);
    episodes = all.filter((e) => ids.has(e.id));
  }
  if (episodes.length === 0) return { ...base, rejection: rejection(parsed ? R.episodesNotFound : R.unparseable) };
  return { ...base, episodes: sortEpisodes(episodes) };
}

function upgradeRejection(ctx: Context, file: Candidate, episodes: EpisodeRow[], quality: QualityModel): Rejection | null {
  const ids = [...new Set(episodes.flatMap((e) => (e.episodeFileId === null ? [] : [e.episodeFileId])))];
  if (ids.length === 0) return null;
  const existing = ctx.app.db.select().from(schema.episodeFiles).where(inArray(schema.episodeFiles.id, ids)).all();
  for (const f of existing) {
    if (f.path === file.path) continue;
    const q = JSON.parse(f.quality) as QualityModel;
    if (compareQuality(quality, q) <= 0) return rejection(R.notUpgrade);
    if (isRevisionUpgrade(quality, q) && ctx.media.downloadPropersAndRepacks !== 'preferAndUpgrade') return rejection(R.notUpgrade);
  }
  return null;
}

async function freeSpaceRejection(ctx: Context, series: SeriesRow, size: number): Promise<Rejection | null> {
  if (ctx.media.skipFreeSpaceCheckWhenImporting) return null;
  for (const target of [series.path, series.rootFolderPath]) {
    try {
      const st = await fs.promises.statfs(target);
      const free = Number(st.bavail) * Number(st.bsize);
      return free < size + ctx.media.minimumFreeSpaceWhenImporting * MB ? rejection(R.freeSpace) : null;
    } catch {
      // folder missing: try the root folder, else skip the check
    }
  }
  return null;
}

async function lockedRejection(file: string): Promise<Rejection | null> {
  try {
    const h = await fs.promises.open(file, 'r');
    await h.close();
    return null;
  } catch (err) {
    const c = (err as NodeJS.ErrnoException).code;
    return c === 'EBUSY' || c === 'EAGAIN' || c === 'ETXTBSY' ? rejection(R.locked, 'temporary') : null;
  }
}

/**
 * Lists the importable video files of a file or folder and decides for each whether it can be imported: maps
 * it to a series and episodes (forced options, then the tracked download's grab history, then the parsed name)
 * and runs the import specifications. Throws ImportSourceError when the source does not exist.
 */
export async function getImportDecisions(app: FastifyInstance, sourcePath: string, opts: DecisionOptions = {}): Promise<ImportDecision[]> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(sourcePath);
  } catch {
    throw new ImportSourceError(`Path does not exist: ${sourcePath}`);
  }
  const db = app.db;
  const single = st.isFile();
  let files: Candidate[] = single ? [{ path: sourcePath, size: st.size }] : await walk(sourcePath);
  if (opts.filterExistingFiles && files.length > 0) {
    const known = new Set(
      db
        .select({ path: schema.episodeFiles.path })
        .from(schema.episodeFiles)
        .where(inArray(schema.episodeFiles.path, files.map((f) => f.path)))
        .all()
        .map((r) => r.path),
    );
    files = files.filter((f) => !known.has(f.path));
  }

  const episodeCache = new Map<number, EpisodeRow[]>();
  const ctx: Context = {
    app,
    opts,
    media: getMediaManagementConfig(db),
    allSeries: db.select().from(schema.series).all(),
    episodesOf: (id) => {
      let eps = episodeCache.get(id);
      if (!eps) {
        eps = db.select().from(schema.episodes).where(eq(schema.episodes.seriesId, id)).all();
        episodeCache.set(id, eps);
      }
      return eps;
    },
    fileCount: files.length,
  };
  if (opts.downloadId) {
    const rows = grabbedRows(db, opts.downloadId);
    const first = rows[0];
    if (first) {
      const data = JSON.parse(first.data) as Record<string, string>;
      ctx.tracked = {
        episodeIds: rows.flatMap((r) => (r.episodeId === null ? [] : [r.episodeId])),
        quality: JSON.parse(first.quality) as QualityModel,
        sceneName: first.sourceTitle,
      };
      const series = ctx.allSeries.find((s) => s.id === first.seriesId);
      if (series) ctx.tracked.series = series;
      if (data.releaseGroup) ctx.tracked.releaseGroup = data.releaseGroup;
    }
  }

  const decisions: ImportDecision[] = [];
  for (const file of files) {
    const rejections: Rejection[] = [];
    const d: ImportDecision = { source: { path: file.path, size: file.size }, episodes: [], quality: UNKNOWN_QUALITY, rejections, approved: false };
    if (opts.downloadId) d.downloadId = opts.downloadId;
    if (ctx.tracked) d.sceneName = ctx.tracked.sceneName;
    decisions.push(d);

    if (!isVideo(file.path)) rejections.push(rejection(R.notVideo));
    if (single && isSample(file.path, file.size)) rejections.push(rejection(R.sample));
    if (rejections.length > 0) continue;

    const m = mapFile(ctx, file);
    d.quality = m.quality;
    if (m.releaseGroup) d.releaseGroup = m.releaseGroup;
    if (m.series) d.series = m.series;
    d.episodes = m.episodes;
    if (m.rejection) {
      rejections.push(m.rejection);
      continue;
    }
    const series = m.series!;
    const up = upgradeRejection(ctx, file, m.episodes, m.quality);
    if (up) rejections.push(up);
    const space = await freeSpaceRejection(ctx, series, file.size);
    if (space) rejections.push(space);
    const dest = destinationFor(db, { ...d, series, episodes: m.episodes }, file.path);
    const dup = db
      .select({ size: schema.episodeFiles.size })
      .from(schema.episodeFiles)
      .where(inArray(schema.episodeFiles.path, [dest, file.path]))
      .all()
      .some((f) => f.size === file.size);
    if (dup) rejections.push(rejection(R.alreadyImported));
    const locked = await lockedRejection(file.path);
    if (locked) rejections.push(locked);
    d.approved = rejections.length === 0;
  }
  return decisions;
}
