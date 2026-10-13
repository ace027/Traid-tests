import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QUALITIES, type ReleaseResource } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { qualityWeight } from '../decision/prioritize.js';
import type { DownloadDecision } from '../decision/types.js';
import type { QualityModel } from '../parser/index.js';
import { grabRelease, stripApiKey } from '../services/grab.js';
import { releaseKey, searchEpisodes, searchSeason } from '../services/search.js';

export const RELEASE_CACHE_TTL_MS = 30 * 60_000;
export const RELEASE_CACHE_MAX = 5000;
export const RELEASE_CACHE_MISS = "Couldn't find requested release in cache, cache timeout probably expired.";

const UNKNOWN_QUALITY: QualityModel = { quality: QUALITIES[0]!, revision: { version: 1, real: 0, isRepack: false } };

/** LRU of interactive search decisions keyed by `${indexerId}:${guid}`. */
export class ReleaseCache {
  private readonly entries = new Map<string, { decision: DownloadDecision; expires: number }>();

  constructor(
    private readonly ttlMs = RELEASE_CACHE_TTL_MS,
    private readonly max = RELEASE_CACHE_MAX,
  ) {}

  set(decision: DownloadDecision, now = Date.now()): void {
    const key = releaseKey(decision.remoteEpisode.release);
    this.entries.delete(key);
    this.entries.set(key, { decision, expires: now + this.ttlMs });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }

  get(key: string, now = Date.now()): DownloadDecision | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= now) return undefined;
    this.entries.set(key, entry);
    return entry.decision;
  }

  get size(): number {
    return this.entries.size;
  }
}

export function toReleaseResource(decision: DownloadDecision, now = Date.now()): ReleaseResource {
  const { release, parsed, series, episodes } = decision.remoteEpisode;
  const quality = parsed?.quality ?? UNKNOWN_QUALITY;
  const ageMs = Math.max(0, now - (Date.parse(release.publishDate) || now));
  const r: ReleaseResource = {
    guid: release.guid,
    indexerId: release.indexerId,
    indexer: release.indexer,
    title: release.title,
    size: release.size,
    publishDate: release.publishDate,
    age: Math.floor(ageMs / 86_400_000),
    ageHours: Math.round((ageMs / 3_600_000) * 100) / 100,
    downloadUrl: stripApiKey(release.downloadUrl),
    protocol: release.protocol,
    quality,
    qualityWeight: qualityWeight(quality.quality.id),
    episodeIds: episodes.map((e) => e.id),
    seasonNumber: episodes[0]?.seasonNumber ?? parsed?.seasonNumber ?? 0,
    episodeNumbers: parsed?.episodeNumbers ?? [],
    absoluteEpisodeNumbers: parsed?.absoluteEpisodeNumbers ?? [],
    fullSeason: parsed?.fullSeason ?? false,
    languages: parsed?.languages ?? [],
    approved: decision.approved,
    temporarilyRejected: decision.temporarilyRejected,
    rejected: !decision.approved,
    rejections: decision.rejections.map((x) => x.reason),
    downloadAllowed: !!series && episodes.length > 0,
  };
  if (release.infoUrl) r.infoUrl = stripApiKey(release.infoUrl);
  if (release.seeders !== undefined) r.seeders = release.seeders;
  if (release.leechers !== undefined) r.leechers = release.leechers;
  if (series) {
    r.seriesId = series.id;
    r.seriesTitle = series.title;
  }
  if (parsed?.releaseGroup) r.releaseGroup = parsed.releaseGroup;
  return r;
}

const searchQuery = z
  .object({
    episodeId: z.coerce.number().int().positive().optional(),
    seriesId: z.coerce.number().int().positive().optional(),
    seasonNumber: z.coerce.number().int().min(0).optional(),
  })
  .refine((q) => q.episodeId !== undefined || (q.seriesId !== undefined && q.seasonNumber !== undefined), {
    message: 'episodeId or seriesId and seasonNumber are required',
    path: ['episodeId'],
  });

const grabBody = z.object({
  guid: z.string().min(1),
  indexerId: z.number().int(),
});

export async function releaseRoutes(app: FastifyInstance): Promise<void> {
  const cache = new ReleaseCache();

  app.get('/api/v3/release', async (req, reply) => {
    const q = searchQuery.parse(req.query);
    let decisions: DownloadDecision[];
    if (q.episodeId !== undefined) {
      const ep = app.db.select({ id: schema.episodes.id }).from(schema.episodes).where(eq(schema.episodes.id, q.episodeId)).get();
      if (!ep) return reply.code(404).send({ message: 'NotFound' });
      decisions = await searchEpisodes(app, [q.episodeId], { interactive: true });
    } else {
      const series = app.db.select().from(schema.series).where(eq(schema.series.id, q.seriesId!)).get();
      if (!series) return reply.code(404).send({ message: 'NotFound' });
      decisions = await searchSeason(app, series, q.seasonNumber!, { interactive: true });
    }
    const now = Date.now();
    for (const d of decisions) cache.set(d, now);
    return decisions.map((d) => toReleaseResource(d, now));
  });

  app.post('/api/v3/release', async (req, reply) => {
    const body = grabBody.parse(req.body);
    const decision = cache.get(releaseKey(body));
    if (!decision) return reply.code(404).send({ message: RELEASE_CACHE_MISS });
    try {
      await grabRelease(app, decision, { interactive: true });
    } catch (err) {
      return reply.code(409).send({ message: err instanceof Error ? err.message : 'Unable to grab the release' });
    }
    return reply.code(200).send(toReleaseResource(decision));
  });
}
