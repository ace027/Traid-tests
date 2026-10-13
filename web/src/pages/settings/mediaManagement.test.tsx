import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import {
  downloadClientConfigSchema,
  mediaManagementConfigSchema,
  namingConfigSchema,
  type NamingConfig,
  type NamingExamples,
} from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, validation400, type MockApi, type MockRoutes } from '../../test/server';
import { DownloadClients } from './DownloadClients';
import { MediaManagement } from './MediaManagement';

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

const examplesFor = (q: URLSearchParams): NamingExamples => ({
  singleEpisodeExample: `single:${q.get('standardEpisodeFormat')}`,
  multiEpisodeExample: 'multi',
  dailyEpisodeExample: 'daily',
  animeEpisodeExample: 'anime',
  seriesFolderExample: 'The Series (2010)',
  seasonFolderExample: 'Season 01',
  specialsFolderExample: 'Specials',
});

let api: MockApi;
let naming: NamingConfig;

const routes = (overrides: MockRoutes = {}): MockRoutes => ({
  'GET rootfolder': () => [],
  'GET config/mediamanagement': () => mediaManagementConfigSchema.parse({}),
  'PUT config/mediamanagement': (req) => ({ ...mediaManagementConfigSchema.parse({}), ...(req.body as object) }),
  'GET config/naming': () => naming,
  'PUT config/naming': (req) => ({ ...naming, ...(req.body as object) }),
  'GET config/naming/examples': (req) => examplesFor(req.query),
  'GET config/downloadclient': () => downloadClientConfigSchema.parse({}),
  'PUT config/downloadclient': (req) => ({ ...downloadClientConfigSchema.parse({}), ...(req.body as object) }),
  'GET downloadclient': () => [],
  ...overrides,
});

beforeEach(() => {
  naming = namingConfigSchema.parse({});
});
afterEach(() => api?.restore());

describe('Media management settings', () => {
  it('requests examples with the draft and shows them', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    expect(await screen.findByText(/^single:/)).toHaveTextContent(naming.standardEpisodeFormat);
    const input = screen.getByLabelText('Standard episode format');
    await user.clear(input);
    await user.type(input, '{{Series Title} draft');
    expect(await screen.findByText('single:{Series Title} draft')).toBeInTheDocument();
    expect(api.callsTo('GET', 'config/naming/examples').at(-1)?.query.get('standardEpisodeFormat')).toBe('{Series Title} draft');
  });

  it('inserts a clicked token into the format', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    const input = (await screen.findByLabelText('Series folder format')) as HTMLInputElement;
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /Tokens for Series folder format/ }));
    await user.click(screen.getByRole('button', { name: '{Series Title}' }));
    expect(input.value).toBe('{Series Title}');
  });

  it('shows the server naming error on the field', async () => {
    api = mockApi(
      routes({ 'PUT config/naming': () => validation400('standardEpisodeFormat', 'Unknown token {Bogus}') }),
    );
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    const input = await screen.findByLabelText('Standard episode format');
    await user.type(input, '{{Bogus}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Unknown token {Bogus}')).toBeInTheDocument();
    expect(input).toBeInvalid();
  });

  it('only sends a save after edits, with just the changed fields', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Create empty series folders' }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.callsTo('PUT', 'config/mediamanagement')).toHaveLength(1));
    expect(api.callsTo('PUT', 'config/mediamanagement')[0].body).toEqual({ createEmptySeriesFolders: true });
    expect(api.callsTo('PUT', 'config/naming')).toHaveLength(0);
  });

  it('edits the recycle bin', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    await user.type(await screen.findByLabelText('Recycle bin'), '/recycle');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'config/mediamanagement')[0]?.body).toEqual({ recycleBin: '/recycle' }));
  });

  it('has no axe violations', async () => {
    api = mockApi(routes());
    const { container } = renderPage(<MediaManagement />);
    await screen.findByText(/^single:/);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Completed download handling', () => {
  it('saves each switch independently', async () => {
    api = mockApi(routes());
    const user = userEvent.setup();
    renderPage(<DownloadClients />);
    await user.click(await screen.findByRole('switch', { name: 'Redownload failed' }));
    await waitFor(() => expect(api.callsTo('PUT', 'config/downloadclient')).toHaveLength(1));
    expect(api.callsTo('PUT', 'config/downloadclient')[0].body).toEqual({ autoRedownloadFailed: false });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enable' })).toBeEnabled());
    await user.click(screen.getByRole('switch', { name: 'Enable' }));
    await waitFor(() => expect(api.callsTo('PUT', 'config/downloadclient')).toHaveLength(2));
    expect(api.callsTo('PUT', 'config/downloadclient')[1].body).toEqual({ enableCompletedDownloadHandling: false });
  });
});
