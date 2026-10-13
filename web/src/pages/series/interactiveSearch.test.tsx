import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { IndexerResource, ReleaseResource } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { makeEpisodeFile, makeEpisodes, makeQualityProfile, makeSeries, makeTag } from './fixtures';
import { formatAge, qualityLabel } from './InteractiveSearchModal';
import { SeriesDetail } from './SeriesDetail';

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/series/breaking-bad']}>
          <main>
            <Routes>
              <Route path="/series/:titleSlug" element={<SeriesDetail />} />
              <Route path="/settings/indexers" element={<h1>Indexer settings</h1>} />
            </Routes>
          </main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const quality = (name: string, id: number, version = 1, isRepack = false) => ({
  quality: { id, name, source: 'web' as const, resolution: 1080 },
  revision: { version, real: 0, isRepack },
});

const makeRelease = (overrides: Partial<ReleaseResource> = {}): ReleaseResource => ({
  guid: 'guid-a',
  indexerId: 1,
  indexer: 'NZBgeek',
  title: 'Breaking.Bad.S02E01.1080p.WEB-DL.DD5.1.H.264-GROUP',
  size: 2 * 1024 ** 3,
  publishDate: '2024-01-01T00:00:00Z',
  age: 3,
  ageHours: 72,
  downloadUrl: 'https://example.com/a.nzb',
  protocol: 'usenet',
  quality: quality('WEBDL-1080p', 3),
  qualityWeight: 10,
  seriesId: 1,
  seriesTitle: 'Breaking Bad',
  episodeIds: [201],
  seasonNumber: 2,
  episodeNumbers: [1],
  absoluteEpisodeNumbers: [],
  fullSeason: false,
  languages: ['English'],
  approved: true,
  temporarilyRejected: false,
  rejected: false,
  rejections: [],
  downloadAllowed: true,
  ...overrides,
});

const releases = (): ReleaseResource[] => [
  makeRelease(),
  makeRelease({
    guid: 'guid-b',
    indexerId: 2,
    indexer: 'Jackett',
    title: 'Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED',
    size: 1 * 1024 ** 3,
    ageHours: 5,
    age: 0,
    protocol: 'torrent',
    seeders: 12,
    leechers: 3,
    quality: quality('HDTV-720p', 4),
    qualityWeight: 6,
    approved: false,
    rejected: true,
    rejections: ['Not an upgrade for existing episode file(s)', 'Release is blocklisted'],
  }),
  makeRelease({
    guid: 'guid-c',
    title: 'Breaking.Bad.S02E01.REPACK.1080p.WEB-DL-OTHER',
    size: 3 * 1024 ** 3,
    quality: quality('WEBDL-1080p', 3, 2, true),
  }),
];

const indexer = (overrides: Partial<IndexerResource> = {}) => ({
  id: 1,
  name: 'NZBgeek',
  implementation: 'Newznab',
  protocol: 'usenet',
  enableRss: true,
  enableAutomaticSearch: true,
  enableInteractiveSearch: true,
  priority: 25,
  tags: [],
  settings: {},
  ...overrides,
});

const routes = (extra: MockRoutes = {}): MockRoutes => ({
  'GET series': () => [makeSeries()],
  'GET episode': () => makeEpisodes(),
  'GET episodefile': () => [makeEpisodeFile()],
  'GET qualityprofile': () => [makeQualityProfile()],
  'GET tag': () => [makeTag()],
  'GET config/ui': () => ({ showRelativeDates: false }),
  'GET indexer': () => [indexer()],
  'GET release': releases,
  ...extra,
});

/** Opens the interactive search for S02E01 (season 2 is expanded by default). */
async function openEpisodeSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Interactive search S02E01' }));
  return screen.getByRole('dialog', { name: 'Interactive Search - Breaking Bad S02E01' });
}

const rowTitles = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.querySelector('td:nth-child(3)')?.textContent);

let api: MockApi;
afterEach(() => api?.restore());

