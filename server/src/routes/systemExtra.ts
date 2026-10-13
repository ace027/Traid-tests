import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logLevels, type DiskSpaceResource, type HealthResource, type LogFileResource, type UpdateResource } from '@sonarr/shared';

const logQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  level: z.enum(logLevels).optional(),
});

export async function systemExtraRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/health', async (): Promise<HealthResource[]> => {
    // Computed on the first request; afterwards the scheduled check keeps it current.
    return app.health.current();
  });

  app.get('/api/v3/diskspace', async (): Promise<DiskSpaceResource[]> => app.health.diskSpace());

  app.get('/api/v3/log', async (req) => {
    const q = logQuerySchema.parse(req.query);
    return app.logs.entries(q);
  });

  app.get('/api/v3/log/file', async (): Promise<LogFileResource[]> => app.logs.listFiles());

  app.get<{ Params: { filename: string } }>('/api/v3/log/file/:filename', async (req, reply) => {
    const file = app.logs.filePath(req.params.filename);
    if (!file) return reply.code(404).send({ message: 'NotFound' });
    let body: Buffer;
    try {
      body = await fs.promises.readFile(file);
    } catch {
      // rotated away while reading
      return reply.code(404).send({ message: 'NotFound' });
    }
    return reply
      .header('content-disposition', `attachment; filename="${req.params.filename}"`)
      .type('text/plain; charset=utf-8')
      .send(body);
  });

  // Self-updating is out of scope; the Updates page shows a message instead.
  app.get('/api/v3/update', async (): Promise<UpdateResource[]> => []);
}
