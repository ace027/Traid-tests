import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { Episode, Paged, QueueResource } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { makeEpisode, makeSeries } from '../series/fixtures';
import { formatTimeLeft, queueProgress } from './hooks';
import { Queue } from './Queue';

function renderQueue() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <main>
            <Queue />
          </main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const quality = { quality: { id: 3, name: 'WEBDL-1080p', source: 'web', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } };

const makeItem = (overrides: Partial<QueueResource> = {}): QueueResource =>
  ({
    id: 1,
    seriesId: 1,
    episodeIds: [11],
    seasonNumber: 1,
    title: 'Breaking.Bad.S01E02.1080p.WEB-DL.DD5.1.H.264-GROUP',
    size: 1000,
    sizeleft: 580,
    timeleft: '00:12:05',
    status: 'downloading',
    trackedDownloadStatus: 'ok',
    trackedDownloadState: 'downloading',
    statusMessages: [],
    downloadId: 'SABnzbd_nzo_1',
    protocol: 'usenet',
    downloadClient: 'SAB',
    indexer: 'NZBgeek',
    quality,
    ...overrides,
  }) as QueueResource;

const paged = (records: QueueResource[], totalRecords = records.length, page = 1): Paged<QueueResource> => ({
  page,
  pageSize: 20,
  sortKey: 'timeleft',
  sortDirection: 'ascending',
  totalRecords,
  records,
});

const episodes = (): Episode[] => [makeEpisode({ id: 11, seasonNumber: 1, episodeNumber: 2, title: 'Cat in the Bag' })];

const queueRoutes = (records: QueueResource[], overrides: MockRoutes = {}): MockRoutes => ({
  'GET queue': () => paged(records),
  'GET queue/status': () => ({ totalCount: records.length, count: records.length, unknownCount: 0, errors: false, warnings: false }),
  'GET series': () => [makeSeries()],
  'GET episode': episodes,
  ...overrides,
});

let api: MockApi;
afterEach(() => api?.restore());

describe('formatting', () => {
  it('computes progress and normalizes time left', () => {
    expect(queueProgress({ size: 1000, sizeleft: 580 })).toBe(42);
    expect(queueProgress({ size: 0, sizeleft: 0 })).toBe(0);
    expect(formatTimeLeft('00:12:05')).toBe('0:12:05');
    expect(formatTimeLeft('1.02:03:04')).toBe('26:03:04');
    expect(formatTimeLeft(undefined)).toBe('-');
  });
});