describe('formatting', () => {
  it('formats age and quality revisions', () => {
    expect(formatAge({ age: 3, ageHours: 72 })).toBe('3 days');
    expect(formatAge({ age: 0, ageHours: 5.4 })).toBe('5 hours');
    expect(formatAge({ age: 0, ageHours: 1 })).toBe('1 hour');
    expect(formatAge({ age: 0, ageHours: 0.25 })).toBe('15 minutes');
    expect(qualityLabel({ quality: quality('WEBDL-1080p', 3, 2) })).toBe('WEBDL-1080p Proper');
    expect(qualityLabel({ quality: quality('WEBDL-1080p', 3, 2, true) })).toBe('WEBDL-1080p Repack');
  });
});

describe('Interactive search', () => {
  it('loads releases, shows rejection reasons as text and has no axe violations', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderDetail();
    const dialog = await openEpisodeSearch(user);
    const rejected = (await within(dialog).findByText('Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED')).closest('tr')!;
    expect(api.callsTo('GET', 'release')[0].query.get('episodeId')).toBe('201');

    expect(within(rejected).getByText('Torrent')).toBeInTheDocument();
    expect(within(rejected).getByText('5 hours')).toBeInTheDocument();
    expect(within(rejected).getByText(/12 \/ 3/)).toBeInTheDocument();
    expect(within(rejected).getByText('1.0 GB')).toBeInTheDocument();
    const toggle = within(rejected).getByRole('button', { name: /Rejected \(2\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(rejected).queryByText('Release is blocklisted')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(rejected).getByText('Not an upgrade for existing episode file(s)')).toBeVisible();
    expect(within(rejected).getByText('Release is blocklisted')).toBeVisible();

    const approved = within(dialog).getByText('Breaking.Bad.S02E01.1080p.WEB-DL.DD5.1.H.264-GROUP').closest('tr')!;
    expect(within(approved).getByText('Approved')).toBeInTheDocument();
    expect(within(approved).getByText('3 days')).toBeInTheDocument();
    expect(within(dialog).getByText('WEBDL-1080p Repack')).toBeInTheDocument();

    expect((await axe(document.body)).violations).toEqual([]);
  });

  it('filters to approved releases and sorts by size', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderDetail();
    const dialog = await openEpisodeSearch(user);
    await within(dialog).findByText('Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED');

    await user.click(within(dialog).getByRole('button', { name: /^Size/ }));
    expect(rowTitles(dialog)).toEqual([
      'Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED',
      'Breaking.Bad.S02E01.1080p.WEB-DL.DD5.1.H.264-GROUP',
      'Breaking.Bad.S02E01.REPACK.1080p.WEB-DL-OTHER',
    ]);
    expect(within(dialog).getByRole('columnheader', { name: /Size/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(dialog).getByRole('button', { name: /^Size/ }));
    expect(rowTitles(dialog)[0]).toBe('Breaking.Bad.S02E01.REPACK.1080p.WEB-DL-OTHER');

    const approvedFilter = within(dialog).getByRole('button', { name: 'Approved (2)' });
    await user.click(approvedFilter);
    expect(approvedFilter).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).queryByText('Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED')).not.toBeInTheDocument();
    expect(rowTitles(dialog)).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'All (3)' }));
    expect(rowTitles(dialog)).toHaveLength(3);
  });

  it('grabs an approved release and shows success', async () => {
    api = mockApi(routes({ 'POST release': (req) => ({ ...makeRelease(), ...(req.body as object) }) }));
    const user = userEvent.setup();
    renderDetail();
    const dialog = await openEpisodeSearch(user);
    const title = 'Breaking.Bad.S02E01.1080p.WEB-DL.DD5.1.H.264-GROUP';
    await user.click(await within(dialog).findByRole('button', { name: `Grab ${title}` }));
    await waitFor(() => expect(api.callsTo('POST', 'release')).toHaveLength(1));
    expect(api.callsTo('POST', 'release')[0].body).toEqual({ guid: 'guid-a', indexerId: 1 });
    expect(await within(screen.getByRole('region', { name: 'Notifications' })).findByText(`Grabbed ${title}`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: `Grabbed ${title}` })).toBeInTheDocument();
  });

  it('asks for confirmation before grabbing a rejected release and shows a 409 message', async () => {
    api = mockApi(routes({ 'POST release': () => ({ status: 409, body: { message: 'No download client is available for torrent' } }) }));
    const user = userEvent.setup();
    renderDetail();
    const dialog = await openEpisodeSearch(user);
    await user.click(await within(dialog).findByRole('button', { name: 'Grab Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED' }));
    const confirm = screen.getByRole('dialog', { name: 'Grab rejected release?' });
    expect(confirm).toHaveTextContent(
      'This release was rejected: Not an upgrade for existing episode file(s); Release is blocklisted. Grab anyway?',
    );
    expect(api.callsTo('POST', 'release')).toHaveLength(0);

    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(api.callsTo('POST', 'release')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Grab Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Grab rejected release?' })).getByRole('button', { name: 'Grab anyway' }));
    await waitFor(() => expect(api.callsTo('POST', 'release')).toHaveLength(1));
    expect(api.callsTo('POST', 'release')[0].body).toEqual({ guid: 'guid-b', indexerId: 2 });
    expect(await screen.findByText('No download client is available for torrent')).toBeInTheDocument();
  });

  it('searches a season interactively', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderDetail();
    const season2 = (await screen.findAllByRole('region', { name: /Season|Specials/ }))[0];
    await user.click(within(season2).getByRole('button', { name: 'Interactive search' }));
    const dialog = screen.getByRole('dialog', { name: 'Interactive Search - Breaking Bad Season 2' });
    await within(dialog).findByText('Breaking.Bad.S02E01.720p.HDTV.x264-REJECTED');
    const query = api.callsTo('GET', 'release')[0].query;
    expect(query.get('seriesId')).toBe('1');
    expect(query.get('seasonNumber')).toBe('2');
  });

  it('shows guidance instead of searching when no indexers are configured', async () => {
    api = mockApi(routes({ 'GET indexer': () => [] }));
    const user = userEvent.setup();
    renderDetail();
    const dialog = await openEpisodeSearch(user);
    expect(await within(dialog).findByText('No indexers configured')).toBeInTheDocument();
    expect(api.callsTo('GET', 'release')).toHaveLength(0);
    expect((await axe(document.body)).violations).toEqual([]);
    await user.click(within(dialog).getByRole('link', { name: 'Go to Settings > Indexers' }));
    expect(await screen.findByRole('heading', { name: 'Indexer settings' })).toBeInTheDocument();
  });

  it('shows the error and retries when the search fails, and an empty state for no results', async () => {
    let attempt = 0;
    api = mockApi(
      routes({
        'GET release': () => (++attempt === 1 ? { status: 500, body: { message: 'All indexers failed' } } : []),
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    const dialog = await openEpisodeSearch(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Search failed: All indexers failed');
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await within(dialog).findByText('No results found')).toBeInTheDocument();
    expect(attempt).toBe(2);
  });
});

describe('Automatic search', () => {
  it('posts EpisodeSearch, SeasonSearch and SeriesSearch commands', async () => {
    api = mockApi(routes({ 'POST command': (req) => ({ id: 1, ...(req.body as object) }) }));
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Automatic search S02E01' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(1));
    expect(api.callsTo('POST', 'command')[0].body).toEqual({ name: 'EpisodeSearch', episodeIds: [201] });

    const season2 = screen.getAllByRole('region', { name: /Season|Specials/ })[0];
    await user.click(within(season2).getByRole('button', { name: 'Search season' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(2));
    expect(api.callsTo('POST', 'command')[1].body).toEqual({ name: 'SeasonSearch', seriesId: 1, seasonNumber: 2 });

    await user.click(screen.getByRole('button', { name: 'Search Monitored' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(3));
    expect(api.callsTo('POST', 'command')[2].body).toEqual({ name: 'SeriesSearch', seriesId: 1 });
    expect(await screen.findByText('Started search for S02E01')).toBeInTheDocument();
  });
});
