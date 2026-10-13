import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { AddSeriesInput, Series, UpdateSeriesInput } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { AddNew } from './AddNew';
import { LibraryImport } from './LibraryImport';
import { SeriesDetail } from './SeriesDetail';
import { PREFS_KEY, SeriesIndex } from './SeriesIndex';
import {
  makeContinuingSeries,
  makeEpisodeFile,
  makeEpisodes,
  makeLookup,
  makeQualityProfile,
  makeRootFolder,
  makeSeries,
  makeTag,
} from './fixtures';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderAt(path: string, page: ReactElement, routePath = '*') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <main>
            <Routes>
              <Route path={routePath} element={page} />
              {routePath !== '/series/:titleSlug' && <Route path="/series/:titleSlug" element={<h1>Series page</h1>} />}
              {routePath !== '/' && <Route path="/" element={<h1>Series index</h1>} />}
            </Routes>
          </main>
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

/** Settings data every series page may ask for. */
const baseRoutes = (overrides: MockRoutes = {}): MockRoutes => ({
  'GET rootfolder': () => [makeRootFolder()],
  'GET qualityprofile': () => [makeQualityProfile(), makeQualityProfile({ id: 2, name: 'Any' })],
  'GET tag': () => [makeTag(), makeTag({ id: 2, label: 'kids' })],
  'GET config/ui': () => ({ showRelativeDates: false }),
  ...overrides,
});

let api: MockApi;
beforeEach(() => localStorage.clear());
afterEach(() => api?.restore());

