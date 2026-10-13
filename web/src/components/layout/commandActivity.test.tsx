import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { Command } from '@sonarr/shared';
import { ToastProvider } from '../ui';
import { mockApi, type MockApi } from '../../test/server';
import { queryKeys } from '../../lib/api';
import { CommandActivity } from './CommandActivity';

const cmd = (over: Partial<Command>): Command => ({
  id: 1,
  name: 'RefreshSeries',
  body: {},
  status: 'started',
  priority: 'normal',
  trigger: 'manual',
  message: null,
  queued: '2026-01-01T00:00:00Z',
  started: '2026-01-01T00:00:01Z',
  ended: null,
  duration: null,
  ...over,
});

let list: Command[] = [];
let api: MockApi;
afterEach(() => api?.restore());

function setup(initial: Command[]) {
  list = initial;
  api = mockApi({ 'GET command': () => list });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <header>
          <CommandActivity />
        </header>
      </ToastProvider>
    </QueryClientProvider>,
  );
  const refetch = async (next: Command[]) => {
    list = next;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.commands });
    });
  };
  return { ...utils, refetch };
}

describe('CommandActivity', () => {
  it('shows a count while commands are running and lists them in a popover', async () => {
    const user = userEvent.setup();
    setup([cmd({}), cmd({ id: 2, name: 'RssSync', status: 'queued', started: null }), cmd({ id: 3, name: 'Backup', status: 'completed', ended: '2026-01-01T00:01:00Z' })]);
    const button = await screen.findByRole('button', { name: '2 running commands' });
    await user.click(button);
    expect(screen.getByText('Refresh Series')).toBeInTheDocument();
    expect(screen.getByText('Rss Sync')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('hides the button when idle but keeps the live region', async () => {
    setup([cmd({ status: 'completed', ended: '2026-01-01T00:01:00Z' })]);
    await waitFor(() => expect(api.callsTo('GET', 'command')).toHaveLength(1));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-announcer')).toHaveAttribute('aria-live', 'polite');
  });

  it('announces a completion once', async () => {
    const { refetch } = setup([cmd({})]);
    await screen.findByRole('button', { name: '1 running command' });
    const done = cmd({ status: 'completed', ended: '2026-01-01T00:01:00Z' });
    await refetch([done]);
    await waitFor(() => expect(screen.getByTestId('command-announcer')).toHaveTextContent(/^Refresh Series completed$/));
    const announcer = screen.getByTestId('command-announcer');
    let mutations = 0;
    const observer = new MutationObserver(() => mutations++);
    observer.observe(announcer, { childList: true, characterData: true, subtree: true });
    await refetch([{ ...done }]);
    await new Promise((r) => setTimeout(r, 20));
    observer.disconnect();
    expect(mutations).toBe(0);
    expect(announcer).toHaveTextContent(/^Refresh Series completed$/);
  });

  it('toasts failures with the message', async () => {
    const { refetch } = setup([cmd({})]);
    await screen.findByRole('button', { name: '1 running command' });
    await refetch([cmd({ status: 'failed', message: 'disk full', ended: '2026-01-01T00:01:00Z' })]);
    await waitFor(() => expect(screen.getByTestId('command-announcer')).toHaveTextContent('Refresh Series failed: disk full'));
    expect(await screen.findAllByText('Refresh Series failed: disk full')).toHaveLength(2);
  });

  it('has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = setup([cmd({})]);
    await user.click(await screen.findByRole('button', { name: '1 running command' }));
    expect((await axe(container)).violations).toEqual([]);
  });
});
