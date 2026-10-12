import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { HostConfig, QualityDefinition, QualityProfile, RootFolder, Tag, UiConfig } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, validation400, type MockApi } from '../../test/server';
import { General } from './General';
import { MediaManagement } from './MediaManagement';
import { Profiles } from './Profiles';
import { Quality } from './Quality';
import { SettingsIndex } from './SettingsIndex';
import { Tags } from './Tags';
import { UiSettings } from './UiSettings';

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

const q = (id: number, name: string, resolution: number) => ({ id, name, source: 'web' as const, resolution });
const SDTV = q(1, 'SDTV', 480);
const WEB720 = q(5, 'WEBDL-720p', 720);
const WEB1080 = q(3, 'WEBDL-1080p', 1080);

/** Items are stored lowest quality first, like the server returns them. */
const profileItems = (allowed = true) => [SDTV, WEB720, WEB1080].map((quality) => ({ quality, allowed }));
const hdProfile = (): QualityProfile => ({ id: 1, name: 'HD', upgradeAllowed: true, cutoff: WEB1080.id, items: profileItems() });

let api: MockApi;
afterEach(() => api?.restore());

describe('Settings index', () => {
  it('links to every settings page and has no axe violations', async () => {
    api = mockApi({});
    const { container } = renderPage(<SettingsIndex />);
    expect(screen.getByRole('link', { name: /Media Management/ })).toHaveAttribute('href', '/mediamanagement');
    expect(screen.getAllByRole('link')).toHaveLength(11);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Media Management', () => {
  const folders = (): RootFolder[] => [
    { id: 1, path: '/tv', accessible: true, freeSpace: 1.2 * 1024 ** 4, unmappedFolders: [] },
    { id: 2, path: '/mnt/gone', accessible: false, freeSpace: null, unmappedFolders: [] },
  ];

  it('lists root folders with free space and a warning for inaccessible ones', async () => {
    api = mockApi({ 'GET rootfolder': folders });
    const { container } = renderPage(<MediaManagement />);
    const row = (await screen.findByText('/tv')).closest('tr')!;
    expect(within(row).getByText('1.2 TB')).toBeInTheDocument();
    expect(within(row).getByText('Accessible')).toBeInTheDocument();
    expect(within(screen.getByText('/mnt/gone').closest('tr')!).getByText('Inaccessible')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('adds a root folder and lists it', async () => {
    const list = folders().slice(0, 1);
    api = mockApi({
      'GET rootfolder': () => list,
      'POST rootfolder': (req) => {
        const created = { id: 3, path: (req.body as { path: string }).path, accessible: true, freeSpace: 1024 ** 3, unmappedFolders: [] };
        list.push(created);
        return { status: 201, body: created };
      },
    });
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    await screen.findByText('/tv');
    await user.type(screen.getByLabelText('New root folder path'), '/anime');
    await user.click(screen.getByRole('button', { name: 'Add root folder' }));
    expect(await screen.findByText('/anime')).toBeInTheDocument();
    expect(api.callsTo('POST', 'rootfolder')[0].body).toEqual({ path: '/anime' });
  });

  it('shows a server validation error inline', async () => {
    api = mockApi({
      'GET rootfolder': () => [],
      'POST rootfolder': () => validation400('path', 'Folder does not exist'),
    });
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    expect(await screen.findByText('No root folders')).toBeInTheDocument();
    await user.type(screen.getByLabelText('New root folder path'), '/nope');
    await user.click(screen.getByRole('button', { name: 'Add root folder' }));
    expect(await screen.findByText('Folder does not exist')).toBeInTheDocument();
    expect(screen.getByLabelText('New root folder path')).toBeInvalid();
  });

  it('deletes a root folder after confirmation', async () => {
    let list = folders();
    api = mockApi({
      'GET rootfolder': () => list,
      'DELETE rootfolder/:id': (req) => {
        list = list.filter((f) => f.id !== Number(req.params.id));
        return {};
      },
    });
    const user = userEvent.setup();
    renderPage(<MediaManagement />);
    await user.click(await screen.findByRole('button', { name: 'Delete /tv' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('/tv')).not.toBeInTheDocument());
    expect(api.callsTo('DELETE', 'rootfolder/1')).toHaveLength(1);
  });
});

describe('Tags', () => {
  it('shows an empty state, creates and deletes a tag', async () => {
    let tags: Tag[] = [];
    api = mockApi({
      'GET tag': () => tags,
      'POST tag': (req) => {
        const tag = { id: 7, label: (req.body as { label: string }).label };
        tags = [tag];
        return { status: 201, body: tag };
      },
      'DELETE tag/:id': () => {
        tags = [];
        return {};
      },
    });
    const user = userEvent.setup();
    const { container } = renderPage(<Tags />);
    expect(await screen.findByText('No tags yet')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);

    await user.type(screen.getByLabelText('New tag'), 'anime');
    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(await screen.findByText('anime')).toBeInTheDocument();
    expect(api.callsTo('POST', 'tag')[0].body).toEqual({ label: 'anime' });

    await user.click(screen.getByRole('button', { name: 'Delete tag anime' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No tags yet')).toBeInTheDocument();
  });

  it('edits a tag in a modal', async () => {
    api = mockApi({
      'GET tag': () => [{ id: 4, label: 'kids' }],
      'PUT tag/:id': (req) => req.body,
    });
    const user = userEvent.setup();
    renderPage(<Tags />);
    await user.click(await screen.findByRole('button', { name: 'Edit tag kids' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Label');
    await user.clear(input);
    await user.type(input, 'family');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'tag/4')).toHaveLength(1));
    expect(api.callsTo('PUT', 'tag/4')[0].body).toEqual({ id: 4, label: 'family' });
  });
});

describe('Profiles', () => {
  const schema = (): QualityProfile => ({ id: 0, name: '', upgradeAllowed: false, cutoff: 0, items: profileItems(false) });

  it('lists profiles with the cutoff highlighted and has no axe violations', async () => {
    api = mockApi({ 'GET qualityprofile': () => [hdProfile()], 'GET qualityprofile/schema': schema });
    const { container } = renderPage(<Profiles />);
    expect(await screen.findByRole('heading', { level: 2, name: 'HD' })).toBeInTheDocument();
    expect(screen.getByText('(cutoff)').parentElement).toHaveTextContent('WEBDL-1080p');
    expect((await axe(container)).violations).toEqual([]);
  });

  it('moves the cutoff when its quality is disallowed, reorders, and saves the expected body', async () => {
    api = mockApi({
      'GET qualityprofile': () => [hdProfile()],
      'GET qualityprofile/schema': schema,
      'PUT qualityprofile/:id': (req) => req.body,
    });
    const user = userEvent.setup();
    renderPage(<Profiles />);
    await user.click(await screen.findByRole('button', { name: 'Edit HD' }));
    const dialog = screen.getByRole('dialog');
    expect((await axe(dialog)).violations).toEqual([]);

    const cutoff = within(dialog).getByLabelText('Upgrade until');
    expect(cutoff).toHaveValue(String(WEB1080.id));

    await user.click(within(dialog).getByLabelText('WEBDL-1080p'));
    expect(cutoff).toHaveValue(String(WEB720.id));
    expect(within(cutoff).queryByRole('option', { name: 'WEBDL-1080p' })).not.toBeInTheDocument();

    // Highest first: WEBDL-1080p, WEBDL-720p, SDTV. Move SDTV above WEBDL-720p.
    await user.click(within(dialog).getByRole('button', { name: 'Move SDTV up' }));
    const order = within(dialog).getAllByRole('checkbox').map((c) => c.id);
    expect(order).toEqual(['quality-allowed-3', 'quality-allowed-1', 'quality-allowed-5']);

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'qualityprofile/1')).toHaveLength(1));
    expect(api.callsTo('PUT', 'qualityprofile/1')[0].body).toEqual({
      id: 1,
      name: 'HD',
      upgradeAllowed: true,
      cutoff: WEB720.id,
      items: [
        { quality: WEB720, allowed: true },
        { quality: SDTV, allowed: true },
        { quality: WEB1080, allowed: false },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('validates the name and allowed qualities on the client', async () => {
    api = mockApi({ 'GET qualityprofile': () => [], 'GET qualityprofile/schema': schema });
    const user = userEvent.setup();
    renderPage(<Profiles />);
    const add = await screen.findByRole('button', { name: 'Add profile' });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('At least one quality must be allowed')).toBeInTheDocument();
    expect(api.callsTo('POST', 'qualityprofile')).toHaveLength(0);
  });

  it('shows the server error when deleting the last profile', async () => {
    api = mockApi({
      'GET qualityprofile': () => [hdProfile()],
      'GET qualityprofile/schema': schema,
      'DELETE qualityprofile/:id': () => validation400('id', 'Cannot delete the last quality profile'),
    });
    const user = userEvent.setup();
    renderPage(<Profiles />);
    await user.click(await screen.findByRole('button', { name: 'Delete HD' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Cannot delete the last quality profile')).toBeInTheDocument();
  });
});

describe('Quality', () => {
  const defs = (): QualityDefinition[] => [
    { id: 1, quality: SDTV, title: 'SDTV', weight: 1, minSize: 1, preferredSize: 20, maxSize: 100 },
    { id: 2, quality: WEB1080, title: 'WEBDL-1080p', weight: 2, minSize: 2, preferredSize: null, maxSize: null },
  ];

  it('disables Save for an invalid range and sends the bulk update otherwise', async () => {
    api = mockApi({
      'GET qualitydefinition': defs,
      'PUT qualitydefinition/update': (req) => req.body,
    });
    const user = userEvent.setup();
    const { container } = renderPage(<Quality />);
    const min = await screen.findByLabelText('Min size for SDTV');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect((await axe(container)).violations).toEqual([]);

    await user.clear(min);
    await user.type(min, '500');
    expect(screen.getByText('Min size cannot be greater than max size')).toBeInTheDocument();
    expect(min).toBeInvalid();
    expect(save).toBeDisabled();

    await user.clear(min);
    await user.type(min, '5');
    const max = screen.getByLabelText('Max size for WEBDL-1080p');
    await user.type(max, '300');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.callsTo('PUT', 'qualitydefinition/update')).toHaveLength(1));
    const body = api.callsTo('PUT', 'qualitydefinition/update')[0].body as QualityDefinition[];
    expect(body.map((d) => [d.id, d.minSize, d.preferredSize, d.maxSize])).toEqual([
      [1, 5, 20, 100],
      [2, 2, null, 300],
    ]);
  });
});

describe('General', () => {
  const host = (): HostConfig => ({
    id: 1,
    bindAddress: '*',
    port: 8989,
    urlBase: '',
    instanceName: 'Sonarr',
    apiKey: 'abc123',
    logLevel: 'info',
    launchBrowser: false,
  });

  it('shows the API key and regenerates it through the reset endpoint', async () => {
    api = mockApi({
      'GET config/host': host,
      'POST config/host/apikey/reset': () => ({ ...host(), apiKey: 'newkey' }),
    });
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    const { container } = renderPage(<General />);
    const key = await screen.findByLabelText('API key');
    expect(key).toHaveValue('abc123');
    expect(key).toHaveAttribute('readonly');
    expect((await axe(container)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Regenerate API key' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(api.callsTo('POST', 'config/host/apikey/reset')).toHaveLength(1));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('enables Save only when dirty and sends the changed fields', async () => {
    let current = host();
    api = mockApi({
      'GET config/host': () => current,
      'PUT config/host': (req) => (current = { ...current, ...(req.body as object) }),
    });
    const user = userEvent.setup();
    renderPage(<General />);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const name = screen.getByLabelText(/Instance name/);
    await user.clear(name);
    await user.type(name, 'Home');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.callsTo('PUT', 'config/host')).toHaveLength(1));
    expect(api.callsTo('PUT', 'config/host')[0].body).toMatchObject({ instanceName: 'Home', port: 8989 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });
});

describe('UI settings', () => {
  const ui = (): UiConfig => ({
    id: 1,
    firstDayOfWeek: 0,
    calendarWeekColumnHeader: 'ddd M/D',
    shortDateFormat: 'MMM D YYYY',
    longDateFormat: 'dddd, MMMM D YYYY',
    timeFormat: 'h(:mm)a',
    showRelativeDates: true,
    theme: 'dark',
    enableColorImpairedMode: false,
  });

  it('applies the theme immediately and saves the config', async () => {
    api = mockApi({ 'GET config/ui': ui, 'PUT config/ui': (req) => req.body });
    const user = userEvent.setup();
    const { container } = renderPage(<UiSettings />);
    const theme = await screen.findByLabelText('Theme');
    expect((await axe(container)).violations).toEqual([]);
    await user.selectOptions(theme, 'light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getByRole('switch', { name: 'Color-impaired mode' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'config/ui')).toHaveLength(1));
    expect(api.callsTo('PUT', 'config/ui')[0].body).toMatchObject({ theme: 'light', enableColorImpairedMode: true });
  });
});
