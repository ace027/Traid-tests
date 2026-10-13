import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QUALITIES, type ManualImportItem, type QualityModel } from '@sonarr/shared';
import { getImportDecisions, ImportSourceError } from '../import/decisions.js';
import { importDecisions } from '../import/importer.js';
import type { ImportDecision, ImportResult, TransferMode } from '../import/types.js';
import { transferModeFor } from '../services/downloadHandling.js';
import { getQueue } from '../services/queue.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const listQuery = z.object({
  folder: z.string().optional(),
  downloadId: z.string().optional(),
  seriesId: z.coerce.number().int().optional(),
  filterExistingFiles: bool.default(true),
});

const qualitySchema = z.object({
  quality: z.object({ id: z.number().int() }).passthrough(),
  revision: z.object({ version: z.number().int().min(1), real: z.number().int().min(0), isRepack: z.boolean() }),
});

const manualImportBody = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        seriesId: z.number().int(),
        episodeIds: z.array(z.number().int()).min(1),
        quality: qualitySchema,
        releaseGroup: z.string().optional(),
        downloadId: z.string().optional(),
      }),
    )
    .min(1),
  importMode: z.enum(['auto', 'move', 'copy']).default('auto'),
});

function toItem(d: ImportDecision, index: number, folder: string, folderIsFile: boolean): ManualImportItem {
  const ext = path.extname(d.source.path);
  const item: ManualImportItem = {
    id: index,
    path: d.source.path,
    relativePath: folderIsFile ? path.basename(d.source.path) : path.relative(folder, d.source.path),
    folderName: path.basename(path.dirname(d.source.path)),
    name: path.basename(d.source.path, ext),
    size: d.source.size,
    episodes: d.episodes.map((e) => ({ id: e.id, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, title: e.title })),
    quality: d.quality,
    rejections: d.rejections.map((r) => ({ reason: r.reason, type: r.type })),
  };
  if (d.series) item.series = { id: d.series.id, title: d.series.title };
  if (d.episodes[0]) item.seasonNumber = d.episodes[0].seasonNumber;
  if (d.releaseGroup) item.releaseGroup = d.releaseGroup;
  if (d.downloadId) item.downloadId = d.downloadId;
  return item;
}

/** GET /api/v3/manualimport (preview) and the ManualImport command. */
export async function manualImportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/manualimport', async (req, reply) => {
    const q = listQuery.parse(req.query);
    let folder = q.folder?.trim() ?? '';
    if (!folder && q.downloadId) folder = (await getQueue(app).findByDownloadId(q.downloadId))?.item.outputPath ?? '';
    if (!folder) return reply.code(400).send({ message: q.downloadId ? 'The download has no output path' : 'folder or downloadId is required' });
    if (!path.isAbsolute(folder)) return reply.code(400).send({ message: 'folder must be an absolute path' });
    const opts: Parameters<typeof getImportDecisions>[2] = { filterExistingFiles: q.filterExistingFiles };
    if (q.downloadId) opts.downloadId = q.downloadId;
    if (q.seriesId !== undefined) opts.seriesId = q.seriesId;
    try {
      const folderIsFile = fs.statSync(folder, { throwIfNoEntry: false })?.isFile() ?? false;
      const decisions = await getImportDecisions(app, folder, opts);
      return decisions.map((d, i) => toItem(d, i, folder, folderIsFile));
    } catch (err) {
      if (err instanceof ImportSourceError) return reply.code(400).send({ message: err.message });
      throw err;
    }
  });

  app.commands.register('ManualImport', async ({ body, updateMessage }) => {
    const parsed = manualImportBody.safeParse(body);
    if (!parsed.success) throw new Error('files is required: [{path, seriesId, episodeIds, quality}]');
    const { files, importMode } = parsed.data;
    const queue = getQueue(app);
    const lines: string[] = [];
    let imported = 0;

    for (const file of files) {
      const name = path.basename(file.path);
      try {
        const known = QUALITIES.find((x) => x.id === file.quality.quality.id);
        if (!known) {
          lines.push(`${name}: unknown quality`);
          continue;
        }
        if (!path.isAbsolute(file.path) || !fs.statSync(file.path, { throwIfNoEntry: false })?.isFile()) {
          lines.push(`${file.path}: file not found`);
          continue;
        }
        const quality: QualityModel = { quality: known, revision: file.quality.revision };
        const opts: Parameters<typeof getImportDecisions>[2] = { seriesId: file.seriesId, episodeIds: file.episodeIds, quality };
        if (file.releaseGroup) opts.releaseGroup = file.releaseGroup;
        if (file.downloadId) opts.downloadId = file.downloadId;
        const tracked = file.downloadId ? await queue.findByDownloadId(file.downloadId) : undefined;
        const mode: TransferMode = importMode !== 'auto' ? importMode : tracked ? transferModeFor(app.db, tracked) : 'move';

        const run = async (): Promise<ImportResult[]> => {
          const decisions = await getImportDecisions(app, file.path, opts);
          const importOpts: Parameters<typeof importDecisions>[2] = { mode };
          if (file.downloadId) importOpts.downloadId = file.downloadId;
          if (tracked) importOpts.downloadClient = tracked.clientName;
          return importDecisions(app, decisions, importOpts);
        };
        const results = file.downloadId ? await queue.withImportGuard(file.downloadId, run) : await run();
        if (!results) {
          lines.push(`${name}: an import of this download is already running`);
          continue;
        }
        for (const r of results) {
          if (r.result === 'imported') imported++;
          else lines.push(`${name}: ${r.message}`);
        }
      } catch (err) {
        lines.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    updateMessage([`Imported ${imported} of ${files.length} files`, ...lines].join('\n'));
  });
}
