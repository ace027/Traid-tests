import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validationError, type CalendarEpisode, type Series } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { toApiEpisode, toApiEpisodeFile } from '../services/episodes.js';
import { buildICalendar } from '../services/ical.js';
import { getSeries } from '../services/series.js';

const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 92;

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const tagList = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .refine((v) => v.every((s) => /^\d+$/.test(s)), 'tags must be a comma separated list of ids')
  .transform((v) => v.map(Number))
  .default([]);
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const calendarQuery = z.object({
  start: isoDate.optional(),
  end: isoDate.optional(),
  unmonitored: bool.default(false),
  includeSeries: bool.default(true),
  includeEpisodeFile: bool.default(false),
  tags: tagList,
});

const feedQuery = z.object({
  pastDays: z.coerce.number().int().min(0).max(365).default(7),
  futureDays: z.coerce.number().int().min(0).max(365).default(28),
  unmonitored: bool.default(false),
  premieresOnly: bool.default(false),
  asAllDay: bool.default(false),
  tags: tagList,
});

interface RangeQuery {
  start: Date;
  end: Date;
  unmonitored: boolean;
  tags: number[];
  includeSeries?: boolean;
  includeEpisodeFile?: boolean;
}

/** Episodes airing in [start, end], ordered by air time. Episodes with only an air date match on that date. */
export function queryCalendar(app: FastifyInstance, q: RangeQuery): CalendarEpisode[] {
  const startDay = q.start.toISOString().slice(0, 10);
  const endDay = q.end.toISOString().slice(0, 10);
  const conds = [
    or(
      and(gte(schema.episodes.airDateUtc, q.start.toISOString()), lte(schema.episodes.airDateUtc, q.end.toISOString())),
      and(isNull(schema.episodes.airDateUtc), gte(schema.episodes.airDate, startDay), lte(schema.episodes.airDate, endDay)),
    ),
  ];
  if (!q.unmonitored) conds.push(eq(schema.episodes.monitored, true), eq(schema.series.monitored, true));
  const rows = app.db
    .select({ e: schema.episodes, tags: schema.series.tags })
    .from(schema.episodes)
    .innerJoin(schema.series, eq(schema.series.id, schema.episodes.seriesId))
    .where(and(...conds))
    .orderBy(asc(sql`coalesce(${schema.episodes.airDateUtc}, ${schema.episodes.airDate})`), asc(schema.episodes.id))
    .all()
    .filter((r) => q.tags.length === 0 || (JSON.parse(r.tags) as number[]).some((t) => q.tags.includes(t)));

  const seriesCache = new Map<number, Series | undefined>();
  const files = new Map<number, ReturnType<typeof toApiEpisodeFile>>();
  if (q.includeEpisodeFile) {
    const ids = rows.map((r) => r.e.episodeFileId).filter((id): id is number => id !== null);
    for (let i = 0; i < ids.length; i += 500) {
      for (const f of app.db.select().from(schema.episodeFiles).where(inArray(schema.episodeFiles.id, ids.slice(i, i + 500))).all()) {
        files.set(f.id, toApiEpisodeFile(f));
      }
    }
  }
  return rows.map(({ e }) => {
    if (!seriesCache.has(e.seriesId)) seriesCache.set(e.seriesId, getSeries(app.db, e.seriesId));
    const out = toApiEpisode(e) as CalendarEpisode;
    if (q.includeSeries !== false) out.series = seriesCache.get(e.seriesId)!;
    const file = e.episodeFileId === null ? undefined : files.get(e.episodeFileId);
    if (file) out.episodeFile = file;
    return out;
  });
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/calendar', async (req): Promise<CalendarEpisode[]> => {
    const q = calendarQuery.parse(req.query);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = q.start ? new Date(q.start) : today;
    const end = q.end ? new Date(q.end) : new Date(start.getTime() + 7 * DAY_MS);
    if (end.getTime() < start.getTime()) throw validationError('end', 'end must not be before start');
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw validationError('end', `The date range must not exceed ${MAX_RANGE_DAYS} days`);
    }
    return queryCalendar(app, { start, end, unmonitored: q.unmonitored, tags: q.tags, includeSeries: q.includeSeries, includeEpisodeFile: q.includeEpisodeFile });
  });

  app.get('/feed/v3/calendar/sonarr.ics', async (req, reply) => {
    const q = feedQuery.parse(req.query);
    const now = new Date();
    const start = new Date(now.getTime() - q.pastDays * DAY_MS);
    const end = new Date(now.getTime() + q.futureDays * DAY_MS);
    let episodes = queryCalendar(app, { start, end, unmonitored: q.unmonitored, tags: q.tags });
    if (q.premieresOnly) episodes = episodes.filter((e) => e.episodeNumber === 1);
    return reply.header('content-type', 'text/calendar; charset=utf-8').send(buildICalendar(episodes, { asAllDay: q.asAllDay, now }));
  });
}