describe('Add New', () => {
  it('searches, marks series already in the library and has no axe violations', async () => {
    api = mockApi(
      baseRoutes({
        'GET series/lookup': () => [makeLookup(), makeLookup({ title: 'Better Call Saul', tvMazeId: 618, titleSlug: 'better-call-saul', year: 2015 })],
        'GET series': () => [makeSeries()],
      }),
    );
    const user = userEvent.setup();
    const { container } = renderAt('/add/new', <AddNew />);
    const input = screen.getByRole('searchbox', { name: 'Search for a series' });
    expect(input).toHaveFocus();
    await user.type(input, 'breaking');

    const results = await screen.findByRole('region', { name: 'Search results' }, { timeout: 2000 });
    expect(api.callsTo('GET', 'series/lookup').at(-1)?.query.get('term')).toBe('breaking');
    const existing = await within(results).findByRole('link', { name: 'Breaking Bad' });
    expect(existing).toHaveAttribute('href', '/series/breaking-bad');
    expect(within(existing.closest('li')!).getByText('Already in library')).toBeInTheDocument();
    expect(within(results).getByRole('button', { name: 'Better Call Saul' })).toBeInTheDocument();
    expect(within(results).getAllByText('Already in library')).toHaveLength(1);

    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect((await axe(container)).violations).toEqual([]);
  });

  it('debounces typing into a single lookup and shows an empty state for zero results', async () => {
    api = mockApi(baseRoutes({ 'GET series/lookup': () => [], 'GET series': () => [] }));
    const user = userEvent.setup();
    renderAt('/add/new', <AddNew />);
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(await screen.findByText('No results for "zzzz"', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(api.callsTo('GET', 'series/lookup')).toHaveLength(1);
  });

  it('adds a series with the chosen options and navigates to it', async () => {
    api = mockApi(
      baseRoutes({
        'GET series/lookup': () => [makeLookup({ tvMazeId: 618, tvdbId: 273181, title: 'Better Call Saul', titleSlug: 'better-call-saul', year: 2015 })],
        'GET series': () => [],
        'GET rootfolder': () => [makeRootFolder(), makeRootFolder({ id: 2, path: '/anime' })],
        'POST series': (req) => ({
          status: 201,
          body: makeSeries({ id: 7, title: 'Better Call Saul', titleSlug: 'better-call-saul', ...(req.body as object) }),
        }),
      }),
    );
    const user = userEvent.setup();
    renderAt('/add/new', <AddNew />);
    await user.type(screen.getByRole('searchbox'), 'saul');
    await user.click(await screen.findByRole('button', { name: 'Better Call Saul' }, { timeout: 2000 }));

    const dialog = await screen.findByRole('dialog', { name: 'Better Call Saul (2015)' });
    const rootSelect = await within(dialog).findByRole('combobox', { name: 'Root Folder' });
    await waitFor(() => expect(within(rootSelect).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(rootSelect, '/anime');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Monitor' }), 'future');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Quality Profile' }), '2');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Series Type' }), 'anime');
    await user.click(await within(dialog).findByRole('button', { name: 'kids' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Start search for missing episodes' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add Better Call Saul' }));

    await waitFor(() => expect(location()).toBe('/series/better-call-saul'));
    const [post] = api.callsTo('POST', 'series');
    expect(post.body).toEqual({
      tvMazeId: 618,
      tvdbId: 273181,
      title: 'Better Call Saul',
      qualityProfileId: 2,
      rootFolderPath: '/anime',
      seriesType: 'anime',
      seasonFolder: true,
      monitored: true,
      monitorNewItems: 'all',
      tags: [2],
      addOptions: { monitor: 'future', searchForMissingEpisodes: true, searchForCutoffUnmetEpisodes: false },
    } satisfies AddSeriesInput);
    expect(await screen.findByText('Added Better Call Saul')).toBeInTheDocument();
  });

  it('points to settings when no root folders are configured', async () => {
    api = mockApi(baseRoutes({ 'GET rootfolder': () => [], 'GET series': () => [] }));
    renderAt('/add/new', <AddNew />);
    expect(await screen.findByRole('link', { name: /Media Management/ })).toHaveAttribute('href', '/settings/mediamanagement');
  });
});

describe('Series index', () => {
  const library = () => [
    makeSeries(),
    makeContinuingSeries(),
    makeSeries({ id: 3, title: 'Chernobyl', sortTitle: 'chernobyl', titleSlug: 'chernobyl', tvMazeId: 3, network: 'HBO' }),
  ];

  it('shows posters linking to each series, with a fallback for missing posters', async () => {
    api = mockApi(baseRoutes({ 'GET series': library }));
    const { container } = renderAt('/', <SeriesIndex />, '/');
    const grid = await screen.findByRole('list', { name: 'Series' });
    const links = within(grid).getAllByRole('link');
    expect(links.map((l) => l.querySelector('p.truncate')?.textContent)).toEqual(['Andor', 'Breaking Bad', 'Chernobyl']);
    expect(links[0]).toHaveAttribute('href', '/series/andor');
    expect(within(links[0]).getByTestId('poster-fallback')).toHaveTextContent('A');
    expect(screen.getByRole('button', { name: 'Posters' })).toHaveAttribute('aria-pressed', 'true');
    expect((await axe(container)).violations).toEqual([]);
  });

  it('switches to the table view, sorts by title descending and persists the choice', async () => {
    api = mockApi(baseRoutes({ 'GET series': library }));
    const user = userEvent.setup();
    const { container } = renderAt('/', <SeriesIndex />, '/');
    await user.click(await screen.findByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Series' });
    const titleHeader = within(table).getByRole('columnheader', { name: /Series Title/ });
    expect(titleHeader).toHaveAttribute('aria-sort', 'ascending');

    await user.click(within(titleHeader).getByRole('button'));
    expect(titleHeader).toHaveAttribute('aria-sort', 'descending');
    const titles = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getByRole('link').textContent);
    expect(titles).toEqual(['Chernobyl', 'Breaking Bad', 'Andor']);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toMatchObject({ view: 'table', sortKey: 'title', sortDir: 'desc' });
    expect((await axe(container)).violations).toEqual([]);
  });

  it('filters to ended series and renders the overview view without axe violations', async () => {
    api = mockApi(baseRoutes({ 'GET series': library }));
    const user = userEvent.setup();
    const { container } = renderAt('/', <SeriesIndex />, '/');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Filter' }), 'ended');
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByRole('link', { name: 'Andor' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Breaking Bad' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chernobyl' })).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('filters by text and runs library commands', async () => {
    api = mockApi(baseRoutes({ 'GET series': library, 'POST command': (req) => ({ status: 201, body: { id: 1, ...(req.body as object) } }) }));
    const user = userEvent.setup();
    renderAt('/', <SeriesIndex />, '/');
    await user.type(await screen.findByRole('searchbox', { name: 'Filter series by title' }), 'cher');
    expect(within(screen.getByRole('list', { name: 'Series' })).getAllByRole('link')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Update library' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')[0]?.body).toEqual({ name: 'RefreshSeries' }));
  });

  it('shows an empty library state with add and import links', async () => {
    api = mockApi(baseRoutes({ 'GET series': () => [] }));
    renderAt('/', <SeriesIndex />, '/');
    expect(await screen.findByText('Your library is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add New/ })).toHaveAttribute('href', '/add/new');
    expect(screen.getByRole('link', { name: /Library Import/ })).toHaveAttribute('href', '/add/import');
  });
});

describe('Series detail', () => {
  const detailRoutes = (extra: MockRoutes = {}) =>
    baseRoutes({
      'GET series': () => [makeSeries()],
      'GET episode': () => makeEpisodes(),
      'GET episodefile': () => [makeEpisodeFile()],
      ...extra,
    });
  const renderDetail = (slug = 'breaking-bad') => renderAt(`/series/${slug}`, <SeriesDetail />, '/series/:titleSlug');

  it('shows seasons newest first with episode statuses and no axe violations', async () => {
    api = mockApi(detailRoutes());
    const user = userEvent.setup();
    const { container } = renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'Breaking Bad' })).toBeInTheDocument();
    expect(api.callsTo('GET', 'episode')[0]?.query.get('seriesId')).toBe('1');

    const seasons = await screen.findAllByRole('region', { name: /Season|Specials/ });
    expect(seasons.map((s) => s.querySelector('h3 button > span')?.textContent)).toEqual(['Season 2', 'Season 1', 'Specials']);

    // Season 2 is open by default.
    const s2 = seasons[0];
    expect(await within(s2).findByText('Unmonitored')).toBeInTheDocument();
    expect(within(s2).getByText('Unaired')).toBeInTheDocument();

    await user.click(within(seasons[1]).getByRole('button', { name: /Season 1/ }));
    expect(within(seasons[1]).getByRole('button', { name: /Season 1/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(seasons[1]).getByText('Downloaded (HDTV-720p)')).toBeInTheDocument();
    expect(within(seasons[1]).getByText('Missing')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('toggles an episode with PUT /episode/:id and bulk monitors a season', async () => {
    api = mockApi(
      detailRoutes({
        'PUT episode/monitor': () => ({}),
        'PUT episode/:id': (req) => ({ ...makeEpisodes()[2], ...(req.body as object) }),
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole('switch', { name: 'Monitor S02E01 Seven Thirty-Seven' }));
    await waitFor(() => expect(api.callsTo('PUT', 'episode/201')).toHaveLength(1));
    expect(api.callsTo('PUT', 'episode/201')[0].body).toEqual({ monitored: true });

    await user.click(screen.getByRole('button', { name: 'Unmonitor all' }));
    await waitFor(() => expect(api.callsTo('PUT', 'episode/monitor')).toHaveLength(1));
    expect(api.callsTo('PUT', 'episode/monitor')[0].body).toEqual({ episodeIds: [201, 202], monitored: false });
  });

  it('toggles a season with PUT series containing only that season', async () => {
    api = mockApi(detailRoutes({ 'PUT series/:id': (req) => ({ ...makeSeries(), ...(req.body as object) }) }));
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole('switch', { name: 'Monitor Season 1' }));
    await waitFor(() => expect(api.callsTo('PUT', 'series/1')).toHaveLength(1));
    expect(api.callsTo('PUT', 'series/1')[0].body).toEqual({
      seasons: [{ seasonNumber: 1, monitored: false }],
    } satisfies UpdateSeriesInput);
  });

  it('edits the series with PUT', async () => {
    api = mockApi(detailRoutes({ 'PUT series/:id': (req) => ({ ...makeSeries(), ...(req.body as object) }) }));
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Breaking Bad' });
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'Any' })).toHaveLength(1));
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Quality Profile' }), '2');
    await user.click(within(dialog).getByRole('switch', { name: 'Monitored' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'series/1')).toHaveLength(1));
    expect(api.callsTo('PUT', 'series/1')[0].body).toEqual({
      monitored: false,
      monitorNewItems: 'all',
      qualityProfileId: 2,
      seriesType: 'standard',
      seasonFolder: true,
      path: '/tv/Breaking Bad (2008)',
      tags: [],
    });
  });

  it('deletes with the folder checkbox, sends deleteFiles=true and returns to the index', async () => {
    api = mockApi(detailRoutes({ 'DELETE series/:id': () => ({}) }));
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Breaking Bad' });
    const checkbox = within(dialog).getByRole('checkbox', { name: 'Delete series folder' });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('/tv/Breaking Bad (2008)');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(location()).toBe('/'));
    expect(api.callsTo('DELETE', 'series/1')[0].query.get('deleteFiles')).toBe('true');
  });

  it('shows an info toast when searching before indexers exist', async () => {
    api = mockApi(detailRoutes({ 'POST command': () => ({ status: 400, body: { message: 'Unknown command' } }) }));
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Search Monitored' }));
    expect(await screen.findByText('Searching is available once indexers are configured')).toBeInTheDocument();
    expect(api.callsTo('POST', 'command')[0].body).toEqual({ name: 'SeriesSearch', seriesId: 1 });
  });

  it('shows a not found state for an unknown slug', async () => {
    api = mockApi(detailRoutes());
    renderDetail('nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'Series not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to series' })).toHaveAttribute('href', '/');
  });
});

describe('Library import', () => {
  it('matches folders by name and imports them with an explicit path', async () => {
    const root = makeRootFolder({
      unmappedFolders: [
        { name: 'Andor (2022)', path: '/tv/Andor (2022)' },
        { name: 'Unknown Show', path: '/tv/Unknown Show' },
      ],
    });
    const andor = makeContinuingSeries();
    api = mockApi(
      baseRoutes({
        'GET rootfolder/:id': () => root,
        'GET series/lookup': (req) => {
          if (req.query.get('term') === 'Andor') {
            const { id: _id, statistics: _s, ...lookup } = andor;
            return [lookup];
          }
          return [];
        },
        'POST series': (req) => ({ status: 201, body: { ...andor, ...(req.body as object) } satisfies Series }),
      }),
    );
    const user = userEvent.setup();
    const { container } = renderAt('/add/import', <LibraryImport />);
    expect(await screen.findByRole('combobox', { name: 'Series for Andor (2022)' })).toHaveValue('41474');
    expect(await screen.findByText('No match found')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Unknown Show' })).toBeDisabled();
    expect(api.callsTo('GET', 'series/lookup').map((c) => c.query.get('term'))).toEqual(
      expect.arrayContaining(['Andor', 'Unknown Show']),
    );
    expect((await axe(container)).violations).toEqual([]);

    await user.click(screen.getByRole('checkbox', { name: 'Select Andor (2022)' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Monitor for Andor (2022)' }), 'existing');
    await user.click(screen.getByRole('button', { name: 'Import 1 series' }));

    await waitFor(() => expect(api.callsTo('POST', 'series')).toHaveLength(1));
    expect(api.callsTo('POST', 'series')[0].body).toMatchObject({
      tvMazeId: 41474,
      path: '/tv/Andor (2022)',
      qualityProfileId: 1,
      monitored: true,
      addOptions: { monitor: 'existing' },
    });
    expect((api.callsTo('POST', 'series')[0].body as AddSeriesInput).rootFolderPath).toBeUndefined();
    expect(await screen.findByText('Imported 1 series')).toBeInTheDocument();
  });
});
