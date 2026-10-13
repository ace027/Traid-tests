import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getRenamePreview, renameFiles, RenameNotFoundError, seriesFileIds, type RenameOutcome } from '../services/rename.js';

const previewQuery = z.object({
  seriesId: z.coerce.number().int(),
  seasonNumber: z.coerce.number().int().min(0).optional(),
});

const intArray = z.array(z.number().int());
const renameFilesBody = z.object({ seriesId: z.number().int(), files: intArray.min(1) });
const renameSeriesBody = z.object({ seriesIds: intArray.min(1) });

function summarize(outcome: RenameOutcome): string {
  const lines = [`Renamed ${outcome.renamed} file${outcome.renamed === 1 ? '' : 's'}`];
  if (outcome.errors.length) lines.push(...outcome.errors);
  return lines.join('\n');
}

/** GET /api/v3/rename and the RenameFiles and RenameSeries commands. */
export async function renameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/rename', async (req, reply) => {
    const q = previewQuery.parse(req.query);
    try {
      return getRenamePreview(app, q.seriesId, q.seasonNumber);
    } catch (err) {
      if (err instanceof RenameNotFoundError) return reply.code(404).send({ message: 'NotFound' });
      throw err;
    }
  });

  app.commands.register('RenameFiles', async ({ body, updateMessage }) => {
    const parsed = renameFilesBody.safeParse(body);
    if (!parsed.success) throw new Error('seriesId and files are required');
    const outcome = await renameFiles(app, parsed.data.seriesId, parsed.data.files);
    if (outcome.renamed === 0 && outcome.errors.length > 0) throw new Error(summarize(outcome));
    updateMessage(summarize(outcome));
  });

  app.commands.register('RenameSeries', async ({ body, updateMessage }) => {
    const parsed = renameSeriesBody.safeParse(body);
    if (!parsed.success) throw new Error('seriesIds is required');
    const total: RenameOutcome = { renamed: 0, errors: [] };
    for (const id of new Set(parsed.data.seriesIds)) {
      try {
        const r = await renameFiles(app, id, seriesFileIds(app, id));
        total.renamed += r.renamed;
        total.errors.push(...r.errors);
      } catch (err) {
        total.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (total.renamed === 0 && total.errors.length > 0) throw new Error(summarize(total));
    updateMessage(summarize(total));
  });
}
