import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type {
  BackupResource,
  Command,
  DiskSpaceResource,
  HealthResource,
  LogEntry,
  LogFileResource,
  Paged,
  ScheduledTaskResource,
  SystemStatus,
} from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { Sidebar } from '../../components/layout/Sidebar';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { Backup } from './Backup';
import { Events } from './Events';
import { LogFiles } from './LogFiles';
import { Status } from './Status';
import { Tasks } from './Tasks';
import { Updates } from './Updates';
import { formatInterval, formatSpan, humanizeName, systemEnv } from './hooks';

let queryClient: QueryClient;
let mock: MockApi | undefined;

function renderPage(page: React.ReactNode) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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

const setup = (routes: MockRoutes) => {
  mock = mockApi(routes);
  return mock;
};

afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const status: SystemStatus = {
  appName: 'Sonarr',
  instanceName: 'Sonarr',
  version: '4.0.0-test',
  buildTime: '2026-01-01T00:00:00Z',
  isDebug: false,
  isProduction: true,
  startupPath: '/opt/sonarr',
  appData: '/var/lib/sonarr',
  osName: 'linux',
  runtimeVersion: '22.1.0',
  databaseType: 'sqlite',
  databaseVersion: '3.45.0',
  authentication: 'forms',
  urlBase: '',
  startTime: new Date(Date.now() - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000)).toISOString(),
};

const GB = 1024 ** 3;
const disks: DiskSpaceResource[] = [
  { path: '/tv', label: 'TV', freeSpace: 25 * GB, totalSpace: 100 * GB },
  { path: '/data', label: '/data', freeSpace: 5 * GB, totalSpace: 100 * GB },
];

const health: HealthResource[] = [
  { source: 'IndexerRssCheck', type: 'warning', message: 'No indexers available with RSS sync enabled' },
  { source: 'DownloadClientCheck', type: 'error', message: 'No download client is available', wikiUrl: 'https://wiki.example/dc' },
];

const statusRoutes = (h: HealthResource[] = health): MockRoutes => ({
  'GET system/status': () => status,
  'GET health': () => h,
  'GET diskspace': () => disks,
});

