import type { FastifyInstance } from 'fastify';
import { makeDecisions } from '../decision/engine.js';
import { processDecisions, queryIndexers } from './search.js';

export interface RssSyncResult {
  found: number;
  grabbed: number;
}

/** Fetches every RSS-enabled indexer's feed, decides without search criteria and grabs one release per episode set. */
export async function rssSync(app: FastifyInstance): Promise<RssSyncResult> {
  const { releases } = await queryIndexers(app, 'rss', (client) => client.fetchRss());
  const decisions = await makeDecisions(app, releases, { interactive: false, now: new Date() });
  const { grabbed } = await processDecisions(app, decisions);
  return { found: releases.length, grabbed };
}

export function registerRssSync(app: FastifyInstance): void {
  app.commands.register('RssSync', async ({ updateMessage }) => {
    const { found, grabbed } = await rssSync(app);
    updateMessage(`RSS Sync Completed. Reports found: ${found}, Reports grabbed: ${grabbed}`);
  });
}
