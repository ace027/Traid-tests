import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { Paged, WantedRecord } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { makeEpisode, makeEpisodeFile, makeSeries } from '../series/fixtures';
import { CutoffUnmet } from './CutoffUnmet';
import { Missing } from './Missing';

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <main>{page}</main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const record = (overrides: Partial<WantedRecord> = {}): WantedRecord => ({
  ...makeEpisode({ id: 102, episodeNumber: 2, title: "Cat's in the Bag...", airDate: '2008-01-27', airDateUtc: '2008-01-28T02:00:00Z' }),
  series: makeSeries(),
  ...overrides,
});

const records = (): WantedRecord[] => [
  record(),
  record({ id: 103, episodeNumber: 3, title: '...And the Bag in the River', airDate: '2008-02-10', airDateUtc: '2008-02-11T02:00:00Z' }),
];

function paged(list: WantedRecord[], totalRecords = list.length, page = 1): Paged<WantedRecord> {
  return { page, pageSize: 20, sortKey: 'airDateUtc', sortDirection: 'descending', totalRecords, records: list };
}

const routes = (list: WantedRecord[], extra: MockRoutes = {}): MockRoutes => ({
  'GET wanted/missing': () => paged(list),
  'GET wanted/cutoff': () => paged(list),
  'POST command': (req) => ({ id: 1, name: (req.body as { name: string }).name, status: 'queued' }),
  'PUT episode/monitor': () => ({}),
  'GET episodefile': () => [makeEpisodeFile({ id: 501 })],
  ...extra,
});

let api: MockApi;
afterEach(() => api?.restore());

describe('Missing', () => {
  it('renders rows with series link, code, title and air date', async () => {
    api = mockApi(routes(records()));
    renderPage(<Missing />);
    expect(screen.getByRole('heading', { level: 1, name: 'Missing' })).toBeInTheDocument();
    const row = await screen.findByTestId('wanted-102');
    expect(within(row).getByRole('link', { name: 'Breaking Bad' })).toHaveAttribute('href', '/series/breaking-bad');
    expect(within(row).getByText('S01E02')).toBeInTheDocument();
    expect(within(row).getByText("Cat's in the Bag...")).toBeInTheDocument();
    expect(within(row).getByText(/2008/)).toBeInTheDocument();
    const call = api.callsTo('GET', 'wanted/missing')[0];
    expect(call.query.get('monitored')).toBe('true');
    expect(call.query.get('sortKey')).toBe('airDateUtc');
    expect(call.query.get('includeSeries')).toBe('true');
  });

  it('searches the selected episodes with EpisodeSearch', async () => {
    const user = userEvent.setup();
    api = mockApi(routes(records()));
    renderPage(<Missing />);
    await screen.findByTestId('wanted-102');
    expect(screen.getByRole('button', { name: 'Search selected' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Search selected (2)' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(1));
    expect(api.callsTo('POST', 'command')[0].body).toEqual({ name: 'EpisodeSearch', episodeIds: [102, 103] });
  });

  it('searches one row from its search button', async () => {
    const user = userEvent.setup();
    api = mockApi(routes(records()));
    renderPage(<Missing />);
    await user.click(await screen.findByRole('button', { name: 'Search Breaking Bad S01E03' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')[0]?.body).toEqual({ name: 'EpisodeSearch', episodeIds: [103] }));
  });

  it('asks for confirmation before searching all', async () => {
    const user = userEvent.setup();
    api = mockApi(routes(records(), { 'GET wanted/missing': () => paged(records(), 57) }));
    renderPage(<Missing />);
    await screen.findByTestId('wanted-102');
    await user.click(screen.getByRole('button', { name: 'Search all' }));
    const dialog = screen.getByRole('dialog', { name: 'Search all missing episodes' });
    expect(dialog).toHaveTextContent('57 missing episodes');
    expect(api.callsTo('POST', 'command')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(1));
    expect(api.callsTo('POST', 'command')[0].body).toEqual({ name: 'MissingEpisodeSearch' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('unmonitors the selected episodes', async () => {
    const user = userEvent.setup();
    api = mockApi(routes(records()));
    renderPage(<Missing />);
    await user.click(await screen.findByRole('checkbox', { name: 'Select Breaking Bad S01E03' }));
    await user.click(screen.getByRole('button', { name: 'Unmonitor selected' }));
    await waitFor(() => expect(api.callsTo('PUT', 'episode/monitor')).toHaveLength(1));
    expect(api.callsTo('PUT', 'episode/monitor')[0].body).toEqual({ episodeIds: [103], monitored: false });
    // The list is refetched after the change.
    await waitFor(() => expect(api.callsTo('GET', 'wanted/missing').length).toBeGreaterThan(1));
  });

  it('pages and sorts', async () => {
    const user = userEvent.setup();
    api = mockApi(routes(records(), { 'GET wanted/missing': (req) => paged(records(), 45, Number(req.query.get('page'))) }));
    renderPage(<Missing />);
    await screen.findByText('Page 1 of 3');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.callsTo('GET', 'wanted/missing').at(-1)!.query.get('page')).toBe('2'));
    await user.click(screen.getByRole('button', { name: /Series/ }));
    await waitFor(() => {
      const q = api.callsTo('GET', 'wanted/missing').at(-1)!.query;
      expect(q.get('sortKey')).toBe('series.sortTitle');
      expect(q.get('sortDirection')).toBe('ascending');
      expect(q.get('page')).toBe('1');
    });
  });

  it('sends the monitored filter', async () => {
    const user = userEvent.setup();
    api = mockApi(routes(records()));
    renderPage(<Missing />);
    await screen.findByTestId('wanted-102');
    await user.selectOptions(screen.getByLabelText('Filter'), 'Unmonitored');
    await waitFor(() => expect(api.callsTo('GET', 'wanted/missing').at(-1)!.query.get('monitored')).toBe('false'));
    expect(screen.getByRole('button', { name: 'Monitor selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Search all' })).toBeDisabled();
  });

  it('shows the empty state', async () => {
    api = mockApi(routes([]));
    renderPage(<Missing />);
    expect(await screen.findByText('No missing episodes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search all' })).toBeDisabled();
  });

  it('has no axe violations', async () => {
    api = mockApi(routes(records()));
    const { container } = renderPage(<Missing />);
    await screen.findByTestId('wanted-102');
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Cutoff Unmet', () => {
  const cutoffRecords = () => [record({ id: 101, episodeNumber: 1, title: 'Pilot', hasFile: true, episodeFileId: 501 })];

  it('shows the current quality and searches all with CutoffUnmetEpisodeSearch', async () => {
    const user = userEvent.setup();
    api = mockApi(routes(cutoffRecords()));
    renderPage(<CutoffUnmet />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cutoff Unmet' })).toBeInTheDocument();
    const row = await screen.findByTestId('wanted-101');
    const file = makeEpisodeFile({ id: 501 });
    expect(await within(row).findByText(file.quality.quality.name)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search all' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')[0]?.body).toEqual({ name: 'CutoffUnmetEpisodeSearch' }));
  });

  it('shows its empty state and passes axe', async () => {
    api = mockApi(routes([]));
    const { container } = renderPage(<CutoffUnmet />);
    expect(await screen.findByText('No episodes below cutoff')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
});
