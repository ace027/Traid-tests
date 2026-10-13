import { describe, expect, it } from 'vitest';
import { createNewznabClient } from './newznab.js';
import { IndexerError, type IndexerRow, type SearchCriteria } from './types.js';

const NOW = new Date('2024-05-05T00:00:00Z');

function row(over: Partial<IndexerRow> = {}, settings: Record<string, unknown> = {}): IndexerRow {
  return {
    id: 7,
    name: 'Idx',
    implementation: 'newznab',
    settings: JSON.stringify({
      baseUrl: 'http://idx.test/',
      apiPath: '/api',
      apiKey: 'SECRETKEY',
      categories: [5030, 5040],
      animeCategories: [5070],
      ...settings,
    }),
    enableRss: true,
    enableAutomaticSearch: true,
    enableInteractiveSearch: true,
    priority: 10,
    tags: '[]',
    added: NOW.toISOString(),
    ...over,
  };
}

function fakeFetch(body: string | ((url: string) => Response | Promise<Response>), status = 200) {
  const urls: string[] = [];
  const fn = (async (url: string) => {
    urls.push(String(url));
    if (typeof body === 'function') return body(String(url));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, urls };
}

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;

const nzbItem = `<item><title>Show.S01E01.1080p</title><guid>abc</guid><link>http://idx.test/details/abc</link>
<comments>http://idx.test/comments/abc</comments><pubDate>Tue, 02 Jan 2024 10:30:00 +0000</pubDate>
<enclosure url="http://idx.test/getnzb/abc?x=1&amp;y=2" length="1048576" type="application/x-nzb"/>
<newznab:attr name="category" value="5040"/><newznab:attr name="tvdbid" value="81189"/><newznab:attr name="imdb" value="0903747"/></item>`;

const q = (u: string) => new URL(u).searchParams;
const series = { title: "Marvel's Agents: S.H.I.E.L.D.", tvdbId: 123, tvMazeId: 5, imdbId: 'tt1', cleanTitle: 'marvels agents shield' };

describe('newznab client', () => {
  it('parses a newznab feed', async () => {
    const f = fakeFetch(rss(nzbItem));
    const c = createNewznabClient(row(), { fetch: f.fn, now: () => NOW });
    const [r] = await c.fetchRss();
    expect(r).toMatchObject({
      guid: 'abc',
      title: 'Show.S01E01.1080p',
      size: 1048576,
      publishDate: '2024-01-02T10:30:00.000Z',
      downloadUrl: 'http://idx.test/getnzb/abc?x=1&y=2',
      infoUrl: 'http://idx.test/comments/abc',
      indexerId: 7,
      indexer: 'Idx',
      indexerPriority: 10,
      protocol: 'usenet',
      tvdbId: 81189,
      categories: [5040],
    });
    expect(r!.imdbId).toBe('0903747');
    const p = q(f.urls[0]!);
    expect(p.get('t')).toBe('tvsearch');
    expect(p.get('apikey')).toBe('SECRETKEY');
    expect(p.get('cat')).toBe('5030,5040');
    expect(p.get('extended')).toBe('1');
    expect(p.get('limit')).toBe('100');
    expect(p.has('q')).toBe(false);
    expect(f.urls[0]!.startsWith('http://idx.test/api?')).toBe(true);
  });

  it('handles zero items, missing enclosure, bad pubDate', async () => {
    const empty = createNewznabClient(row(), { fetch: fakeFetch(rss('')).fn, now: () => NOW });
    expect(await empty.fetchRss()).toEqual([]);
    const c = createNewznabClient(row(), {
      fetch: fakeFetch(
        rss(
          `<item><title>No Enclosure</title><link>http://idx.test/dl/1</link><pubDate>not a date</pubDate><newznab:attr name="size" value="999"/><newznab:attr name="usenetdate" value="Wed, 03 Jan 2024 00:00:00 +0000"/></item>
           <item><title>Bad Date</title><link>http://idx.test/dl/2</link><pubDate>garbage</pubDate></item>
           <item><title>No url</title></item>`,
        ),
      ).fn,
      now: () => NOW,
    });
    const rs = await c.fetchRss();
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({ downloadUrl: 'http://idx.test/dl/1', size: 999, publishDate: '2024-01-03T00:00:00.000Z', guid: 'http://idx.test/dl/1' });
    expect(rs[1]!.publishDate).toBe(NOW.toISOString());
  });

  it('composes episode, season, daily and anime searches', async () => {
    const calls: [SearchCriteria, Record<string, string | null>][] = [
      [{ type: 'episode', series, seasonNumber: 2, episodeNumbers: [3] }, { t: 'tvsearch', tvdbid: '123', season: '2', ep: '3', q: null }],
      [{ type: 'episode', series: { ...series, tvdbId: null }, seasonNumber: 2, episodeNumbers: [3] }, { t: 'tvsearch', tvdbid: null, q: 'Marvel s Agents S H I E L D' }],
      [{ type: 'season', series, seasonNumber: 4 }, { t: 'tvsearch', season: '4', ep: null }],
      [{ type: 'daily', series, airDate: '2024-03-07' }, { t: 'tvsearch', season: '2024', ep: '03/07' }],
      [{ type: 'anime', series, absoluteEpisodeNumbers: [12] }, { t: 'search', q: 'Marvel s Agents S H I E L D 12', cat: '5070', tvdbid: null }],
    ];
    for (const [criteria, expected] of calls) {
      const f = fakeFetch(rss(''));
      await createNewznabClient(row(), { fetch: f.fn, now: () => NOW }).search(criteria);
      const p = q(f.urls[0]!);
      for (const [k, v] of Object.entries(expected)) expect(p.get(k), `${criteria.type} ${k}`).toBe(v);
    }
  });

  it('parses torznab seeders, infohash and magnet-only items', async () => {
    const xml = rss(`
      <item><title>T1</title><guid>t1</guid><link>http://t/dl/1</link><enclosure url="http://t/dl/1" length="500" type="application/x-bittorrent"/>
        <torznab:attr name="seeders" value="12"/><torznab:attr name="peers" value="20"/><torznab:attr name="infohash" value="ABCDEF1234"/><torznab:attr name="magneturl" value="magnet:?xt=urn:btih:ABCDEF1234"/></item>
      <item><title>T2 magnet only</title><guid>t2</guid><link>magnet:?xt=urn:btih:DEADBEEF&amp;dn=x</link><torznab:attr name="seeders" value="3"/></item>`);
    const c = createNewznabClient(row({ implementation: 'torznab' }), { fetch: fakeFetch(xml).fn, now: () => NOW });
    const [a, b] = await c.fetchRss();
    expect(a).toMatchObject({ protocol: 'torrent', seeders: 12, leechers: 8, infoHash: 'abcdef1234', magnetUrl: 'magnet:?xt=urn:btih:ABCDEF1234', size: 500 });
    expect(b).toMatchObject({ downloadUrl: 'magnet:?xt=urn:btih:DEADBEEF&dn=x', magnetUrl: 'magnet:?xt=urn:btih:DEADBEEF&dn=x', infoHash: 'deadbeef', seeders: 3, size: 0 });
  });

  it('maps errors and never leaks the apikey', async () => {
    const run = (body: string, status = 200) =>
      createNewznabClient(row(), { fetch: fakeFetch(body, status).fn, now: () => NOW }).fetchRss();
    await expect(run('<error code="100" description="bad"/>')).rejects.toThrow('Invalid API key');
    await expect(run('<error code="102" description="bad"/>')).rejects.toThrow('Invalid API key');
    await expect(run('', 401)).rejects.toThrow('Invalid API key');
    await expect(run('', 403)).rejects.toBeInstanceOf(IndexerError);
    await expect(run('<error code="500" description="Boom"/>')).rejects.toThrow('Boom (code 500)');
    await expect(run('', 429)).rejects.toThrow(/rate limit.*try again/);
    await expect(run('<html><body>Cloudflare</body></html>')).rejects.toThrow(/invalid response/);
    await expect(run('', 500)).rejects.toThrow('HTTP 500');

    const failing = fakeFetch(() => {
      throw new Error('connect ECONNREFUSED http://idx.test/api?t=tvsearch&apikey=SECRETKEY&cat=1');
    });
    const err = await createNewznabClient(row(), { fetch: failing.fn, now: () => NOW }).fetchRss().catch((e: Error) => e);
    expect((err as Error).message).toContain('ECONNREFUSED');
    expect((err as Error).message).not.toContain('SECRETKEY');
  });

  it('test() requires tv-search in caps', async () => {
    const ok = fakeFetch('<caps><searching><tv-search available="yes" supportedParams="q"/></searching></caps>');
    await createNewznabClient(row(), { fetch: ok.fn, now: () => NOW }).test();
    expect(q(ok.urls[0]!).get('t')).toBe('caps');
    const bad = fakeFetch('<caps><searching><tv-search available="no"/></searching></caps>');
    await expect(createNewznabClient(row(), { fetch: bad.fn, now: () => NOW }).test()).rejects.toThrow(/tv-search/);
  });
});
