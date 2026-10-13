import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { ManualImportItem, Paged, QueueResource } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { makeEpisode, makeSeries } from '../series/fixtures';
import { ManualImportModal } from './ManualImportModal';
import { Queue } from './Queue';

function renderUi(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <main>{ui}</main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const quality = { quality: { id: 3, name: 'WEBDL-1080p', source: 'web' as const, resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } };

const item = (overrides: Partial<ManualImportItem> = {}): ManualImportItem => ({
  id: 0,
  path: '/downloads/show/a.mkv',
  relativePath: 'a.mkv',
  folderName: 'show',
  name: 'a',
  size: 1000,
  series: { id: 1, title: 'Breaking Bad' },
  seasonNumber: 1,
  episodes: [{ id: 101, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' }],
  quality,
  releaseGroup: 'GRP',
  downloadId: 'dl1',
  rejections: [],
  ...overrides,
});

const listing = (): ManualImportItem[] => [
  item(),
  item({
    id: 1,
    path: '/downloads/show/b.mkv',
    relativePath: 'b.mkv',
    series: undefined,
    seasonNumber: undefined,
    episodes: [],
    rejections: [{ reason: 'Unknown series', type: 'permanent' }],
  }),
];

let api: MockApi;
const routes = (overrides: MockRoutes = {}): MockRoutes => ({
  'GET manualimport': listing,
  'GET series': () => [makeSeries()],
  'GET episode': () => [
    makeEpisode({ id: 101, episodeNumber: 1, title: 'Pilot' }),
    makeEpisode({ id: 102, episodeNumber: 2, title: 'Cat in the Bag' }),
    makeEpisode({ id: 201, seasonNumber: 2, episodeNumber: 1, title: 'Seven Thirty-Seven' }),
  ],
  'POST command': (req) => ({ id: 1, ...(req.body as object) }),
  ...overrides,
});

afterEach(() => api?.restore());

describe('ManualImportModal', () => {
  it('lists files with rejections and only checks importable rows', async () => {
    api = mockApi(routes());
    renderUi(<ManualImportModal downloadId="dl1" title="Breaking.Bad.S01" onClose={() => {}} />);
    expect(await screen.findByText('b.mkv')).toBeInTheDocument();
    expect(screen.getByText('Unknown series')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Import a.mkv' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Import b.mkv' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Import 1 file' })).toBeEnabled();
    expect(api.callsTo('GET', 'manualimport')[0].query.get('downloadId')).toBe('dl1');
  });

  it('imports the edited mapping with the chosen mode', async () => {
    api = mockApi(routes());
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderUi(<ManualImportModal downloadId="dl1" title="x" onClose={onClose} />);
    await screen.findByText('b.mkv');

    await user.selectOptions(screen.getByLabelText('Series for b.mkv'), 'Breaking Bad');
    await user.selectOptions(screen.getByLabelText('Season for b.mkv'), 'Season 1');
    await user.selectOptions(await screen.findByLabelText('Episodes for b.mkv'), ['2. Cat in the Bag']);
    await user.selectOptions(screen.getByLabelText('Quality for b.mkv'), 'Bluray-1080p');
    await user.selectOptions(screen.getByLabelText('Import mode'), 'Copy');

    await user.click(screen.getByRole('button', { name: 'Import 2 files' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(1));
    const body = api.callsTo('POST', 'command')[0].body as { name: string; importMode: string; files: { path: string; seriesId: number; episodeIds: number[]; quality: { quality: { id: number } } }[] };
    expect(body.name).toBe('ManualImport');
    expect(body.importMode).toBe('copy');
    expect(body.files).toHaveLength(2);
    expect(body.files[0]).toMatchObject({ path: '/downloads/show/a.mkv', seriesId: 1, episodeIds: [101] });
    expect(body.files[1]).toMatchObject({ path: '/downloads/show/b.mkv', seriesId: 1, episodeIds: [102] });
    expect(body.files[1].quality.quality.id).toBe(7);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('clears the episodes when the season changes', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderUi(<ManualImportModal downloadId="dl1" title="x" onClose={() => {}} />);
    await screen.findByText('a.mkv');
    await user.selectOptions(screen.getByLabelText('Season for a.mkv'), 'Season 2');
    expect(screen.getByRole('button', { name: /Import 0 files/ })).toBeDisabled();
  });

  it('shows an empty state when the folder has no video files', async () => {
    api = mockApi(routes({ 'GET manualimport': () => [] }));
    renderUi(<ManualImportModal folder="/downloads/empty" title="empty" onClose={() => {}} />);
    expect(await screen.findByText('No video files found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import 0 files/ })).toBeDisabled();
  });

  it('shows an error state', async () => {
    api = mockApi(routes({ 'GET manualimport': () => ({ status: 500, body: { message: 'boom' } }) }));
    renderUi(<ManualImportModal downloadId="dl1" title="x" onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('has no axe violations', async () => {
    api = mockApi(routes());
    renderUi(<ManualImportModal downloadId="dl1" title="x" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('b.mkv');
    expect((await axe(dialog)).violations).toEqual([]);
  });
});

describe('Queue manual import', () => {
  const queueItem = (overrides: Partial<QueueResource> = {}): QueueResource =>
    ({
      id: 1,
      seriesId: 1,
      episodeIds: [101],
      seasonNumber: 1,
      title: 'Breaking.Bad.S01E01',
      size: 1000,
      sizeleft: 0,
      status: 'warning',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importPending',
      statusMessages: [{ title: 'No files found are eligible for import', messages: [] }],
      downloadId: 'dl1',
      protocol: 'usenet',
      downloadClient: 'SAB',
      quality,
      ...overrides,
    }) as QueueResource;

  const paged = (records: QueueResource[]): Paged<QueueResource> => ({
    page: 1,
    pageSize: 20,
    sortKey: 'timeleft',
    sortDirection: 'ascending',
    totalRecords: records.length,
    records,
  });

  it('shows the button on importPending warning rows and opens the modal', async () => {
    api = mockApi(
      routes({
        'GET queue': () => paged([queueItem(), queueItem({ id: 2, title: 'Other.Download', status: 'downloading', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading' })]),
        'GET queue/status': () => ({ totalCount: 2, count: 2, unknownCount: 0, errors: false, warnings: true }),
      }),
    );
    const user = userEvent.setup();
    renderUi(<Queue />);
    const button = await screen.findByRole('button', { name: /Manual import Breaking\.Bad\.S01E01/ });
    expect(screen.queryByRole('button', { name: /Manual import Other\.Download/ })).not.toBeInTheDocument();
    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Manual import')).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET', 'manualimport')).toHaveLength(1));
  });
});
