import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { BlocklistResource, HistoryResource, Paged } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { makeEpisode, makeSeries } from '../series/fixtures';
import { Blocklist } from './Blocklist';
import { History } from './History';
import { formatRelative, historyDetails } from './historyHooks';

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

const quality = { quality: { id: 3, name: 'WEBDL-1080p', source: 'web', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } };

const makeHistory = (overrides: Partial<HistoryResource> = {}): HistoryResource =>
  ({
    id: 1,
    seriesId: 1,
    episodeId: 11,
    sourceTitle: 'Breaking.Bad.S01E02.1080p.WEB-DL-GROUP',
    quality,
    date: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    eventType: 'grabbed',
    downloadId: 'abc',
    data: { indexer: 'NZBgeek', downloadClient: 'SABnzbd', releaseGroup: 'GROUP', size: '1048576' },
    ...overrides,
  }) as HistoryResource;

const makeBlock = (overrides: Partial<BlocklistResource> = {}): BlocklistResource =>
  ({
    id: 1,
    seriesId: 1,
    episodeIds: [11],
    sourceTitle: 'Breaking.Bad.S01E02.720p.HDTV-BAD',
    quality,
    date: new Date(Date.now() - 86_400_000).toISOString(),
    protocol: 'usenet',
    indexer: 'NZBgeek',
    message: 'Download failed',
    ...overrides,
  }) as BlocklistResource;

function paged<T>(records: T[], totalRecords = records.length, page = 1): Paged<T> {
  return { page, pageSize: 20, sortKey: 'date', sortDirection: 'descending', totalRecords, records };
}

const baseRoutes: MockRoutes = {
  'GET series': () => [makeSeries()],
  'GET episode': () => [makeEpisode({ id: 11, seasonNumber: 1, episodeNumber: 2, title: 'Cat in the Bag' })],
};

let api: MockApi;
afterEach(() => api?.restore());

