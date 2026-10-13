import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { monitorEpisodes, type MonitorOption } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { parseQuality, parseTitle, type ParsedEpisodeInfo } from '../parser/index.js';
import { upsertEpisodeFile, unlinkEpisodeFile } from './episodeFiles.js';
import { isInside, realRootFolders } from './paths.js';

export const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.m4v', '.wmv', '.ts', '.mov', '.webm', '.mpg', '.mpeg', '.m2ts',
]);
export const MAX_DEPTH = 4;
export const MAX_ENTRIES = 20000;
const SKIP_DIRS = new Set(['extras', 'featurettes', '@eadir', '#recycle', '$recycle.bin', 'lost+found']);

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  unparsed: string[];
  truncated: boolean;
}

interface Candidate {
  file: string; // logical absolute path
  size: number;
  parsed: Pick<ParsedEpisodeInfo, 'quality' | 'releaseGroup'>;
  episodeIds: number[];
}

type EpisodeRow = typeof schema.episodes.$inferSelect;

function seasonFromFolder(name: string): number | undefined {
  const m = /^season[ ._-]*(\d{1,3})$/i.exec(name);
  if (m) return Number(m[1]);
  if (/^specials?$/i.test(name)) return 0;
  return undefined;
}

const EPISODE_PREFIXED_RE = /^(?:e|ep|episode)[ ._-]*(\d{1,3})(?!\d)/i;
const LEADING_NUMBER_RE = /^(\d{1,3})(?![\dp])/i;
const DASH_NUMBER_RE = /\s-\s(\d{1,3})(?:\s|$|\.)/;

type FileMeta = Pick<ParsedEpisodeInfo, 'quality' | 'releaseGroup'>;
type ParsedFile =
  | { kind: 'title'; parsed: ParsedEpisodeInfo }
  | ({ kind: 'folder'; season: number; episode: number } & FileMeta);

/** Parses a file name, falling back to the 'Season N' parent folder for the season number. */
function parseFile(file: string): ParsedFile | null {
  const base = path.basename(file);
  const parsed = parseTitle(base);
  if (parsed && (parsed.isDaily || parsed.isAbsoluteNumbering || parsed.episodeNumbers.length > 0)) return { kind: 'title', parsed };
  const season = seasonFromFolder(path.basename(path.dirname(file)));
  if (season === undefined) return null;
  const stem = base.slice(0, base.length - path.extname(base).length);
  const m = EPISODE_PREFIXED_RE.exec(stem) ?? LEADING_NUMBER_RE.exec(stem) ?? DASH_NUMBER_RE.exec(stem);
  if (!m) return null;
  return { kind: 'folder', season, episode: Number(m[1]), quality: parseQuality(stem), releaseGroup: undefined };
}

interface WalkResult {
  files: string[];
  truncated: boolean;
  rootUnreadable: boolean;
  unreadableDirs: string[];
}

async function walk(base: string, realBase: string): Promise<WalkResult> {
  const files: string[] = [];
  let entries = 0;
  let truncated = false;
  let rootUnreadable = false;
  const unreadableDirs: string[] = [];
  const visited = new Set<string>([realBase]);
  const stack: { logical: string; real: string; depth: number }[] = [{ logical: base, real: realBase, depth: 0 }];
  while (stack.length && !truncated) {
    const dir = stack.pop()!;
    let handle: fs.Dir;
    try {
      handle = await fs.promises.opendir(dir.logical);
    } catch {
      if (dir.depth === 0) rootUnreadable = true;
      else unreadableDirs.push(dir.logical);
      continue;
    }
    try {
      for await (const d of handle) {
        if (++entries > MAX_ENTRIES) {
          truncated = true;
          break;
        }
        if (d.name.startsWith('.')) continue;
        const logical = path.join(dir.logical, d.name);
        let real = path.join(dir.real, d.name);
        let isDir = d.isDirectory();
        let isFile = d.isFile();
        if (d.isSymbolicLink()) {
          try {
            real = await fs.promises.realpath(logical);
            const st = await fs.promises.stat(real);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue; // dangling link
          }
          if (!isInside(realBase, real)) continue; // never follow outside the series folder
        }
        if (isDir) {
          if (dir.depth + 1 > MAX_DEPTH || SKIP_DIRS.has(d.name.toLowerCase())) continue;
          if (visited.has(real)) continue; // symlink loop or duplicate path
          visited.add(real);
          stack.push({ logical, real, depth: dir.depth + 1 });
        } else if (isFile) {
          if (!VIDEO_EXTENSIONS.has(path.extname(d.name).toLowerCase())) continue;
          if (d.name.toLowerCase().includes('sample')) continue;
          files.push(logical);
        }
      }
    } finally {
      await handle.close().catch(() => {});
    }
  }
  files.sort();
  return { files, truncated, rootUnreadable, unreadableDirs };
}

