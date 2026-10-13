import { describe, expect, it } from 'vitest';
import { downloadClientSettingsSchema, type DownloadClientSettings } from '@sonarr/shared';
import { infoHashFromMagnet, infoHashFromTorrent } from './bencode.js';
import { NzbgetClient } from './nzbget.js';
import { QbittorrentClient, mapQbittorrentState } from './qbittorrent.js';
import { SabnzbdClient } from './sabnzbd.js';
import { TransmissionClient, mapTransmissionStatus } from './transmission.js';
import { DownloadClientError, type FetchFn } from './types.js';

interface Call {
  url: URL;
  method: string;
  headers: Headers;
  body: RequestInit['body'];
}

function fakeFetch(handler: (c: Call) => Response | Promise<Response>): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    calls.push(call);
    return handler(call);
  }) as FetchFn;
  return { fetch: fetchFn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const settings = (over: Partial<DownloadClientSettings> = {}): DownloadClientSettings =>
  downloadClientSettingsSchema.parse({ host: 'dl.local', port: 8080, username: 'user', password: 'secret-pass', apiKey: 'secret-key', ...over });

const release = { title: 'Show.S01E01.720p', downloadUrl: 'http://idx/get/1', protocol: 'usenet' as const };
const MIB = 1024 * 1024;

const INFO = 'd6:lengthi5e4:name5:a.mkv12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae';
const TORRENT = new TextEncoder().encode(`d8:announce3:foo4:info${INFO}e`);
const TORRENT_HASH = 'b22cc3b59185b9fdde1fefd93f155f3bbb833b76';

describe('bencode', () => {
  it('hashes the raw info dictionary', () => {
    expect(infoHashFromTorrent(TORRENT)).toBe(TORRENT_HASH);
  });
  it('throws on malformed input and bounds recursion', () => {
    expect(() => infoHashFromTorrent(new TextEncoder().encode('d4:infoi5ee'))).toThrow(/Malformed/);
    expect(() => infoHashFromTorrent(new TextEncoder().encode('d3:foo3:bare'))).toThrow(/info/);
    expect(() => infoHashFromTorrent(new TextEncoder().encode('d4:info'))).toThrow(/Malformed/);
    expect(() => infoHashFromTorrent(new TextEncoder().encode('x'))).toThrow(/Malformed/);
    expect(() => infoHashFromTorrent(new TextEncoder().encode(`d1:a${'l'.repeat(100)}${'e'.repeat(100)}4:infodee`))).toThrow(/too deep/);
  });
  it('reads base16 and base32 magnet hashes', () => {
    const hex = '0123456789abcdef0123456789abcdef01234567';
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${hex.toUpperCase()}&dn=x`)).toBe(hex);
    expect(infoHashFromMagnet('magnet:?xt=urn:btih:AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH')).toBe(hex);
    expect(infoHashFromMagnet('magnet:?dn=x')).toBeUndefined();
  });
});

describe('SABnzbd', () => {
  const queue = {
    queue: {
      slots: [
        { nzo_id: 'q1', filename: 'Show.S01E01', cat: 'tv', status: 'Downloading', mb: '100.0', mbleft: '25.0', timeleft: '0:01:30' },
        { nzo_id: 'q2', filename: 'Show.S01E02', cat: 'tv', status: 'Paused', mb: '10', mbleft: '10', timeleft: '0:00:00' },
        { nzo_id: 'q3', filename: 'Show.S01E03', cat: 'tv', status: 'Queued', mb: '10', mbleft: '10', timeleft: '0:00:00' },
        { nzo_id: 'q4', filename: 'Other', cat: 'movies', status: 'Downloading', mb: '10', mbleft: '10', timeleft: '0:00:10' },
      ],
    },
  };
  const history = {
    history: {
      slots: [
        { nzo_id: 'h1', name: 'Done', category: 'tv', status: 'Completed', bytes: 5000, storage: '/dl/Done' },
        { nzo_id: 'h2', name: 'Bad', category: 'tv', status: 'Failed', bytes: 100, fail_message: 'Aborted, cannot be completed' },
        { nzo_id: 'h3', name: 'Other', category: 'movies', status: 'Completed', bytes: 1 },
      ],
    },
  };

  function make(over: Partial<DownloadClientSettings> = {}) {
    const f = fakeFetch((c) => {
      const mode = c.url.searchParams.get('mode');
      if (c.url.searchParams.get('apikey') !== 'secret-key') return json({ status: false, error: 'API Key Incorrect' });
      if (mode === 'version') return json({ version: '4.3.0' });
      if (mode === 'get_config') return json({ config: { categories: [{ name: '*' }, { name: 'tv' }] } });
      if (mode === 'addurl') return json({ status: true, nzo_ids: ['SABnzbd_nzo_abc'] });
      if (mode === 'queue' && c.url.searchParams.get('name') === 'delete') return json({ status: true });
      if (mode === 'queue') return json(queue);
      if (mode === 'history' && c.url.searchParams.get('name') === 'delete') return json({ status: true });
      if (mode === 'history') return json(history);
      return json({ status: false, error: 'unknown' });
    });
    return { ...f, client: new SabnzbdClient(settings({ category: 'tv', ...over }), { fetch: f.fetch }) };
  }

  it('tests the connection and category', async () => {
    const { client } = make();
    await expect(client.test()).resolves.toBeUndefined();
    await expect(make({ category: 'nope' }).client.test()).rejects.toThrow(/Category 'nope'/);
  });

  it('reports auth failure without leaking credentials', async () => {
    const { client } = make({ apiKey: 'wrong-key-123' });
    const err = await client.test().catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(DownloadClientError);
    expect((err as Error).message).toMatch(/Authentication failed/);
    expect((err as Error).message).not.toContain('wrong-key-123');
  });

  it('adds a release and returns the nzo id', async () => {
    const { client, calls } = make();
    expect(await client.addRelease(release)).toBe('SABnzbd_nzo_abc');
    const q = calls[0]!.url.searchParams;
    expect(q.get('name')).toBe('http://idx/get/1');
    expect(q.get('nzbname')).toBe('Show.S01E01.720p');
    expect(q.get('cat')).toBe('tv');
    expect(q.get('output')).toBe('json');
  });

  it('maps queue and history items filtered by category', async () => {
    const items = await make().client.getItems();
    expect(items.map((i) => [i.downloadId, i.status])).toEqual([
      ['q1', 'downloading'],
      ['q2', 'paused'],
      ['q3', 'queued'],
      ['h1', 'completed'],
      ['h2', 'failed'],
    ]);
    expect(items[0]).toMatchObject({ totalSize: 100 * MIB, remainingSize: 25 * MIB, remainingTimeSeconds: 90 });
    expect(items[3]).toMatchObject({ outputPath: '/dl/Done', canMoveFiles: true });
    expect(items[4]!.message).toBe('Aborted, cannot be completed');
  });

  it('removes from queue and history', async () => {
    const { client, calls } = make();
    await client.removeItem('q1', true);
    expect(calls.map((c) => [c.url.searchParams.get('mode'), c.url.searchParams.get('name'), c.url.searchParams.get('value'), c.url.searchParams.get('del_files')])).toEqual([
      ['queue', 'delete', 'q1', '1'],
      ['history', 'delete', 'q1', '1'],
    ]);
  });

  it('wraps connection failures without the url', async () => {
    const client = new SabnzbdClient(settings(), {
      fetch: (async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }) as FetchFn,
    });
    const err = (await client.test().catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('ECONNREFUSED');
    expect(err.message).not.toContain('secret-key');
  });
});

describe('NZBGet', () => {
  const groups = [
    { NZBID: 1, NZBName: 'A', Category: 'tv', FileSizeMB: 100, RemainingSizeMB: 50, Status: 'DOWNLOADING' },
    { NZBID: 2, NZBName: 'B', Category: 'tv', FileSizeMB: 10, RemainingSizeMB: 10, Status: 'PAUSED' },
    { NZBID: 3, NZBName: 'C', Category: 'tv', FileSizeMB: 10, RemainingSizeMB: 10, Status: 'QUEUED' },
    { NZBID: 4, NZBName: 'D', Category: 'tv', FileSizeMB: 10, RemainingSizeMB: 0, Status: 'UNPACKING' },
    { NZBID: 9, NZBName: 'X', Category: 'other', FileSizeMB: 10, RemainingSizeMB: 0, Status: 'QUEUED' },
  ];
  const hist = [
    { NZBID: 5, Name: 'E', Category: 'tv', FileSizeMB: 5, Status: 'SUCCESS/ALL', ParStatus: 'SUCCESS', ScriptStatus: 'NONE', DeleteStatus: 'NONE', DestDir: '/dl/E' },
    { NZBID: 6, Name: 'F', Category: 'tv', FileSizeMB: 5, Status: 'FAILURE/PAR', ParStatus: 'FAILURE', ScriptStatus: 'NONE', DeleteStatus: 'NONE' },
    { NZBID: 7, Name: 'G', Category: 'tv', FileSizeMB: 5, Status: 'DELETED/HEALTH', ParStatus: 'NONE', ScriptStatus: 'NONE', DeleteStatus: 'HEALTH' },
  ];

  function make(editResults: boolean[] = [true]) {
    const edits: unknown[][] = [];
    const f = fakeFetch((c) => {
      if (c.headers.get('authorization') !== `Basic ${Buffer.from('user:secret-pass').toString('base64')}`) {
        return new Response('', { status: 401 });
      }
      const { method, params } = JSON.parse(String(c.body)) as { method: string; params: unknown[] };
      switch (method) {
        case 'version':
          return json({ result: '21.1' });
        case 'append':
          return json({ result: 42 });
        case 'listgroups':
          return json({ result: groups });
        case 'history':
          return json({ result: hist });
        case 'status':
          return json({ result: { DownloadRate: 1 * MIB } });
        case 'editqueue':
          edits.push(params);
          return json({ result: editResults.shift() ?? false });
        default:
          return json({ error: { message: 'bad method' } });
      }
    });
    return { ...f, edits, client: new NzbgetClient(settings({ category: 'tv', urlBase: '/nzbget' }), { fetch: f.fetch }) };
  }

  it('tests, with auth failure', async () => {
    await expect(make().client.test()).resolves.toBeUndefined();
    const bad = new NzbgetClient(settings({ password: 'wrong' }), { fetch: make().fetch });
    const err = (await bad.test().catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/Authentication failed/);
    expect(err.message).not.toContain('wrong');
  });

  it('appends and returns the id as a string', async () => {
    const { client, calls } = make();
    expect(await client.addRelease(release)).toBe('42');
    expect(calls[0]!.url.pathname).toBe('/nzbget/jsonrpc');
    expect(JSON.parse(String(calls[0]!.body)).params).toEqual(['Show.S01E01.720p.nzb', 'http://idx/get/1', 'tv', 0, false, false, '', 0, 'SCORE', []]);
  });

  it('maps groups and history', async () => {
    const items = await make().client.getItems();
    expect(items.map((i) => [i.downloadId, i.status])).toEqual([
      ['1', 'downloading'],
      ['2', 'paused'],
      ['3', 'queued'],
      ['4', 'downloading'],
      ['5', 'completed'],
      ['6', 'failed'],
      ['7', 'failed'],
    ]);
    expect(items[0]).toMatchObject({ totalSize: 100 * MIB, remainingSize: 50 * MIB, remainingTimeSeconds: 50 });
    expect(items[4]).toMatchObject({ outputPath: '/dl/E', canMoveFiles: true });
  });

  it('removes from the queue, falling back to history', async () => {
    const a = make([true]);
    await a.client.removeItem('1', true);
    expect(a.edits).toEqual([['GroupFinalDelete', '', [1]]]);
    const b = make([false, true]);
    await b.client.removeItem('5', true);
    expect(b.edits).toEqual([
      ['GroupFinalDelete', '', [5]],
      ['HistoryFinalDelete', '', [5]],
    ]);
  });
});

describe('qBittorrent', () => {
  const torrents = [
    { hash: 'AAA', name: 'one', size: 1000, progress: 0.25, state: 'downloading', eta: 60, save_path: '/dl/', category: 'tv-sonarr' },
    { hash: 'bbb', name: 'two', size: 1000, progress: 1, state: 'pausedUP', eta: 8640000, save_path: '/dl', category: 'tv-sonarr' },
    { hash: 'ccc', name: 'three', size: 1000, progress: 0, state: 'error', eta: 8640000, save_path: 'C:\\dl', category: 'tv-sonarr' },
  ];

  function make(opts: { expireOnce?: boolean } = {}) {
    let sid = 0;
    let expire = opts.expireOnce ?? false;
    const f = fakeFetch(async (c) => {
      const path = c.url.pathname;
      if (path === '/api/v2/auth/login') {
        const form = new URLSearchParams(String(c.body));
        if (form.get('password') !== 'secret-pass') return new Response('Fails.', { status: 200 });
        sid++;
        return new Response('Ok.', { status: 200, headers: { 'set-cookie': `SID=sid${sid}; HttpOnly; path=/` } });
      }
      if (c.headers.get('cookie') !== `SID=sid${sid}` || expire) {
        expire = false;
        return new Response('Forbidden', { status: 403 });
      }
      if (path === '/api/v2/app/version') return new Response('v5.0.0');
      if (path === '/api/v2/torrents/add') return new Response('Ok.');
      if (path === '/api/v2/torrents/info') return json(torrents);
      if (path === '/api/v2/torrents/delete') return new Response('');
      return new Response('', { status: 404 });
    });
    return { ...f, client: new QbittorrentClient(settings({ category: 'tv-sonarr' }), { fetch: f.fetch }) };
  }

  it('tests and rejects bad credentials without leaking them', async () => {
    await expect(make().client.test()).resolves.toBeUndefined();
    const f = make();
    const bad = new QbittorrentClient(settings({ password: 'nope-pass' }), { fetch: f.fetch });
    const err = (await bad.test().catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/Authentication failed/);
    expect(err.message).not.toContain('nope-pass');
  });

  it('adds a magnet link and returns the lowercased hash', async () => {
    const { client, calls } = make();
    const hash = '0123456789ABCDEF0123456789ABCDEF01234567';
    const id = await client.addRelease({ ...release, protocol: 'torrent', magnetUrl: `magnet:?xt=urn:btih:${hash}&dn=x` });
    expect(id).toBe(hash.toLowerCase());
    const add = calls.find((c) => c.url.pathname === '/api/v2/torrents/add')!;
    const form = add.body as FormData;
    expect(form.get('urls')).toContain(hash);
    expect(form.get('category')).toBe('tv-sonarr');
    expect(form.get('paused')).toBe('false');
  });

  it('adds a torrent file and computes the info hash', async () => {
    const { client, calls } = make();
    const id = await client.addRelease({ ...release, protocol: 'torrent' }, TORRENT);
    expect(id).toBe(TORRENT_HASH);
    const form = calls.find((c) => c.url.pathname === '/api/v2/torrents/add')!.body as FormData;
    expect(form.get('torrents')).toBeInstanceOf(Blob);
    await expect(make().client.addRelease({ ...release, protocol: 'torrent' })).rejects.toThrow(/torrent file/);
  });

  it('re-logs in once when the session expires', async () => {
    const { client, calls } = make({ expireOnce: true });
    const items = await client.getItems();
    expect(items).toHaveLength(3);
    expect(calls.filter((c) => c.url.pathname === '/api/v2/auth/login')).toHaveLength(2);
    const info = calls.filter((c) => c.url.pathname === '/api/v2/torrents/info');
    expect(info).toHaveLength(2);
    expect(info[1]!.headers.get('cookie')).toBe('SID=sid2');
  });

  it('maps states and items', async () => {
    const table: [string, string][] = [
      ['downloading', 'downloading'], ['stalledDL', 'downloading'], ['metaDL', 'downloading'], ['forcedDL', 'downloading'],
      ['pausedDL', 'paused'], ['stoppedDL', 'paused'],
      ['queuedDL', 'queued'], ['checkingDL', 'queued'],
      ['uploading', 'completed'], ['stalledUP', 'completed'], ['pausedUP', 'completed'], ['queuedUP', 'completed'], ['forcedUP', 'completed'], ['stoppedUP', 'completed'],
      ['error', 'failed'], ['missingFiles', 'failed'],
    ];
    for (const [state, expected] of table) expect(mapQbittorrentState(state), state).toBe(expected);

    const items = await make().client.getItems();
    expect(items[0]).toMatchObject({ downloadId: 'aaa', remainingSize: 750, remainingTimeSeconds: 60, outputPath: '/dl/one', status: 'downloading' });
    expect(items[1]).toMatchObject({ status: 'completed', remainingSize: 0, canBeRemoved: true, outputPath: '/dl/two' });
    expect(items[1]!.remainingTimeSeconds).toBeUndefined();
    expect(items[2]).toMatchObject({ status: 'failed', outputPath: 'C:\\dl\\three' });
  });

  it('removes with deleteFiles', async () => {
    const { client, calls } = make();
    await client.removeItem('bbb', true);
    const del = calls.find((c) => c.url.pathname === '/api/v2/torrents/delete')!;
    const form = new URLSearchParams(String(del.body));
    expect(form.get('hashes')).toBe('bbb');
    expect(form.get('deleteFiles')).toBe('true');
  });
});

describe('Transmission', () => {
  const rows = [
    { hashString: 'AAA', name: 'dl', totalSize: 1000, leftUntilDone: 400, eta: 30, status: 4, error: 0, errorString: '', downloadDir: '/dl', labels: ['tv-sonarr'], isFinished: false },
    { hashString: 'bbb', name: 'seed', totalSize: 1000, leftUntilDone: 0, eta: -1, status: 6, error: 0, errorString: '', downloadDir: '/dl', labels: ['tv-sonarr'], isFinished: false },
    { hashString: 'ccc', name: 'bad', totalSize: 1000, leftUntilDone: 10, eta: -1, status: 0, error: 3, errorString: 'No space left', downloadDir: '/dl', labels: ['tv-sonarr'] },
    { hashString: 'ddd', name: 'stopped', totalSize: 1000, leftUntilDone: 10, eta: -1, status: 0, error: 0, errorString: '', downloadDir: '/dl', labels: ['tv-sonarr'] },
    { hashString: 'eee', name: 'other', totalSize: 1000, leftUntilDone: 10, eta: -1, status: 4, error: 0, errorString: '', downloadDir: '/dl', labels: ['movies'] },
  ];

  function make(over: Partial<DownloadClientSettings> = {}) {
    const f = fakeFetch((c) => {
      if (c.headers.get('authorization') !== `Basic ${Buffer.from('user:secret-pass').toString('base64')}`) {
        return new Response('', { status: 401 });
      }
      if (c.headers.get('x-transmission-session-id') !== 'sess-2') {
        return new Response('', { status: 409, headers: { 'X-Transmission-Session-Id': 'sess-2' } });
      }
      const { method, arguments: args } = JSON.parse(String(c.body)) as { method: string; arguments: Record<string, unknown> };
      if (method === 'session-get') return json({ result: 'success', arguments: { version: '4' } });
      if (method === 'torrent-add') return json({ result: 'success', arguments: { 'torrent-added': { hashString: 'ABCDEF' } } });
      if (method === 'torrent-get') return json({ result: 'success', arguments: { torrents: rows } });
      if (method === 'torrent-remove') return json({ result: 'success', arguments: args });
      return json({ result: 'method name not recognized', arguments: {} });
    });
    return { ...f, client: new TransmissionClient(settings({ category: 'tv-sonarr', urlBase: '/transmission/', ...over }), { fetch: f.fetch }) };
  }

  it('handles the 409 session handshake and remembers the session id', async () => {
    const { client, calls } = make();
    await client.test();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname).toBe('/transmission/rpc');
    expect(calls[1]!.headers.get('x-transmission-session-id')).toBe('sess-2');
    await client.test();
    expect(calls).toHaveLength(3);
  });

  it('re-handshakes when the session id rotates', async () => {
    const { client, calls } = make();
    await client.test();
    (client as unknown as { sessionId: string }).sessionId = 'stale';
    await client.test();
    expect(calls.map((c) => c.headers.get('x-transmission-session-id'))).toEqual([null, 'sess-2', 'stale', 'sess-2']);
  });

  it('fails on bad credentials without leaking them', async () => {
    const f = make();
    const bad = new TransmissionClient(settings({ password: 'bad-pass-1' }), { fetch: f.fetch });
    const err = (await bad.test().catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/Authentication failed/);
    expect(err.message).not.toContain('bad-pass-1');
  });

  it('adds magnets and files', async () => {
    const { client, calls } = make();
    const hash = await client.addRelease({ ...release, protocol: 'torrent', magnetUrl: 'magnet:?xt=urn:btih:abc' });
    expect(hash).toBe('abcdef');
    const magnetCall = JSON.parse(String(calls.at(-1)!.body));
    expect(magnetCall.arguments).toEqual({ filename: 'magnet:?xt=urn:btih:abc', labels: ['tv-sonarr'] });
    await client.addRelease({ ...release, protocol: 'torrent' }, TORRENT);
    const fileCall = JSON.parse(String(calls.at(-1)!.body));
    expect(fileCall.arguments.metainfo).toBe(Buffer.from(TORRENT).toString('base64'));
    await expect(client.addRelease({ ...release, protocol: 'torrent' })).rejects.toThrow(/torrent file/);
  });

  it('maps status and filters by label', async () => {
    for (const [status, left, error, expected] of [
      [0, 10, 0, 'paused'], [0, 0, 0, 'completed'], [1, 5, 0, 'queued'], [2, 5, 0, 'queued'], [3, 5, 0, 'downloading'],
      [4, 5, 0, 'downloading'], [5, 0, 0, 'completed'], [6, 0, 0, 'completed'], [4, 5, 3, 'failed'],
    ] as const) {
      expect(mapTransmissionStatus({ status, leftUntilDone: left, error }), `${status}/${left}/${error}`).toBe(expected);
    }
    const items = await make().client.getItems();
    expect(items.map((i) => [i.downloadId, i.status])).toEqual([
      ['aaa', 'downloading'],
      ['bbb', 'completed'],
      ['ccc', 'failed'],
      ['ddd', 'paused'],
    ]);
    expect(items[0]).toMatchObject({ remainingSize: 400, remainingTimeSeconds: 30, outputPath: '/dl/dl' });
    expect(items[2]!.message).toBe('No space left');
  });

  it('removes with delete-local-data', async () => {
    const { client, calls } = make();
    await client.removeItem('aaa', true);
    expect(JSON.parse(String(calls.at(-1)!.body))).toEqual({ method: 'torrent-remove', arguments: { ids: ['aaa'], 'delete-local-data': true } });
  });

  it('uses a custom url base', async () => {
    const { client, calls } = make({ urlBase: '/tr/' });
    await client.test();
    expect(calls[0]!.url.pathname).toBe('/tr/rpc');
  });
});
