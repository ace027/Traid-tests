import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { monitorEpisodes, type MonitorOption } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';
import { parseQuality, parseTitle, type ParsedEpisodeInfo } from '../parser/index.js';

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

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** realpath of the deepest existing ancestor of p, re-joined with the missing remainder. */
export function realpathLoose(p: string): string {
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

export function realRootFolders(db: Db): string[] {
  return db.select().from(schema.rootFolders).all().map((r) => realpathLoose(r.path));
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

/** Parses a file name, falling back to the 'Season N' parent folder for the season number. */
function parseFile(file: string): ParsedEpisodeInfo | { fallback: { season: number; episode: number } & Pick<ParsedEpisodeInfo, 'quality' | 'releaseGroup'> } | null {
  const base = path.basename(file);
  const parsed = parseTitle(base);
  if (parsed && (parsed.isDaily || parsed.isAbsoluteNumbering || parsed.episodeNumbers.length > 0)) return parsed;
  const season = seasonFromFolder(path.basename(path.dirname(file)));
  if (season === undefined) return null;
  const stem = base.slice(0, base.length - path.extname(base).length);
  const m = /^(?:e|ep|episode)[ ._-]*(\d{1,3})(?!\d)/i.exec(stem) ?? /^(\d{1,3})(?![\dp])/i.exec(stem) ?? /\s-\s(\d{1,3})(?:\s|$|\.)/.exec(stem);
  if (!m) return null;
  const q = parseQuality(stem);
  return { fallback: { season, episode: Number(m[1]), quality: q, releaseGroup: undefined } };
}

interface WalkResult {
  files: string[];
  truncated: boolean;
}

async function walk(base: string, realBase: string): Promise<WalkResult> {
  const files: string[] = [];
  let entries = 0;
  let truncated = false;
  const visited = new Set<string>([realBase]);
  const stack: { logical: string; real: string; depth: number }[] = [{ logical: base, real: realBase, depth: 0 }];
  while (stack.length && !truncated) {
    const dir = stack.pop()!;
    let handle: fs.Dir;
    try {
      handle = await fs.promises.opendir(dir.logical);
    } catch {
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
  return { files, truncated };
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

  const removeRows = (ids: number[]) => {
    if (ids.length === 0) return;
    db.transaction((tx) => {
      for (const id of ids) {
        tx.update(schema.episodes).set({ episodeFileId: null }).where(eq(schema.episodes.episodeFileId, id)).run();
        tx.delete(schema.episodeFiles).where(eq(schema.episodeFiles.id, id)).run();
      }
    });
    result.removed += ids.length;
  };
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
    // series folder does not exist: unlink every file row whose file is gone
    removeRows(existingFiles.filter((f) => fileMissing(f.path)).map((f) => f.id));
    publish();
    return result;
  }
  if (!realRootFolders(db).some((r) => isInside(r, realBase))) {
    throw new Error('Series folder is outside root folders');
  }

  const { files, truncated } = await walk(series.path, realBase);
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
  for (const file of files) {
    let size: number;
    try {
      size = (await fs.promises.stat(file)).size;
    } catch {
      continue;
    }
    const p = parseFile(file);
    if (!p) {
      result.unparsed.push(`${rel(file)} (could not parse)`);
      continue;
    }
    let matched: EpisodeRow[] = [];
    let meta: Pick<ParsedEpisodeInfo, 'quality' | 'releaseGroup'>;
    if ('fallback' in p) {
      const e = bySE.get(`${p.fallback.season}:${p.fallback.episode}`);
      if (e) matched = [e];
      meta = p.fallback;
    } else {
      meta = p;
      if (p.isDaily && p.airDate) {
        matched = byDate.get(p.airDate) ?? [];
      } else {
        if (p.isAbsoluteNumbering) {
          matched = p.absoluteEpisodeNumbers.flatMap((n) => byAbs.get(n) ?? []);
        }
        if (matched.length === 0 && p.episodeNumbers.length > 0) {
          matched = p.episodeNumbers.flatMap((n) => bySE.get(`${p.seasonNumber}:${n}`) ?? []);
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
  const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));
  const acceptedPaths = new Set(accepted.map((c) => c.file));

  db.transaction((tx) => {
    for (const c of accepted) {
      const season = epById.get(c.episodeIds[0]!)!.seasonNumber;
      const quality = JSON.stringify(c.parsed.quality);
      const values = {
        seriesId,
        seasonNumber: season,
        relativePath: rel(c.file),
        path: c.file,
        size: c.size,
        quality,
        releaseGroup: c.parsed.releaseGroup ?? null,
      };
      const cur = existingByPath.get(c.file);
      let fileId: number;
      if (cur) {
        fileId = cur.id;
        const changed =
          cur.seasonNumber !== values.seasonNumber ||
          cur.relativePath !== values.relativePath ||
          cur.size !== values.size ||
          cur.quality !== values.quality ||
          cur.releaseGroup !== values.releaseGroup;
        if (changed) {
          tx.update(schema.episodeFiles).set(values).where(eq(schema.episodeFiles.id, cur.id)).run();
          result.updated++;
        }
      } else {
        // path is unique across series: take over a stale row of another series
        tx.delete(schema.episodeFiles).where(eq(schema.episodeFiles.path, c.file)).run();
        fileId = tx.insert(schema.episodeFiles).values({ ...values, dateAdded: nowIso }).returning().get().id;
        result.added++;
      }
      const want = new Set(c.episodeIds);
      for (const e of tx.select().from(schema.episodes).where(eq(schema.episodes.episodeFileId, fileId)).all()) {
        if (!want.has(e.id)) tx.update(schema.episodes).set({ episodeFileId: null }).where(eq(schema.episodes.id, e.id)).run();
      }
      for (const id of c.episodeIds) {
        if (epById.get(id)!.episodeFileId !== fileId) {
          tx.update(schema.episodes).set({ episodeFileId: fileId }).where(eq(schema.episodes.id, id)).run();
        }
      }
    }
    // rows that were not accepted this scan: gone from disk, or now unparsed/duplicate
    for (const f of existingFiles) {
      if (acceptedPaths.has(f.path)) continue;
      if (result.truncated && !fileMissing(f.path)) continue;
      tx.update(schema.episodes).set({ episodeFileId: null }).where(eq(schema.episodes.episodeFileId, f.id)).run();
      tx.delete(schema.episodeFiles).where(eq(schema.episodeFiles.id, f.id)).run();
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
