import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  backupPath,
  BackupError,
  createBackup,
  deleteBackup,
  listBackups,
  registerBackupCommand,
  stageRestore,
} from '../services/backup.js';
import { registerHousekeeping } from '../services/housekeeping.js';

export interface Lifecycle {
  restart(): void | Promise<void>;
  shutdown(): void | Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    lifecycle: Lifecycle;
  }
}

const UPLOAD_LIMIT = 512 * 1024 * 1024;

/** Extracts the part named "file" from a multipart/form-data body. */
function multipartFile(body: Buffer, contentType: string): Buffer | undefined {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) return undefined;
  const delim = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(delim);
  while (pos >= 0) {
    const next = body.indexOf(delim, pos + delim.length);
    if (next < 0) return undefined;
    const headerEnd = body.indexOf('\r\n\r\n', pos + delim.length);
    if (headerEnd >= 0 && headerEnd < next) {
      const headers = body.toString('latin1', pos + delim.length, headerEnd);
      if (/name="file"/i.test(headers)) return body.subarray(headerEnd + 4, next - 2);
    }
    pos = next;
  }
  return undefined;
}

function defaultLifecycle(app: FastifyInstance): Lifecycle {
  return {
    async restart() {
      await app.close();
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', env: process.env });
      child.unref();
      process.exit(0);
    },
    async shutdown() {
      await app.close();
      process.exit(0);
    },
  };
}

async function routes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/zip', { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT }, (_req, body, done) => done(null, body));

  const nameParams = z.object({ name: z.string().min(1) });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ message: 'NotFound' });

  app.get('/api/v3/system/backup', async () => listBackups(app));

  app.post('/api/v3/system/backup', async (_req, reply) => {
    const b = createBackup(app, 'manual');
    app.events.publish('backup', 'created', b as unknown as Record<string, unknown>);
    return reply.code(201).send(b);
  });

  app.get('/api/v3/system/backup/:name/download', async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const file = backupPath(app, name);
    if (!file) return notFound(reply);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${name.replace(/"/g, '')}"`)
      .send(fs.createReadStream(file));
  });

  app.delete('/api/v3/system/backup/:name', async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const b = listBackups(app).find((x) => x.name === name);
    if (!b || !deleteBackup(app, name)) return notFound(reply);
    app.events.publish('backup', 'deleted', b as unknown as Record<string, unknown>);
    return {};
  });

  app.post('/api/v3/system/backup/restore/upload', { bodyLimit: UPLOAD_LIMIT }, async (req) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BackupError('Send the backup as application/zip or multipart field "file"');
    const type = String(req.headers['content-type'] ?? '');
    const zip = type.toLowerCase().startsWith('multipart/') ? multipartFile(body, type) : body;
    if (!zip || zip.length === 0) throw new BackupError('No backup file in the upload');
    stageRestore(app, zip);
    app.events.publish('backup', 'updated', { restoreStaged: true });
    return { restartRequired: true };
  });

  app.post('/api/v3/system/backup/restore/:name', async (req) => {
    const { name } = nameParams.parse(req.params);
    stageRestore(app, name);
    app.events.publish('backup', 'updated', { restoreStaged: true, name });
    return { restartRequired: true };
  });

  const control = (action: 'restart' | 'shutdown', message: string) =>
    app.post(
      `/api/v3/system/${action}`,
      {
        // Runs after the response has been sent.
        onResponse: async () => {
          void Promise.resolve(app.lifecycle[action]()).catch((e: unknown) => app.log.error(e));
        },
      },
      async () => ({ message }),
    );
  control('restart', 'Restarting');
  control('shutdown', 'Shutting down');
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  if (!app.hasDecorator('lifecycle')) app.decorate('lifecycle', defaultLifecycle(app));
  registerBackupCommand(app);
  registerHousekeeping(app);
  await app.register(routes);
}

// Run on the root instance so app.lifecycle is visible to the host and replaceable in tests.
(backupRoutes as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