function fileMissing(p: string): boolean {
  try {
    fs.statSync(p);
    return false;
  } catch {
    return true;
  }
}

export async function scanSeries(app: FastifyInstance, seriesId: number): Promise<ScanResult> {
  const db = app.db;
  const series = db.select().from(schema.series).where(eq(schema.series.id, seriesId)).get();
  if (!series) throw new Error(`Series ${seriesId} not found`);
  const result: ScanResult = { added: 0, updated: 0, removed: 0, unparsed: [], truncated: false };

  const existingFiles = db.select().from(schema.episodeFiles).where(eq(schema.episodeFiles.seriesId, seriesId)).all();

  const publish = () => {
    if (result.added || result.updated || result.removed) {
      app.events.publish('episodefile', 'updated', { seriesId });
      app.events.publish('episode', 'updated', { seriesId });
    }
    app.events.publish('series', 'updated', { id: seriesId });
  };

  let realBase: string;
  try {
    realBase = fs.realpathSync(series.path);
  } catch {
    // Missing folder (unmounted share, rename): never unlink anything, it may be transient.
    if (existingFiles.length > 0) throw new Error(`Series folder is not accessible: ${series.path}`);
    publish();
    return result;
  }
  if (!realRootFolders(db).some((r) => isInside(r.real, realBase))) {
    throw new Error('Series folder is outside root folders');
  }

  const { files, truncated, rootUnreadable, unreadableDirs } = await walk(series.path, realBase);
  if (rootUnreadable && existingFiles.length > 0) {
    throw new Error(`Series folder could not be read: ${series.path}`);
  }
  result.truncated = truncated;

  const episodes = db.select().from(schema.episodes).where(eq(schema.episodes.seriesId, seriesId)).all();
  const bySE = new Map<string, EpisodeRow>();
  const byDate = new Map<string, EpisodeRow[]>();
  const byAbs = new Map<number, EpisodeRow>();
  for (const e of episodes) {
    bySE.set(`${e.seasonNumber}:${e.episodeNumber}`, e);
    if (e.airDate) {
      const l = byDate.get(e.airDate) ?? [];
      l.push(e);
      byDate.set(e.airDate, l);
    }
  }
  const hasStoredAbs = episodes.some((e) => e.absoluteEpisodeNumber !== null);
  const regular = episodes
    .filter((e) => e.seasonNumber > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  regular.forEach((e, i) => {
    const n = hasStoredAbs ? e.absoluteEpisodeNumber : i + 1;
    if (n !== null && !byAbs.has(n)) byAbs.set(n, e);
  });

  const rel = (f: string) => path.relative(series.path, f);
  const candidates: Candidate[] = [];
  const statFailed = new Set<string>();
  for (const file of files) {
    let size: number;
    try {
      size = (await fs.promises.stat(file)).size;
    } catch {
      statFailed.add(file); // transient? keep any existing row
      continue;
    }
    const p = parseFile(file);
    if (!p) {
      result.unparsed.push(`${rel(file)} (could not parse)`);
      continue;
    }
    let matched: EpisodeRow[] = [];
    let meta: Pick<ParsedEpisodeInfo, 'quality' | 'releaseGroup'>;
    if (p.kind === 'folder') {
      const e = bySE.get(`${p.season}:${p.episode}`);
      if (e) matched = [e];
      meta = p;
    } else {
      const t = p.parsed;
      meta = t;
      if (t.isDaily && t.airDate) {
        matched = byDate.get(t.airDate) ?? [];
      } else {
        if (t.isAbsoluteNumbering) {
          matched = t.absoluteEpisodeNumbers.flatMap((n) => byAbs.get(n) ?? []);
        }
        if (matched.length === 0 && t.episodeNumbers.length > 0) {
          matched = t.episodeNumbers.flatMap((n) => bySE.get(`${t.seasonNumber}:${n}`) ?? []);
        }
      }
    }
    matched = [...new Map(matched.map((e) => [e.id, e])).values()];
    if (matched.length === 0) {
      result.unparsed.push(`${rel(file)} (no matching episode)`);
      continue;
    }
    candidates.push({ file, size, parsed: meta, episodeIds: matched.map((e) => e.id) });
  }

  // two files for one episode: keep the larger, report the other
  candidates.sort((a, b) => b.size - a.size || (a.file < b.file ? -1 : 1));
  const claimed = new Set<number>();
  const accepted: Candidate[] = [];
  for (const c of candidates) {
    if (c.episodeIds.some((id) => claimed.has(id))) {
      result.unparsed.push(`${rel(c.file)} (duplicate of a larger file for the same episode)`);
      continue;
    }
    c.episodeIds.forEach((id) => claimed.add(id));
    accepted.push(c);
  }
  result.unparsed.sort();

  const epById = new Map(episodes.map((e) => [e.id, e]));
  const now = new Date();
  const nowIso = now.toISOString();
  const acceptedPaths = new Set(accepted.map((c) => c.file));

  db.transaction((tx) => {
    for (const c of accepted) {
      const r = upsertEpisodeFile(tx, {
        seriesId,
        seasonNumber: epById.get(c.episodeIds[0]!)!.seasonNumber,
        path: c.file,
        relativePath: rel(c.file),
        size: c.size,
        quality: c.parsed.quality,
        releaseGroup: c.parsed.releaseGroup ?? null,
        episodeIds: c.episodeIds,
        dateAdded: nowIso,
      });
      if (r.added) result.added++;
      else if (r.updated) result.updated++;
    }
    // rows that were not accepted this scan: gone from disk, or now unparsed/duplicate
    for (const f of existingFiles) {
      if (acceptedPaths.has(f.path)) continue;
      if (result.truncated && !fileMissing(f.path)) continue;
      // unreadable subtree or failed stat: state unknown, never drop the row
      if (statFailed.has(f.path) || unreadableDirs.some((d) => f.path.startsWith(d + path.sep))) continue;
      unlinkEpisodeFile(tx, f.id);
      result.removed++;
    }

    if (series.addOptions) {
      let option: MonitorOption | undefined;
      try {
        option = (JSON.parse(series.addOptions) as { monitor?: MonitorOption }).monitor;
      } catch {
        option = undefined;
      }
      if (option) {
        const fresh = tx.select().from(schema.episodes).where(eq(schema.episodes.seriesId, seriesId)).all();
        const flags = monitorEpisodes(
          option,
          fresh.map((e) => ({
            seasonNumber: e.seasonNumber,
            episodeNumber: e.episodeNumber,
            airDateUtc: e.airDateUtc,
            hasFile: e.episodeFileId !== null,
          })),
          now,
        );
        const seasonOn = new Set<number>();
        fresh.forEach((e, i) => {
          if (flags[i]) seasonOn.add(e.seasonNumber);
          if (e.monitored !== flags[i]) tx.update(schema.episodes).set({ monitored: flags[i]! }).where(eq(schema.episodes.id, e.id)).run();
        });
        for (const s of tx.select().from(schema.seasons).where(eq(schema.seasons.seriesId, seriesId)).all()) {
          const on = s.seasonNumber > 0 && seasonOn.has(s.seasonNumber);
          if (s.monitored !== on) tx.update(schema.seasons).set({ monitored: on }).where(eq(schema.seasons.id, s.id)).run();
        }
      }
      tx.update(schema.series).set({ addOptions: null }).where(eq(schema.series.id, seriesId)).run();
    }
  });

  publish();
  return result;
}

export function registerRescanCommand(app: FastifyInstance): void {
  app.commands.register('RescanSeries', async ({ body, updateMessage }) => {
    const only = typeof body.seriesId === 'number' ? body.seriesId : undefined;
    const ids =
      only !== undefined
        ? [only]
        : app.db.select({ id: schema.series.id }).from(schema.series).orderBy(schema.series.id).all().map((r) => r.id);
    const total: ScanResult = { added: 0, updated: 0, removed: 0, unparsed: [], truncated: false };
    const errors: string[] = [];
    for (const id of ids) {
      try {
        const r = await scanSeries(app, id);
        total.added += r.added;
        total.updated += r.updated;
        total.removed += r.removed;
        total.truncated ||= r.truncated;
        total.unparsed.push(...r.unparsed);
      } catch (e) {
        if (ids.length === 1) throw e;
        errors.push(`Series ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const lines = [
      `Scanned ${ids.length - errors.length} series: ${total.added} added, ${total.updated} updated, ${total.removed} removed, ${total.unparsed.length} unparsed`,
    ];
    if (total.truncated) lines.push(`Scan stopped after ${MAX_ENTRIES} entries`);
    if (total.unparsed.length) {
      lines.push('Unparsed files:', ...total.unparsed.slice(0, 10));
      if (total.unparsed.length > 10) lines.push(`...and ${total.unparsed.length - 10} more`);
    }
    if (errors.length) throw new Error([...errors, ...lines].join('\n'));
    updateMessage(lines.join('\n'));
  });
}
