import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { NotificationResource } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, validation400, type MockApi, type MockRoutes } from '../../test/server';
import { Connect } from './Connect';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <main>
            <Connect />
          </main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const template = (implementation: NotificationResource['implementation'], settings: Record<string, unknown> = {}): NotificationResource => ({
  id: 0,
  name: '',
  implementation,
  onGrab: false,
  onDownload: false,
  onUpgrade: false,
  onRename: false,
  onSeriesAdd: false,
  onSeriesDelete: false,
  onEpisodeFileDelete: false,
  onEpisodeFileDeleteForUpgrade: false,
  onHealthIssue: false,
  onHealthRestored: false,
  includeHealthWarnings: false,
  tags: [],
  settings,
});

const schemaList = () => [template('Webhook', { method: 'POST' }), template('Discord'), template('Email', { port: 587, useEncryption: 'preferred' })];

let api: MockApi;
const setup = (list: NotificationResource[], extra: MockRoutes = {}) => {
  api = mockApi({
    'GET notification': () => list,
    'GET notification/schema': () => schemaList(),
    'GET tag': () => [],
    ...extra,
  });
};
afterEach(() => api?.restore());

const stored = (): NotificationResource => ({
  ...template('Discord', { webHookUrl: '********', username: 'Sonarr', avatar: '' }),
  id: 5,
  name: 'My Discord',
  onGrab: true,
  onHealthIssue: true,
});

describe('Connect', () => {
  it('lists notifications with trigger chips', async () => {
    setup([stored()]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Edit My Discord' })).toBeInTheDocument();
    expect(screen.getByText('On Grab')).toBeInTheDocument();
    expect(screen.getByText('On Health Issue')).toBeInTheDocument();
    expect(screen.queryByText('On Rename')).not.toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    setup([]);
    renderPage();
    expect(await screen.findByText('No connections')).toBeInTheDocument();
  });

  it('adds a webhook with triggers', async () => {
    const user = userEvent.setup();
    setup([], { 'POST notification': () => ({ ...template('Webhook'), id: 1 }) });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Connection', hidden: false }));
    await user.click(await screen.findByRole('button', { name: /Webhook/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Hook');
    await user.type(within(dialog).getByLabelText(/^URL/), 'https://example.com/hook');
    await user.click(within(dialog).getByRole('switch', { name: 'On Grab' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('POST', 'notification')).toHaveLength(1));
    const body = api.callsTo('POST', 'notification')[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Hook',
      implementation: 'Webhook',
      onGrab: true,
      onRename: false,
      settings: { url: 'https://example.com/hook', method: 'POST' },
    });
  });

  it('validates email addresses and shows server errors inline', async () => {
    const user = userEvent.setup();
    setup([], { 'POST notification': () => validation400('server', 'Unable to resolve host') });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Connection' }));
    await user.click(await screen.findByRole('button', { name: /Email/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Mail');
    await user.type(within(dialog).getByLabelText(/^Server/), 'smtp.example.com');
    await user.type(within(dialog).getByLabelText(/^From Address/), 'sonarr@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('At least one recipient is required')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^To/), 'bad');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/valid email address/)).toBeInTheDocument();
    expect(api.callsTo('POST', 'notification')).toHaveLength(0);
    await user.clear(within(dialog).getByLabelText(/^To/));
    await user.type(within(dialog).getByLabelText(/^To/), 'a@example.com, b@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Unable to resolve host')).toBeInTheDocument();
    expect((api.callsTo('POST', 'notification')[0].body as { settings: { to: string[] } }).settings.to).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('toasts the server message when a test fails', async () => {
    const user = userEvent.setup();
    setup([stored()], { 'POST notification/test': () => validation400('webHookUrl', 'Discord rejected the webhook') });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit My Discord' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Test failed: Discord rejected the webhook')).toBeInTheDocument();
  });

  it('keeps masked secrets when editing', async () => {
    const user = userEvent.setup();
    setup([stored()], { 'PUT notification/:id': () => stored() });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit My Discord' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^Webhook URL/)).toHaveValue('********');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'notification/5')).toHaveLength(1));
    expect(api.callsTo('PUT', 'notification/5')[0].body).toMatchObject({ id: 5, settings: { webHookUrl: '********' } });
  });

  it('saves a webhook whose stored URL is masked', async () => {
    const user = userEvent.setup();
    const hook = { ...template('Webhook', { url: '********', method: 'POST' }), id: 6, name: 'My Hook' };
    setup([hook], { 'PUT notification/:id': () => hook });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit My Hook' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^URL/)).toHaveValue('********');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT', 'notification/6')).toHaveLength(1));
    expect(api.callsTo('PUT', 'notification/6')[0].body).toMatchObject({ id: 6, settings: { url: '********' } });
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    setup([stored()], { 'DELETE notification/:id': () => ({}) });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit My Discord' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(api.callsTo('DELETE', 'notification/5')).toHaveLength(0);
    const confirm = await screen.findByRole('dialog', { name: 'Delete connection' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE', 'notification/5')).toHaveLength(1));
  });

  it('has no axe violations on the page and the modal', async () => {
    const user = userEvent.setup();
    setup([stored()]);
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'Edit My Discord' });
    expect((await axe(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Edit My Discord' }));
    const dialog = await screen.findByRole('dialog');
    expect((await axe(dialog)).violations).toEqual([]);
  });
});
