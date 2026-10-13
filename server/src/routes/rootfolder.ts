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

const SKIP_NAMES = new Set(['@eadir', '#recycle', '$recycle.bin', 'system volume information', 'lost+found']);
const MAX_UNMAPPED = 5000;

type UnmappedFolder = { name: string; path: string; relativePath: string };
type RootFolderResponse = Omit<RootFolder, 'unmappedFolders'> & { unmappedFolders: UnmappedFolder[] };

/** Direct subdirectories of the root folder that no series uses as its path. */
async function unmappedFolders(app: FastifyInstance, root: string): Promise<UnmappedFolder[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const used = new Set(app.db.select({ path: schema.series.path }).from(schema.series).all().map((r) => path.resolve(r.path)));
  const out: UnmappedFolder[] = [];
  for (const d of entries) {
    if (d.name.startsWith('.') || SKIP_NAMES.has(d.name.toLowerCase())) continue;
    const full = path.join(root, d.name);
    if (used.has(full)) continue;
    let isDir = d.isDirectory();
    if (!isDir && d.isSymbolicLink()) {
      try {
        isDir = (await fs.stat(full)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) out.push({ name: d.name, path: full, relativePath: d.name });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out.slice(0, MAX_UNMAPPED);
}

async function describe(app: FastifyInstance, row: { id: number; path: string }): Promise<RootFolderResponse> {
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
  return { id: row.id, path: row.path, accessible, freeSpace, unmappedFolders: accessible ? await unmappedFolders(app, row.path) : [] };
}

export async function rootFolderRoutes(app: FastifyInstance): Promise<void> {
  const find = (id: number) => app.db.select().from(schema.rootFolders).where(eq(schema.rootFolders.id, id)).get();
  const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

  app.get('/api/v3/rootfolder', async () => {
    const rows = app.db.select().from(schema.rootFolders).orderBy(schema.rootFolders.id).all();
    return Promise.all(rows.map((r) => describe(app, r)));
  });

  app.get<{ Params: { id: string } }>('/api/v3/rootfolder/:id', async (req, reply) => {
    const row = find(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return describe(app, row);
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
    const body = await describe(app, row);
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