describe('Status page', () => {
  it('shows health items, disk space and about fields', async () => {
    setup(statusRoutes());
    const { container } = renderPage(<Status />);
    expect(screen.getByRole('heading', { level: 1, name: 'System' })).toBeInTheDocument();

    expect(await screen.findByText('No indexers available with RSS sync enabled')).toBeInTheDocument();
    expect(screen.getByText('No download client is available')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();

    const tv = await screen.findByRole('progressbar', { name: 'Disk space used on TV (/tv)' });
    expect(tv).toHaveAttribute('aria-valuenow', '75');
    expect(tv).toHaveAttribute('aria-valuemin', '0');
    expect(tv).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('75% used')).toBeInTheDocument();
    const data = screen.getByRole('progressbar', { name: 'Disk space used on /data' });
    expect(data).toHaveAttribute('aria-valuenow', '95');
    expect(screen.getByText('Low disk space')).toBeInTheDocument();

    expect(await screen.findByText('4.0.0-test')).toBeInTheDocument();
    expect(screen.getByText('Node 22.1.0')).toBeInTheDocument();
    expect(screen.getByText('SQLite 3.45.0')).toBeInTheDocument();
    expect(screen.getByText('/var/lib/sonarr')).toBeInTheDocument();
    expect(screen.getByText('/opt/sonarr')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('2d 3h 4m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sonarr wiki/ })).toHaveAttribute('href', 'https://wiki.servarr.com/sonarr');

    expect((await axe(container)).violations).toEqual([]);
  });

  it('shows the empty health state', async () => {
    setup(statusRoutes([{ source: 'x', type: 'ok', message: 'fine' }]));
    renderPage(<Status />);
    expect(await screen.findByText('No issues with your configuration')).toBeInTheDocument();
  });

  it('shows an error with Retry when health fails', async () => {
    let fail = true;
    setup({ ...statusRoutes(), 'GET health': () => (fail ? { status: 500, body: { message: 'boom' } } : []) });
    const user = userEvent.setup();
    renderPage(<Status />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load health: boom');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No issues with your configuration')).toBeInTheDocument();
  });
});

describe('Updates page', () => {
  it('explains how to update', async () => {
    setup({ 'GET system/status': () => status });
    const { container } = renderPage(<Updates />);
    expect(screen.getByText('In-app updates are not supported in this build.')).toBeInTheDocument();
    expect(screen.getByText('git pull')).toBeInTheDocument();
    expect(screen.getByText('npm ci')).toBeInTheDocument();
    expect(screen.getByText('npm run build')).toBeInTheDocument();
    expect(await screen.findByText('4.0.0-test')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Sidebar health badge', () => {
  const renderSidebar = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/system/status']}>
          <Sidebar collapsed={false} onToggleCollapsed={() => {}} mobileOpen={false} onCloseMobile={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('shows the count of warnings and errors', async () => {
    setup({ 'GET health': () => [...health, { source: 'n', type: 'notice', message: 'just a notice' }] });
    renderSidebar();
    expect(await screen.findByText('2 health issues')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /System\s*2 health issues/ })).toBeInTheDocument();
  });

  it('shows nothing without issues or when health fails', async () => {
    setup({ 'GET health': () => ({ status: 500, body: { message: 'down' } }) });
    renderSidebar();
    await waitFor(() => expect(mock!.callsTo('GET', 'health')).toHaveLength(1));
    expect(screen.queryByTestId('health-badge')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'System' })).toBeInTheDocument();
  });
});

describe('Tasks page', () => {
  const tasks: ScheduledTaskResource[] = [
    {
      name: 'RssSync',
      commandName: 'RssSync',
      interval: 15,
      lastExecution: new Date(Date.now() - 5 * 60_000).toISOString(),
      lastStartTime: new Date(Date.now() - 5 * 60_000 - 3000).toISOString(),
      nextExecution: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    { name: 'Housekeeping', commandName: 'Housekeeping', interval: 1440, nextExecution: new Date(Date.now() + 3_600_000).toISOString() },
  ];
  const cmd = (overrides: Partial<Command>): Command => ({
    id: 1,
    name: 'RssSync',
    body: {},
    status: 'queued',
    priority: 'normal',
    trigger: 'manual',
    message: null,
    queued: new Date().toISOString(),
    started: null,
    ended: null,
    duration: null,
    ...overrides,
  });

  it('runs a task, disables it while started and announces completion', async () => {
    let commands: Command[] = [
      cmd({ id: 9, name: 'Housekeeping', status: 'completed', trigger: 'scheduled', message: 'Completed', ended: new Date().toISOString() }),
      cmd({ id: 8, name: 'RefreshSeries', status: 'completed', queued: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
    ];
    setup({
      'GET system/task': () => tasks,
      'GET command': () => commands,
      'POST command': (req) => {
        const c = cmd({ id: 10, name: (req.body as { name: string }).name, status: 'started', started: new Date().toISOString() });
        commands = [c, ...commands];
        return { status: 201, body: c };
      },
    });
    const user = userEvent.setup();
    const { container } = renderPage(<Tasks />);

    const run = await screen.findByRole('button', { name: 'Run RSS Sync now' });
    expect(screen.getByText('15 minutes')).toBeInTheDocument();
    expect(screen.getByText('1 day')).toBeInTheDocument();
    // Queue shows only the last 24 hours.
    // Once in Scheduled and once in Queue.
    await waitFor(() => expect(screen.getAllByRole('cell', { name: 'Housekeeping' })).toHaveLength(2));
    expect(screen.queryByText('Refresh Series')).not.toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);

    await user.click(run);
    await waitFor(() => expect(mock!.callsTo('POST', 'command')).toHaveLength(1));
    expect(mock!.callsTo('POST', 'command')[0].body).toEqual({ name: 'RssSync' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run RSS Sync now' })).toBeDisabled());
    expect(screen.getByText('Started', { selector: '[data-status="running"]' })).toBeInTheDocument();
    expect(screen.getByTestId('task-announcer')).toHaveTextContent('');

    commands = commands.map((c) => (c.id === 10 ? { ...c, status: 'completed', ended: new Date().toISOString() } : c));
    await act(() => queryClient.invalidateQueries({ queryKey: ['command'] }));
    await waitFor(() => expect(screen.getByTestId('task-announcer')).toHaveTextContent('Task RSS Sync completed'));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Run RSS Sync now' })).toBeEnabled();
  });

  it('announces failures', async () => {
    let commands: Command[] = [cmd({ id: 3, status: 'started', started: new Date().toISOString() })];
    setup({ 'GET system/task': () => tasks, 'GET command': () => commands });
    renderPage(<Tasks />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run RSS Sync now' })).toBeDisabled());
    commands = [{ ...commands[0], status: 'failed', message: 'Indexer down', ended: new Date().toISOString() }];
    await act(() => queryClient.invalidateQueries({ queryKey: ['command'] }));
    await waitFor(() => expect(screen.getByTestId('task-announcer')).toHaveTextContent('Task RSS Sync failed'));
  });
});

describe('Backup page', () => {
  const backups: BackupResource[] = [
    { id: 1, name: 'sonarr_backup_v4_2026.10.01_10.00.00.zip', path: 'manual/sonarr_backup_v4_2026.10.01_10.00.00.zip', type: 'manual', size: 2 * 1024 * 1024, time: new Date(Date.now() - 86_400_000).toISOString() },
    { id: 2, name: 'sonarr_backup_v4_2026.09.24_02.00.00.zip', path: 'scheduled/sonarr_backup_v4_2026.09.24_02.00.00.zip', type: 'scheduled', size: 1024 * 1024, time: new Date(Date.now() - 8 * 86_400_000).toISOString() },
  ];

  const backupRoutes = (list: BackupResource[] = backups): MockRoutes => ({
    'GET system/backup': () => list,
    'POST system/backup': () => ({ status: 201, body: backups[0] }),
    'DELETE system/backup/:name': () => ({}),
    'POST system/backup/restore/:name': () => ({ restartRequired: true }),
    'POST system/backup/restore/upload': () => ({ restartRequired: true }),
    'POST system/restart': () => ({ message: 'Restarting' }),
    'GET system/backup/:name/download': () => 'zipdata',
  });

  it('shows the empty state', async () => {
    setup(backupRoutes([]));
    const { container } = renderPage(<Backup />);
    expect(await screen.findByText('No backups yet')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('creates a backup and deletes one after confirming', async () => {
    setup(backupRoutes());
    const user = userEvent.setup();
    const { container } = renderPage(<Backup />);
    expect(await screen.findByText(backups[0].name)).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Backup now' }));
    await waitFor(() => expect(mock!.callsTo('POST', 'system/backup')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: `Delete ${backups[1].name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete backup' });
    expect(mock!.callsTo('DELETE', 'system/backup/:name')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mock!.callsTo('DELETE', 'system/backup/:name')).toHaveLength(1));
    expect(mock!.callsTo('DELETE', 'system/backup/:name')[0].params.name).toBe(backups[1].name);
  });

  it('downloads a backup with the API key', async () => {
    const m = setup(backupRoutes());
    const createObjectURL = vi.fn(() => 'blob:backup');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    renderPage(<Backup />);
    await user.click(await screen.findByRole('button', { name: `Download ${backups[0].name}` }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(m.callsTo('GET', 'system/backup/:name/download')[0].params.name).toBe(backups[0].name);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/download'))!;
    expect((call[1] as RequestInit).headers).toMatchObject({ 'X-Api-Key': 'test-key' });
    click.mockRestore();
  });

  it('restores after confirming, then restarts and polls /ping until the server is back', async () => {
    const m = setup(backupRoutes());
    // /ping lives outside /api/v3: answer it here (down twice, then up).
    const apiFetch = globalThis.fetch;
    let pings = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/ping')) {
        pings += 1;
        if (pings <= 2) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ status: 'OK' }), { status: 200 });
      }
      return apiFetch(input, init);
    });
    const reload = vi.fn();
    const saved = { ...systemEnv };
    Object.assign(systemEnv, { pingIntervalMs: 10, reload });
    try {
      const user = userEvent.setup();
      const { container } = renderPage(<Backup />);
      await user.click(await screen.findByRole('button', { name: `Restore ${backups[0].name}` }));
      const dialog = await screen.findByRole('dialog', { name: 'Restore backup' });
      expect(dialog).toHaveTextContent('current database will be replaced');
      expect(dialog).toHaveTextContent('restart is required');
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
      await waitFor(() => expect(m.callsTo('POST', 'system/backup/restore/:name')).toHaveLength(1));
      expect(m.callsTo('POST', 'system/backup/restore/:name')[0].params.name).toBe(backups[0].name);

      expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect((await axe(container)).violations).toEqual([]);

      await user.click(screen.getByRole('button', { name: 'Restart' }));
      const confirm = await screen.findByRole('dialog', { name: 'Restart Sonarr' });
      await user.click(within(confirm).getByRole('button', { name: 'Restart' }));
      await waitFor(() => expect(m.callsTo('POST', 'system/restart')).toHaveLength(1));
      expect(await screen.findByText(/Restarting\.\.\. the page reloads/)).toBeInTheDocument();
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(pings).toBe(3);
    } finally {
      Object.assign(systemEnv, saved);
    }
  });

  it('uploads a backup file to restore after confirming', async () => {
    const m = setup(backupRoutes());
    const user = userEvent.setup();
    renderPage(<Backup />);
    await screen.findByText(backups[0].name);
    const file = new File(['PK'], 'my-backup.zip', { type: 'application/zip' });
    await user.upload(screen.getByTestId('restore-file'), file);
    const dialog = await screen.findByRole('dialog', { name: 'Restore backup' });
    expect(dialog).toHaveTextContent('my-backup.zip');
    expect(m.callsTo('POST', 'system/backup/restore/upload')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(m.callsTo('POST', 'system/backup/restore/upload')).toHaveLength(1));
    expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
  });
});

describe('Events page', () => {
  const entry = (id: number, overrides: Partial<LogEntry> = {}): LogEntry => ({
    id,
    time: new Date(Date.now() - id * 60_000).toISOString(),
    level: 'info',
    logger: 'RssSync',
    message: `Message ${id}`,
    ...overrides,
  });

  it('pages, filters by level and expands exceptions', async () => {
    const m = setup({
      'GET log': (req): Paged<LogEntry> => {
        const page = Number(req.query.get('page'));
        const records =
          req.query.get('level') === 'error'
            ? [entry(1, { level: 'error', message: 'Import failed', exception: 'Error: boom\n    at x.ts:1' })]
            : Array.from({ length: 50 }, (_, i) => entry((page - 1) * 50 + i + 1));
        return { page, pageSize: 50, sortKey: 'time', sortDirection: 'descending', totalRecords: req.query.get('level') ? 1 : 120, records };
      },
    });
    const user = userEvent.setup();
    const { container } = renderPage(<Events />);
    expect(await screen.findByText('Message 1')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(m.callsTo('GET', 'log')[0].query.get('pageSize')).toBe('50');
    expect(m.callsTo('GET', 'log')[0].query.get('level')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect((await axe(container)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Message 51')).toBeInTheDocument();
    expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
    expect(m.calls.at(-1)!.query.get('page')).toBe('2');

    await user.selectOptions(screen.getByLabelText('Level'), 'error');
    expect(await screen.findByText('Import failed')).toBeInTheDocument();
    const last = m.callsTo('GET', 'log').at(-1)!;
    expect(last.query.get('level')).toBe('error');
    expect(last.query.get('page')).toBe('1');

    const toggle = screen.getByRole('button', { name: 'Show exception' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Exception')).toHaveTextContent('Error: boom');
    expect((await axe(container)).violations).toEqual([]);

    const before = m.callsTo('GET', 'log').length;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(m.callsTo('GET', 'log').length).toBe(before + 1));
  });
});

describe('Log Files page', () => {
  const files: LogFileResource[] = [
    { filename: 'sonarr.txt', lastWriteTime: new Date().toISOString(), size: 2048 },
    { filename: 'sonarr.0.txt', lastWriteTime: new Date(Date.now() - 86_400_000).toISOString(), size: 1024 * 1024 },
  ];

  it('lists files, shows the log folder and downloads the listed name', async () => {
    const m = setup({
      'GET log/file': () => files,
      'GET system/status': () => status,
      'GET log/file/:filename': () => 'log text',
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:log'), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    const { container } = renderPage(<LogFiles />);
    expect(await screen.findByText('sonarr.0.txt')).toBeInTheDocument();
    expect(await screen.findByText('/var/lib/sonarr/logs')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Download sonarr.0.txt' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(m.callsTo('GET', 'log/file/:filename')[0].params.filename).toBe('sonarr.0.txt');
    click.mockRestore();
  });

  it('shows the empty state', async () => {
    setup({ 'GET log/file': () => [], 'GET system/status': () => status });
    renderPage(<LogFiles />);
    expect(await screen.findByText('No log files')).toBeInTheDocument();
  });
});

describe('formatting helpers', () => {
  it('humanizes names, intervals and spans', () => {
    expect(humanizeName('RefreshMonitoredDownloads')).toBe('Refresh Monitored Downloads');
    expect(humanizeName('RssSync')).toBe('RSS Sync');
    expect(formatInterval(15)).toBe('15 minutes');
    expect(formatInterval(720)).toBe('12 hours');
    expect(formatInterval(10080)).toBe('7 days');
    expect(formatSpan(45_000)).toBe('45s');
    expect(formatSpan(86_400_000)).toBe('1d 0h 0m');
  });
});
