import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { rootFolderInputSchema, validationError, type RootFolder } from '@sonarr/shared';
import { schema } from '../db/index.js';

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function describe(row: { id: number; path: string }): Promise<RootFolder> {
  let accessible = false;
  let freeSpace: number | null = null;
  try {
    await fs.access(row.path);
    accessible = true;
    const st = await fs.statfs(row.path);
    freeSpace = Number(st.bavail) * Number(st.bsize);
  } catch {
    // inaccessible or statfs unsupported
  }
  return { id: row.id, path: row.path, accessible, freeSpace, unmappedFolders: [] };
}

export async function rootFolderRoutes(app: FastifyInstance): Promise<void> {
  const find = (id: number) => app.db.select().from(schema.rootFolders).where(eq(schema.rootFolders.id, id)).get();
  const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

  app.get('/api/v3/rootfolder', async () => {
    const rows = app.db.select().from(schema.rootFolders).orderBy(schema.rootFolders.id).all();
    return Promise.all(rows.map(describe));
  });

  app.get<{ Params: { id: string } }>('/api/v3/rootfolder/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return describe(row);
  });

  app.post('/api/v3/rootfolder', async (req, reply) => {
    const { path: raw } = rootFolderInputSchema.parse(req.body);
    if (!path.isAbsolute(raw)) throw validationError('path', 'Path must be an absolute path');
    const resolved = path.resolve(raw);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      throw validationError('path', `Folder '${resolved}' does not exist`);
    }
    if (!stat.isDirectory()) throw validationError('path', `'${resolved}' is not a directory`);
    for (const existing of app.db.select().from(schema.rootFolders).all()) {
      if (existing.path === resolved) throw validationError('path', 'Path is already configured as a root folder');
      if (isInside(existing.path, resolved)) {
        throw validationError('path', `Path is inside existing root folder '${existing.path}'`);
      }
      if (isInside(resolved, existing.path)) {
        throw validationError('path', `Path contains existing root folder '${existing.path}'`);
      }
    }
    const row = app.db.insert(schema.rootFolders).values({ path: resolved }).returning().get();
    const body = await describe(row);
    app.events.publish('rootfolder', 'created', body as unknown as Record<string, unknown>);
    return reply.code(201).send(body);
  });

  app.delete<{ Params: { id: string } }>('/api/v3/rootfolder/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    app.db.delete(schema.rootFolders).where(eq(schema.rootFolders.id, row.id)).run();
    app.events.publish('rootfolder', 'deleted', { id: row.id, path: row.path });
    return reply.code(200).send({});
  });
}