describe('history helpers', () => {
  it('formats relative dates and readable details', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(formatRelative('2026-10-13T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(formatRelative(undefined, now)).toBe('-');
    expect(historyDetails({ size: '1048576', reason: 'upgrade', downloadClient: 'SAB', customThing: 'x' })).toEqual([
      { label: 'Download client', value: 'SAB' },
      { label: 'Reason', value: 'Replaced by a better quality file' },
      { label: 'Size', value: '1.0 MB' },
      { label: 'Custom thing', value: 'x' },
    ]);
  });
});

describe('History', () => {
  it('lists events with icon text labels, series links and episode titles', async () => {
    api = mockApi({
      ...baseRoutes,
      'GET history': () =>
        paged([
          makeHistory(),
          makeHistory({ id: 2, eventType: 'downloadFolderImported', data: { importedPath: '/tv/Breaking Bad/S01E02.mkv' } }),
          makeHistory({ id: 3, eventType: 'downloadFailed', data: { message: 'Unpacking failed' } }),
        ]),
    });
    renderPage(<History />);
    const row = await screen.findByTestId('history-1');
    expect(within(row).getByText('Grabbed')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Breaking Bad' })).toHaveAttribute('href', '/series/breaking-bad');
    expect(await within(row).findByText('S01E02 - Cat in the Bag')).toBeInTheDocument();
    expect(within(row).getByText('WEBDL-1080p')).toBeInTheDocument();
    expect(within(row).getByText(/3 hours ago/)).toHaveAttribute('title');
    expect(within(screen.getByTestId('history-2')).getByText('Imported')).toBeInTheDocument();
    expect(within(screen.getByTestId('history-3')).getByText('Failed')).toBeInTheDocument();
  });

  it('filters by event type and resets to page 1', async () => {
    const user = userEvent.setup();
    api = mockApi({ ...baseRoutes, 'GET history': () => paged([makeHistory()], 45) });
    renderPage(<History />);
    await screen.findByTestId('history-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.callsTo('GET', 'history').at(-1)!.query.get('page')).toBe('2'));

    await user.selectOptions(screen.getByLabelText('Event type'), 'Failed');
    await waitFor(() => expect(api.callsTo('GET', 'history').at(-1)!.query.get('eventType')).toBe('downloadFailed'));
    expect(api.callsTo('GET', 'history').at(-1)!.query.get('page')).toBe('1');

    await user.selectOptions(screen.getByLabelText('Event type'), 'All');
    await waitFor(() => expect(api.callsTo('GET', 'history').at(-1)!.query.has('eventType')).toBe(false));
  });

  it('pages through events', async () => {
    const user = userEvent.setup();
    api = mockApi({
      ...baseRoutes,
      'GET history': (req) => paged([makeHistory({ id: Number(req.query.get('page')) })], 30, Number(req.query.get('page'))),
    });
    renderPage(<History />);
    await screen.findByText('Page 1 of 2');
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');
    expect(await screen.findByTestId('history-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('expands a row to show event details in plain language', async () => {
    const user = userEvent.setup();
    api = mockApi({ ...baseRoutes, 'GET history': () => paged([makeHistory()]) });
    renderPage(<History />);
    const toggle = await screen.findByRole('button', { name: /Show details for Breaking\.Bad/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(details).getByText('Indexer')).toBeInTheDocument();
    expect(within(details).getByText('NZBgeek')).toBeInTheDocument();
    expect(within(details).getByText('Download client')).toBeInTheDocument();
    expect(within(details).getByText('Release group')).toBeInTheDocument();
    expect(within(details).getByText('1.0 MB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Hide details/ }));
    expect(screen.queryByText('NZBgeek')).not.toBeInTheDocument();
  });

  it('shows empty states', async () => {
    const user = userEvent.setup();
    api = mockApi({ ...baseRoutes, 'GET history': () => paged([]) });
    renderPage(<History />);
    expect(await screen.findByText('No history yet')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Event type'), 'Renamed');
    expect(await screen.findByText('No matching events')).toBeInTheDocument();
  });

  it('shows a retryable error', async () => {
    api = mockApi({ ...baseRoutes, 'GET history': () => ({ status: 500, body: { message: 'Database locked' } }) });
    renderPage(<History />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Database locked');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('has no axe violations (expanded)', async () => {
    const user = userEvent.setup();
    api = mockApi({ ...baseRoutes, 'GET history': () => paged([makeHistory(), makeHistory({ id: 2, eventType: 'episodeFileRenamed' })]) });
    const { container } = renderPage(<History />);
    await screen.findByTestId('history-2');
    await user.click(screen.getAllByRole('button', { name: /Show details for/ })[0]);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Blocklist', () => {
  const routes = (records: BlocklistResource[], extra: MockRoutes = {}): MockRoutes => ({
    ...baseRoutes,
    'GET blocklist': () => paged(records),
    'DELETE blocklist/:id': () => ({}),
    'DELETE blocklist/bulk': () => ({}),
    ...extra,
  });

  it('lists blocked releases with protocol, indexer and message', async () => {
    api = mockApi(routes([makeBlock()]));
    renderPage(<Blocklist />);
    const row = await screen.findByTestId('blocklist-1');
    expect(within(row).getByText('Breaking.Bad.S01E02.720p.HDTV-BAD')).toBeInTheDocument();
    expect(within(row).getByText('Usenet')).toBeInTheDocument();
    expect(within(row).getByText('NZBgeek')).toBeInTheDocument();
    expect(within(row).getByText('Download failed')).toBeInTheDocument();
    expect(within(row).getByText(/yesterday|1 day ago/)).toBeInTheDocument();
  });

  it('removes one release after confirmation', async () => {
    const user = userEvent.setup();
    api = mockApi(routes([makeBlock()]));
    renderPage(<Blocklist />);
    await user.click(await screen.findByRole('button', { name: 'Remove Breaking.Bad.S01E02.720p.HDTV-BAD from the blocklist' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove from blocklist' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.callsTo('DELETE', 'blocklist/1')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('bulk removes the selected releases', async () => {
    const user = userEvent.setup();
    api = mockApi(routes([makeBlock(), makeBlock({ id: 2, sourceTitle: 'Other.Release' }), makeBlock({ id: 3, sourceTitle: 'Third.Release' })]));
    renderPage(<Blocklist />);
    await screen.findByTestId('blocklist-1');
    expect(screen.getByRole('button', { name: 'Remove selected' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select Breaking.Bad.S01E02.720p.HDTV-BAD' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Third.Release' }));
    await user.click(screen.getByRole('button', { name: 'Remove selected (2)' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove 2 releases' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.callsTo('DELETE', 'blocklist/bulk')).toHaveLength(1));
    expect(api.callsTo('DELETE', 'blocklist/bulk')[0].body).toEqual({ ids: [1, 3] });
  });

  it('shows the empty state', async () => {
    api = mockApi(routes([]));
    renderPage(<Blocklist />);
    expect(await screen.findByText('Blocklist is empty')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    api = mockApi(routes([makeBlock(), makeBlock({ id: 2, protocol: 'torrent', indexer: undefined, message: undefined })]));
    const { container } = renderPage(<Blocklist />);
    await screen.findByTestId('blocklist-2');
    expect((await axe(container)).violations).toEqual([]);
  });
});
