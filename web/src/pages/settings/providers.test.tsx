import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { DownloadClientInput, DownloadClientResource, IndexerInput, IndexerResource, Tag } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, validation400, type MockApi, type MockRoutes } from '../../test/server';
import { DownloadClients } from './DownloadClients';
import { Indexers } from './Indexers';

function renderPage(page: ReactElement) {
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

const tags = (): Tag[] => [{ id: 1, label: 'anime' }];

const newznabTemplate = (): IndexerResource => ({
  id: 0,
  name: '',
  implementation: 'Newznab',
  protocol: 'usenet',
  enableRss: true,
  enableAutomaticSearch: true,
  enableInteractiveSearch: true,
  priority: 25,
  tags: [],
  settings: {
    baseUrl: '',
    apiPath: '/api',
    apiKey: '',
    categories: [5030, 5040],
    animeCategories: [5070],
    minimumSeeders: 1,
    seedRatio: null,
    seedTime: null,
  },
});

const torznabTemplate = (): IndexerResource => ({
  ...newznabTemplate(),
  implementation: 'Torznab',
  protocol: 'torrent',
  settings: { ...newznabTemplate().settings, categories: [5000] },
});

const makeIndexer = (overrides: Partial<IndexerResource> = {}): IndexerResource => ({
  ...newznabTemplate(),
  id: 1,
  name: 'NZBgeek',
  enableRss: false,
  settings: { ...newznabTemplate().settings, baseUrl: 'https://api.nzbgeek.info', apiKey: '********' },
  ...overrides,
});

const clientTemplate = (implementation: DownloadClientResource['implementation']): DownloadClientResource => ({
  id: 0,
  name: '',
  implementation,
  protocol: implementation === 'SABnzbd' || implementation === 'NZBGet' ? 'usenet' : 'torrent',
  enable: true,
  priority: 1,
  removeCompletedDownloads: true,
  removeFailedDownloads: true,
  tags: [],
  settings: {
    host: 'localhost',
    port: implementation === 'Transmission' ? 9091 : implementation === 'NZBGet' ? 6789 : 8080,
    useSsl: false,
    urlBase: implementation === 'Transmission' ? '/transmission/' : '',
    username: implementation === 'NZBGet' ? 'nzbget' : '',
    password: '',
    apiKey: '',
    category: implementation === 'SABnzbd' || implementation === 'NZBGet' ? 'tv' : 'tv-sonarr',
  },
});

const indexerRoutes = (overrides: MockRoutes = {}): MockRoutes => ({
  'GET indexer': () => [makeIndexer()],
  'GET indexer/schema': () => [newznabTemplate(), torznabTemplate()],
  'GET indexerstatus': () => [{ indexerId: 1, disabledTill: new Date(Date.now() + 3_600_000).toISOString() }],
  'GET tag': tags,
  ...overrides,
});

let api: MockApi;
afterEach(() => api?.restore());

describe('Indexers', () => {
  it('lists indexers with text chips, protocol, priority and a disabled warning; no axe violations', async () => {
    api = mockApi(indexerRoutes());
    const { container } = renderPage(<Indexers />);
    expect(screen.getByRole('heading', { level: 1, name: 'Indexers' })).toBeInTheDocument();
    const card = (await screen.findByRole('button', { name: 'Edit NZBgeek' })).closest('section')!;
    expect(within(card).getByText('Usenet')).toBeInTheDocument();
    expect(within(card).getByText('RSS').parentElement).toHaveTextContent('RSS disabled');
    expect(within(card).getByText('Automatic Search').parentElement).toHaveTextContent('Automatic Search enabled');
    expect(within(card).getByText('Priority 25')).toBeInTheDocument();
    expect(await within(card).findByText(/Disabled until/)).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('adds a Newznab indexer and posts the expected body', async () => {
    api = mockApi(indexerRoutes({ 'POST indexer': (req) => ({ status: 201, body: { ...makeIndexer(), ...(req.body as object), id: 2 } }) }));
    const user = userEvent.setup();
    renderPage(<Indexers />);
    await user.click(screen.getByRole('button', { name: 'Add Indexer' }));
    const picker = screen.getByRole('dialog', { name: 'Add Indexer' });
    await user.click(await within(picker).findByRole('button', { name: /Newznab/ }));

    const dialog = screen.getByRole('dialog', { name: 'Add Indexer - Newznab' });
    expect(within(dialog).queryByLabelText('Minimum Seeders')).not.toBeInTheDocument();
    expect((await axe(document.body)).violations).toEqual([]);
    await user.type(within(dialog).getByLabelText(/Name/), 'DrunkenSlug');
    await user.type(within(dialog).getByLabelText(/^URL/), 'https://drunkenslug.com');
    await user.type(within(dialog).getByLabelText('API Key'), 'secret');
    await user.clear(within(dialog).getByLabelText('Categories'));
    await user.type(within(dialog).getByLabelText('Categories'), '5030, 5045');
    await user.click(within(dialog).getByRole('switch', { name: /Enable RSS/ }));
    await user.click(within(dialog).getByRole('button', { name: 'anime' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.callsTo('POST', 'indexer')).toHaveLength(1));
    expect(api.callsTo('POST', 'indexer')[0].body).toEqual({
      name: 'DrunkenSlug',
      implementation: 'Newznab',
      enableRss: false,
      enableAutomaticSearch: true,
      enableInteractiveSearch: true,
      priority: 25,
      tags: [1],
      settings: {
        baseUrl: 'https://drunkenslug.com',
        apiPath: '/api',
        apiKey: 'secret',
        categories: [5030, 5045],
        animeCategories: [5070],
        minimumSeeders: 1,
        seedRatio: null,
        seedTime: null,
      },
    } satisfies IndexerInput);
    expect(await screen.findByText('Added DrunkenSlug')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('validates categories and shows server validation errors inline', async () => {
    api = mockApi(indexerRoutes({ 'POST indexer': () => validation400('settings.baseUrl', 'Unable to connect to indexer') }));
    const user = userEvent.setup();
    renderPage(<Indexers />);
    await user.click(screen.getByRole('button', { name: 'Add Indexer' }));
    await user.click(await screen.findByRole('button', { name: /Torznab/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add Indexer - Torznab' });
    expect(within(dialog).getByLabelText('Seed Ratio')).toHaveAccessibleDescription('Stored, not enforced yet.');

    await user.type(within(dialog).getByLabelText(/Name/), 'Jackett');
    await user.type(within(dialog).getByLabelText(/^URL/), 'http://jackett:9117/api/v2.0/indexers/all/results/torznab');
    await user.clear(within(dialog).getByLabelText('Categories'));
    await user.type(within(dialog).getByLabelText('Categories'), '5000, tv');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByLabelText('Categories')).toHaveAccessibleDescription(expect.stringContaining('comma-separated numbers'));
    expect(api.callsTo('POST', 'indexer')).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('Categories'));
    await user.type(within(dialog).getByLabelText('Categories'), '5000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^URL/)).toHaveAccessibleDescription(expect.stringContaining('Unable to connect to indexer')),
    );
    expect(api.callsTo('POST', 'indexer')[0].body).toMatchObject({ settings: { categories: [5000], minimumSeeders: 1 } });
  });

  it('shows the server message when a test fails', async () => {
    api = mockApi(indexerRoutes({ 'POST indexer/test': () => ({ status: 400, body: { message: 'Invalid API key' } }) }));
    const user = userEvent.setup();
    renderPage(<Indexers />);
    await user.click(await screen.findByRole('button', { name: 'Edit NZBgeek' }));
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Test failed: Invalid API key')).toBeInTheDocument();
    expect(api.callsTo('POST', 'indexer/test')[0].body).toMatchObject({ id: 1, name: 'NZBgeek' });
  });

  it('keeps the masked API key unchanged when editing', async () => {
    api = mockApi(indexerRoutes({ 'PUT indexer/:id': (req) => ({ ...makeIndexer(), ...(req.body as object) }) }));
    const user = userEvent.setup();
    renderPage(<Indexers />);
    await user.click(await screen.findByRole('button', { name: 'Edit NZBgeek' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Indexer - NZBgeek' });
    expect(within(dialog).getByLabelText('API Key')).toHaveValue('********');
    expect(within(dialog).getByLabelText('API Key')).toHaveAttribute('type', 'password');
    await user.clear(within(dialog).getByLabelText(/Name/));
    await user.type(within(dialog).getByLabelText(/Name/), 'Geek');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'indexer/1')).toHaveLength(1));
    const body = api.callsTo('PUT', 'indexer/1')[0].body as IndexerInput;
    expect(body.name).toBe('Geek');
    expect(body.settings.apiKey).toBe('********');
  });

  it('deletes an indexer after confirmation', async () => {
    api = mockApi(indexerRoutes({ 'DELETE indexer/:id': () => ({ status: 200 }) }));
    const user = userEvent.setup();
    renderPage(<Indexers />);
    await user.click(await screen.findByRole('button', { name: 'Edit NZBgeek' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete indexer' });
    expect(api.callsTo('DELETE', 'indexer/1')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE', 'indexer/1')).toHaveLength(1));
    expect(await screen.findByText('Deleted NZBgeek')).toBeInTheDocument();
  });

  it('tests all indexers and reports failures', async () => {
    api = mockApi(
      indexerRoutes({
        'POST indexer/testall': () => [{ id: 1, isValid: false, validationFailures: [{ propertyName: '', errorMessage: 'Timed out' }] }],
      }),
    );
    const user = userEvent.setup();
    renderPage(<Indexers />);
    await screen.findByRole('button', { name: 'Edit NZBgeek' });
    await user.click(screen.getByRole('button', { name: 'Test All' }));
    expect(await screen.findByText('NZBgeek: Timed out')).toBeInTheDocument();
  });

  it('shows an empty state when no indexers exist', async () => {
    api = mockApi(indexerRoutes({ 'GET indexer': () => [] }));
    renderPage(<Indexers />);
    expect(await screen.findByText('No indexers')).toBeInTheDocument();
  });
});

describe('Download clients', () => {
  const clientRoutes = (overrides: MockRoutes = {}): MockRoutes => ({
    'GET downloadclient': () => [
      { ...clientTemplate('SABnzbd'), id: 1, name: 'SAB', settings: { ...clientTemplate('SABnzbd').settings, apiKey: '********' } },
    ],
    'GET downloadclient/schema': () =>
      (['SABnzbd', 'NZBGet', 'QBittorrent', 'Transmission'] as const).map((impl) => clientTemplate(impl)),
    'GET tag': tags,
    ...overrides,
  });

  it('tests all clients and reports failures', async () => {
    api = mockApi(
      clientRoutes({
        'POST downloadclient/testall': () => [{ id: 1, isValid: false, validationFailures: [{ propertyName: '', errorMessage: 'Connection refused' }] }],
      }),
    );
    const user = userEvent.setup();
    renderPage(<DownloadClients />);
    await screen.findByRole('button', { name: 'Edit SAB' });
    await user.click(screen.getByRole('button', { name: 'Test All' }));
    expect(await screen.findByText('SAB: Connection refused')).toBeInTheDocument();
  });

  it('lists clients without axe violations', async () => {
    api = mockApi(clientRoutes());
    const { container } = renderPage(<DownloadClients />);
    const card = (await screen.findByRole('button', { name: 'Edit SAB' })).closest('section')!;
    expect(within(card).getByText('SABnzbd at localhost:8080')).toBeInTheDocument();
    expect(within(card).getByText('Enabled')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('adds qBittorrent with username and password and no API key', async () => {
    api = mockApi(clientRoutes({ 'POST downloadclient': (req) => ({ status: 201, body: { ...(req.body as object), id: 2 } }) }));
    const user = userEvent.setup();
    renderPage(<DownloadClients />);
    await user.click(screen.getByRole('button', { name: 'Add Download Client' }));
    await user.click(await screen.findByRole('button', { name: /qBittorrent/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add Download Client - qBittorrent' });
    expect(within(dialog).getByLabelText('Username')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(within(dialog).queryByLabelText('API Key')).not.toBeInTheDocument();
    expect((await axe(document.body)).violations).toEqual([]);

    await user.type(within(dialog).getByLabelText(/Name/), 'qBit');
    await user.type(within(dialog).getByLabelText('Username'), 'admin');
    await user.type(within(dialog).getByLabelText('Password'), 'adminadmin');
    await user.click(within(dialog).getByRole('switch', { name: /Remove Completed/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('POST', 'downloadclient')).toHaveLength(1));
    expect(api.callsTo('POST', 'downloadclient')[0].body).toEqual({
      name: 'qBit',
      implementation: 'QBittorrent',
      enable: true,
      priority: 1,
      removeCompletedDownloads: false,
      removeFailedDownloads: true,
      tags: [],
      settings: {
        host: 'localhost',
        port: 8080,
        useSsl: false,
        urlBase: '',
        username: 'admin',
        password: 'adminadmin',
        apiKey: '',
        category: 'tv-sonarr',
      },
    } satisfies DownloadClientInput);
  });

  it('shows the API key (masked) for SABnzbd, validates the port and tests the connection', async () => {
    api = mockApi(clientRoutes({ 'POST downloadclient/test': () => ({}) }));
    const user = userEvent.setup();
    renderPage(<DownloadClients />);
    await user.click(await screen.findByRole('button', { name: 'Edit SAB' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Download Client - SAB' });
    expect(within(dialog).getByLabelText('API Key')).toHaveValue('********');
    expect(within(dialog).queryByLabelText('Username')).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(/Port/));
    await user.type(within(dialog).getByLabelText(/Port/), '70000');
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(within(dialog).getByLabelText(/Port/)).toHaveAccessibleDescription(expect.stringContaining('1 to 65535'));
    expect(api.callsTo('POST', 'downloadclient/test')).toHaveLength(0);
    await user.clear(within(dialog).getByLabelText(/Port/));
    await user.type(within(dialog).getByLabelText(/Port/), '8085');
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Test succeeded')).toBeInTheDocument();
    expect(api.callsTo('POST', 'downloadclient/test')[0].body).toMatchObject({ id: 1, settings: { port: 8085, apiKey: '********' } });
  });
});
