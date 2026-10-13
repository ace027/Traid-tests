import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  QUALITIES,
  qualityDefinitionSchema,
  qualityProfileInputSchema,
  validationError,
  type Quality,
  type QualityDefinition,
} from '@sonarr/shared';
import { schema } from '../db/index.js';

const qualityById = new Map<number, Quality>(QUALITIES.map((q) => [q.id, q]));
const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

const definitionInput = qualityDefinitionSchema.superRefine((d, ctx) => {
  const check = (key: 'minSize' | 'maxSize' | 'preferredSize') => {
    const v = d[key];
    if (v !== null && v > 1000) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Must be between 0 and 1000' });
    }
  };
  check('minSize');
  check('maxSize');
  check('preferredSize');
  if (d.maxSize !== null && d.minSize > d.maxSize) {
    ctx.addIssue({ code: 'custom', path: ['minSize'], message: 'Min size cannot be greater than max size' });
  }
  if (d.preferredSize !== null) {
    if (d.preferredSize < d.minSize) {
      ctx.addIssue({ code: 'custom', path: ['preferredSize'], message: 'Preferred size cannot be less than min size' });
    }
    if (d.maxSize !== null && d.preferredSize > d.maxSize) {
      ctx.addIssue({ code: 'custom', path: ['preferredSize'], message: 'Preferred size cannot be greater than max size' });
    }
  }
});

type DefRow = typeof schema.qualityDefinitions.$inferSelect;
type ProfileRow = typeof schema.qualityProfiles.$inferSelect;

function toDefinition(row: DefRow): QualityDefinition {
  return {
    id: row.id,
    quality: qualityById.get(row.quality) ?? { id: row.quality, name: row.title, source: 'unknown', resolution: 0 },
    title: row.title,
    weight: row.weight,
    minSize: row.minSize,
    maxSize: row.maxSize,
    preferredSize: row.preferredSize,
  };
}

function toProfile(row: ProfileRow) {
  const stored = JSON.parse(row.items) as { quality: number; allowed: boolean }[];
  return {
    id: row.id,
    name: row.name,
    upgradeAllowed: row.upgradeAllowed,
    cutoff: row.cutoff,
    items: stored.flatMap((i) => {
      const quality = qualityById.get(i.quality);
      return quality ? [{ quality, items: [], allowed: i.allowed }] : [];
    }),
  };
}

export async function qualityRoutes(app: FastifyInstance): Promise<void> {
  const findDef = (id: number) =>
    app.db.select().from(schema.qualityDefinitions).where(eq(schema.qualityDefinitions.id, id)).get();
  const findProfile = (id: number) =>
    app.db.select().from(schema.qualityProfiles).where(eq(schema.qualityProfiles.id, id)).get();

  const saveDef = (d: QualityDefinition): QualityDefinition => {
    const row = app.db
      .update(schema.qualityDefinitions)
      .set({ title: d.title, minSize: d.minSize, maxSize: d.maxSize, preferredSize: d.preferredSize })
      .where(eq(schema.qualityDefinitions.id, d.id))
      .returning()
      .get();
    const out = toDefinition(row);
    app.events.publish('qualitydefinition', 'updated', out as unknown as Record<string, unknown>);
    return out;
  };

  // Quality definitions
  app.get('/api/v3/qualitydefinition', async () =>
    app.db.select().from(schema.qualityDefinitions).orderBy(schema.qualityDefinitions.weight).all().map(toDefinition),
  );

  app.put('/api/v3/qualitydefinition/update', async (req) => {
    const list = z.array(definitionInput).parse(req.body);
    for (const d of list) if (!findDef(d.id)) throw validationError('id', `Quality definition ${d.id} not found`);
    return app.db.transaction(() => list.map(saveDef));
  });

  app.get<{ Params: { id: string } }>('/api/v3/qualitydefinition/:id', async (req, reply) => {
    const row = findDef(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toDefinition(row);
  });

  app.put<{ Params: { id: string } }>('/api/v3/qualitydefinition/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const body = definitionInput.parse(req.body);
    if (!findDef(id)) return reply.code(404).send({ message: 'NotFound' });
    return saveDef({ ...body, id });
  });

  // Quality profiles
  const validateProfile = (p: z.infer<typeof qualityProfileInputSchema>, ignoreId?: number) => {
    const seen = new Set<number>();
    for (const item of p.items) {
      if (!qualityById.has(item.quality.id)) throw validationError('items', `Unknown quality ${item.quality.id}`);
      if (seen.has(item.quality.id)) throw validationError('items', `Duplicate quality ${item.quality.id}`);
      seen.add(item.quality.id);
    }
    const dup = app.db.select().from(schema.qualityProfiles).where(eq(schema.qualityProfiles.name, p.name)).get();
    if (dup && dup.id !== ignoreId) throw validationError('name', 'Name must be unique');
  };
  const itemsJson = (p: z.infer<typeof qualityProfileInputSchema>) =>
    JSON.stringify(p.items.map((i) => ({ quality: i.quality.id, allowed: i.allowed })));

  app.get('/api/v3/qualityprofile', async () =>
    app.db.select().from(schema.qualityProfiles).orderBy(schema.qualityProfiles.id).all().map(toProfile),
  );

  app.get('/api/v3/qualityprofile/schema', async () => ({
    id: 0,
    name: '',
    upgradeAllowed: false,
    cutoff: 0,
    items: QUALITIES.map((quality) => ({ quality, items: [], allowed: false })),
  }));

  app.get<{ Params: { id: string } }>('/api/v3/qualityprofile/:id', async (req, reply) => {
    const row = findProfile(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toProfile(row);
  });

  app.post('/api/v3/qualityprofile', async (req, reply) => {
    const body = qualityProfileInputSchema.parse(req.body);
    validateProfile(body);
    const row = app.db
      .insert(schema.qualityProfiles)
      .values({ name: body.name, upgradeAllowed: body.upgradeAllowed, cutoff: body.cutoff, items: itemsJson(body) })
      .returning()
      .get();
    const out = toProfile(row);
    app.events.publish('qualityprofile', 'created', out);
    return reply.code(201).send(out);
  });

  app.put<{ Params: { id: string } }>('/api/v3/qualityprofile/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const body = qualityProfileInputSchema.parse(req.body);
    if (!findProfile(id)) return reply.code(404).send({ message: 'NotFound' });
    validateProfile(body, id);
    const row = app.db
      .update(schema.qualityProfiles)
      .set({ name: body.name, upgradeAllowed: body.upgradeAllowed, cutoff: body.cutoff, items: itemsJson(body) })
      .where(eq(schema.qualityProfiles.id, id))
      .returning()
      .get();
    const out = toProfile(row);
    app.events.publish('qualityprofile', 'updated', out);
    return out;
  });

  app.delete<{ Params: { id: string } }>('/api/v3/qualityprofile/:id', async (req, reply) => {
    const row = findProfile(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    const inUse = app.db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.qualityProfileId, row.id)).limit(1).get();
    if (inUse) throw validationError('id', 'Quality profile is in use by a series');
    const count = app.db.select().from(schema.qualityProfiles).all().length;
    if (count <= 1) throw validationError('id', 'Cannot delete the last quality profile');
    app.db.delete(schema.qualityProfiles).where(eq(schema.qualityProfiles.id, row.id)).run();
    app.events.publish('qualityprofile', 'deleted', { id: row.id, name: row.name });
    return reply.code(200).send({});
  });
}
