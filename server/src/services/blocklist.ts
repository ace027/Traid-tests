import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { BlocklistResource, Protocol, QualityModel } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';

export type BlocklistRow = typeof schema.blocklist.$inferSelect;

export interface BlocklistInput {
  seriesId: number;
  episodeIds: number[];
  sourceTitle: string;
  quality: QualityModel;
  protocol: Protocol;
  indexer?: string | null;
  size?: number | null;
  publishedDate?: string | null;
  message?: string | null;
  torrentInfoHash?: string | null;
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function toBlocklistResource(row: BlocklistRow): BlocklistResource {
  const r: BlocklistResource = {
    id: row.id,
    seriesId: row.seriesId,
    episodeIds: JSON.parse(row.episodeIds) as number[],
    sourceTitle: row.sourceTitle,
    quality: JSON.parse(row.quality) as QualityModel,
    date: row.date,
    protocol: row.protocol as Protocol,
  };
  if (row.publishedDate) r.publishedDate = row.publishedDate;
  if (row.size !== null) r.size = row.size;
  if (row.indexer) r.indexer = row.indexer;
  if (row.message) r.message = row.message;
  return r;
}

export function addToBlocklist(app: FastifyInstance, input: BlocklistInput): BlocklistRow {
  const row = app.db
    .insert(schema.blocklist)
    .values({
      seriesId: input.seriesId,
      episodeIds: JSON.stringify(input.episodeIds),
      sourceTitle: input.sourceTitle,
      quality: JSON.stringify(input.quality),
      date: new Date().toISOString(),
      publishedDate: input.publishedDate ?? null,
      size: input.size ?? null,
      protocol: input.protocol,
      indexer: input.indexer ?? null,
      message: input.message ?? null,
      torrentInfoHash: input.torrentInfoHash?.toLowerCase() ?? null,
    })
    .returning()
    .get();
  app.events.publish('blocklist', 'created', toBlocklistResource(row) as unknown as Record<string, unknown>);
  return row;
}

/**
 * Sonarr semantics: when both the release and the entry carry an info hash they must be equal;
 * otherwise the normalized title and the indexer must match.
 */
export function isBlocklisted(
  db: Db,
  seriesId: number,
  release: { title: string; torrentInfoHash?: string | null; indexer?: string | null; publishDate?: string | null },
): boolean {
  const rows = db.select().from(schema.blocklist).where(eq(schema.blocklist.seriesId, seriesId)).all();
  const hash = release.torrentInfoHash?.toLowerCase();
  const title = normalizeTitle(release.title);
  const indexer = (release.indexer ?? '').toLowerCase();
  return rows.some((row) => {
    if (hash && row.torrentInfoHash) return row.torrentInfoHash === hash;
    return normalizeTitle(row.sourceTitle) === title && (row.indexer ?? '').toLowerCase() === indexer;
  });
}