describe('Queue', () => {
  it('renders rows with progress, status text and episode details without axe violations', async () => {
    const failed = makeItem({
      id: 2,
      episodeIds: [21, 22],
      title: 'Breaking.Bad.S02.1080p.WEB-DL-GROUP',
      status: 'completed',
      trackedDownloadStatus: 'warning',
      statusMessages: [{ title: 'Breaking.Bad.S02', messages: ['No files found are eligible for import'] }],
      sizeleft: 0,
      seasonNumber: 2,
      protocol: 'torrent',
      downloadClient: 'qBit',
    });
    api = mockApi(queueRoutes([makeItem(), failed]));
    const user = userEvent.setup();
    const { container } = renderQueue();
    expect(screen.getByRole('heading', { level: 1, name: 'Queue' })).toBeInTheDocument();

    const row = (await screen.findByTestId('queue-1')) as HTMLElement;
    const bar = within(row).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(within(row).getByText('42%')).toBeInTheDocument();
    expect(within(row).getByText('580 B left')).toBeInTheDocument();
    expect(within(row).getByText('Downloading')).toHaveClass('sr-only');
    expect(within(row).getByText('0:12:05')).toBeInTheDocument();
    expect(await within(row).findByText('S01E02 - Cat in the Bag')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Breaking Bad' })).toHaveAttribute('href', '/series/breaking-bad');
    expect(within(row).getByText('WEBDL-1080p')).toBeInTheDocument();

    const pack = screen.getByTestId('queue-2');
    expect(within(pack).getByText('Season 2')).toBeInTheDocument();
    expect(within(pack).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    const statusButton = within(pack).getByRole('button', { name: /Warning/ });
    expect(statusButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(statusButton);
    expect(statusButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(pack).getByText('No files found are eligible for import')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();

    expect((await axe(container)).violations).toEqual([]);
  });

  it('removes an item with blocklist and sends the right query', async () => {
    api = mockApi(queueRoutes([makeItem()], { 'DELETE queue/:id': () => ({ status: 200 }) }));
    const user = userEvent.setup();
    renderQueue();
    await user.click(await screen.findByRole('button', { name: `Remove ${makeItem().title}` }));
    const dialog = screen.getByRole('dialog', { name: 'Remove from queue' });
    expect(within(dialog).getByRole('checkbox', { name: 'Remove from download client' })).toBeChecked();
    const blocklist = within(dialog).getByRole('checkbox', { name: 'Add release to blocklist' });
    expect(blocklist).not.toBeChecked();
    expect((await axe(document.body)).violations).toEqual([]);
    await user.click(blocklist);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.callsTo('DELETE', 'queue/1')).toHaveLength(1));
    const query = api.callsTo('DELETE', 'queue/1')[0].query;
    expect(query.get('removeFromClient')).toBe('true');
    expect(query.get('blocklist')).toBe('true');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('removes the selected items in bulk', async () => {
    const items = [makeItem(), makeItem({ id: 2, title: 'Other.Release' }), makeItem({ id: 3, title: 'Third.Release' })];
    api = mockApi(queueRoutes(items, { 'DELETE queue/bulk': () => ({ status: 200 }) }));
    const user = userEvent.setup();
    renderQueue();
    const removeSelected = screen.getByRole('button', { name: /Remove selected/ });
    expect(removeSelected).toBeDisabled();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Other.Release' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Third.Release' }));
    await user.click(screen.getByRole('button', { name: 'Remove selected (2)' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove 2 items from queue' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Remove from download client' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.callsTo('DELETE', 'queue/bulk')).toHaveLength(1));
    expect(api.callsTo('DELETE', 'queue/bulk')[0].body).toEqual({ ids: [2, 3], removeFromClient: false, blocklist: false });
    expect(await screen.findByText('Removed 2 items from the queue')).toBeInTheDocument();
  });

  it('selects all rows on the page', async () => {
    api = mockApi(queueRoutes([makeItem(), makeItem({ id: 2, title: 'Other.Release' })]));
    const user = userEvent.setup();
    renderQueue();
    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Remove selected (2)' })).toBeEnabled();
  });

  it('shows unknown items when toggled and pages through results', async () => {
    const unknown = makeItem({ id: 9, seriesId: undefined, episodeIds: [], seasonNumber: undefined, title: 'Mystery.Show.S01E01' });
    api = mockApi(
      queueRoutes([], {
        'GET queue': (req) =>
          req.query.get('includeUnknownSeriesItems') === 'true'
            ? paged([unknown], 45, Number(req.query.get('page')))
            : paged([], 0),
        'GET queue/status': () => ({ totalCount: 1, count: 0, unknownCount: 1, errors: false, warnings: false }),
      }),
    );
    const user = userEvent.setup();
    renderQueue();
    expect(await screen.findByText('Queue is empty')).toBeInTheDocument();
    expect(await screen.findByText(/1 unknown item is hidden/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search for missing episodes' })).toHaveAttribute('href', '/wanted/missing');

    await user.click(screen.getByRole('switch', { name: 'Show unknown' }));
    const row = await screen.findByTestId('queue-9');
    expect(within(row).getByText('Unknown series')).toBeInTheDocument();
    expect(within(row).getByText('Mystery.Show.S01E01')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(api.callsTo('GET', 'queue').at(-1)!.query.get('page')).toBe('2');
  });

  it('sorts by progress and refreshes the downloads', async () => {
    api = mockApi(queueRoutes([makeItem()], { 'POST command': (req) => ({ id: 1, ...(req.body as object) }) }));
    const user = userEvent.setup();
    renderQueue();
    await screen.findByTestId('queue-1');
    await user.click(screen.getByRole('button', { name: /Progress/ }));
    await waitFor(() => expect(api.callsTo('GET', 'queue').at(-1)!.query.get('sortKey')).toBe('progress'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(1));
    expect(api.callsTo('POST', 'command')[0].body).toEqual({ name: 'RefreshMonitoredDownloads' });
  });

  it('shows an error with a working Retry', async () => {
    let fail = true;
    api = mockApi(
      queueRoutes([makeItem()], {
        'GET queue': () => (fail ? { status: 500, body: { message: 'Download client unavailable' } } : paged([makeItem()])),
      }),
    );
    const user = userEvent.setup();
    renderQueue();
    expect(await screen.findByRole('alert')).toHaveTextContent('Download client unavailable');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('queue-1')).toBeInTheDocument();
  });
});
