import { describe, expect, it, vi } from 'vitest';
import { TvMazeProvider } from './tvmaze.js';
import { MetadataError } from './types.js';

const show = {
  id: 82,
  name: 'Game of Thrones',
  status: 'Ended',
  premiered: '2011-04-17',
  runtime: 60,
  summary: '<p>Based on <b>the books</b> &amp; &quot;more&quot; &#39;x&#39; &lt;y&gt;.</p>',
  schedule: { time: '21:00', days: ['Sunday'] },
  network: { name: 'HBO' },
  externals: { thetvdb: 121361, imdb: 'tt0944947' },
  image: { medium: 'http://img/m.jpg', original: 'http://img/o.jpg' },
  genres: ['Drama'],
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function make(fetchImpl: (url: string) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string | URL | Request) => fetchImpl(String(url)));
  const sleep = vi.fn(async () => {});
  const provider = new TvMazeProvider({ fetch: fetch as unknown as typeof globalThis.fetch, sleep });
  return { provider, fetch, sleep };
}

describe('TvMazeProvider', () => {
  it('maps search results', async () => {
    const { provider, fetch } = make(() => json([{ score: 1, show }]));
    const [r] = await provider.search('game of thrones');
    expect(fetch.mock.calls[0]![0]).toContain('/search/shows?q=game%20of%20thrones');
    expect(r).toMatchObject({
      title: 'Game of Thrones',
      status: 'ended',
      year: 2011,
      network: 'HBO',
      tvdbId: 121361,
      imdbId: 'tt0944947',
      tvMazeId: 82,
      cleanTitle: 'gameofthrones',
      titleSlug: 'game-of-thrones',
    });
    expect(r!.images[0]).toMatchObject({ coverType: 'poster', url: 'http://img/o.jpg' });
  });

  it('strips HTML from summaries', async () => {
    const { provider } = make(() => json([{ show }]));
    const [r] = await provider.search('got');
    expect(r!.overview).toBe('Based on the books & "more" \'x\' <y>.');
  });

  it('routes tvdb: terms to the lookup endpoint', async () => {
    const { provider, fetch } = make(() => json(show));
    const res = await provider.search('tvdb:121361');
    expect(fetch.mock.calls[0]![0]).toContain('/lookup/shows?thetvdb=121361');
    expect(res).toHaveLength(1);
  });

  it('returns no results for an unknown lookup id', async () => {
    const { provider } = make(() => json({}, 404));
    expect(await provider.search('tvdb:1')).toEqual([]);
  });

  it('handles missing premiere year', async () => {
    const { provider } = make(() => json([{ show: { ...show, premiered: null } }]));
    const [r] = await provider.search('x');
    expect(r!.year).toBe(0);
    expect(r!.firstAired).toBeNull();
  });

  it('retries 429 honoring Retry-After', async () => {
    let n = 0;
    const { provider, sleep, fetch } = make(() => (n++ === 0 ? json({}, 429, { 'retry-after': '3' }) : json([{ show }])));
    const res = await provider.search('retry');
    expect(res).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('gives up with 503 after repeated failures', async () => {
    const { provider, fetch } = make(() => json({}, 500));
    await expect(provider.search('bad')).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('maps 404 on getSeries to MetadataError(404)', async () => {
    const { provider } = make(() => json({}, 404));
    const err = await provider.getSeries(1).catch((e) => e);
    expect(err).toBeInstanceOf(MetadataError);
    expect(err).toMatchObject({ status: 404, message: 'Series not found' });
  });

  it('reports unreachable network as 503', async () => {
    const provider = new TvMazeProvider({
      fetch: (async () => {
        throw new Error('down');
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(provider.search('x')).rejects.toMatchObject({ status: 503 });
  });

  it('serves repeated searches from the cache', async () => {
    const { provider, fetch } = make(() => json([{ show }]));
    await provider.search('Cache Me');
    await provider.search('cache me');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps episodes including specials and absolute numbers', async () => {
    const eps = [
      { id: 1, name: 'A', season: 1, number: 1, airdate: '2011-04-17', airstamp: '2011-04-18T01:00:00+00:00', runtime: 60, summary: '<p>x</p>' },
      { id: 2, name: 'B', season: 2, number: 1, airdate: '2012-04-01', airstamp: '2012-04-02T01:00:00+00:00' },
      { id: 3, name: 'Recap', season: 1, number: null, type: 'significant_special', airdate: '2011-05-01', airstamp: '2011-05-02T01:00:00+00:00' },
    ];
    const { provider } = make((url) =>
      url.includes('/episodes') ? json(eps) : json({ ...show, _embedded: { seasons: [{ number: 1 }, { number: 2 }] } }),
    );
    const { series, episodes } = await provider.getSeries(82);
    expect(series.seasons.map((s) => s.seasonNumber)).toEqual([0, 1, 2]);
    expect(episodes.map((e) => [e.seasonNumber, e.episodeNumber, e.absoluteEpisodeNumber])).toEqual([
      [1, 1, 1],
      [2, 1, 2],
      [0, 1, undefined],
    ]);
    expect(episodes[0]!.overview).toBe('x');
  });
});
