import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { RenamePreview } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi, type MockRoutes } from '../../test/server';
import { RenamePreviewModal } from './RenamePreviewModal';

function renderModal(onClose = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <main>
            <RenamePreviewModal seriesId={1} seasonNumber={1} onClose={onClose} />
          </main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const change = (id: number, n: number): RenamePreview => ({
  seriesId: 1,
  seasonNumber: 1,
  episodeNumbers: [n],
  episodeFileId: id,
  existingPath: `Season 01/old.${n}.mkv`,
  newPath: `Season 01/Breaking Bad - S01E0${n}.mkv`,
});

let api: MockApi;
const routes = (overrides: MockRoutes = {}): MockRoutes => ({
  'GET rename': () => [change(501, 1), change(502, 2)],
  'GET config/naming': () => ({ standardEpisodeFormat: '{Series Title} - S{season:00}E{episode:00}' }),
  'POST command': (req) => ({ id: 1, ...(req.body as object) }),
  ...overrides,
});

afterEach(() => api?.restore());

describe('RenamePreviewModal', () => {
  it('lists each change and the naming format', async () => {
    api = mockApi(routes());
    renderModal();
    expect(await screen.findByText('Season 01/old.1.mkv')).toBeInTheDocument();
    expect(screen.getByText('Season 01/Breaking Bad - S01E02.mkv')).toBeInTheDocument();
    expect(await screen.findByText('{Series Title} - S{season:00}E{episode:00}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Media Management/ })).toHaveAttribute('href', '/settings/mediamanagement');
    expect(api.callsTo('GET', 'rename')[0].query.get('seriesId')).toBe('1');
    expect(api.callsTo('GET', 'rename')[0].query.get('seasonNumber')).toBe('1');
  });

  it('leaves unchecked files out of the RenameFiles command', async () => {
    api = mockApi(routes());
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal(onClose);
    await user.click(await screen.findByRole('checkbox', { name: 'Rename Season 01/old.1.mkv' }));
    await user.click(screen.getByRole('button', { name: 'Organize 1 file' }));
    await waitFor(() => expect(api.callsTo('POST', 'command')).toHaveLength(1));
    expect(api.callsTo('POST', 'command')[0].body).toEqual({ name: 'RenameFiles', seriesId: 1, files: [502] });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an empty state when everything is named correctly', async () => {
    api = mockApi(routes({ 'GET rename': () => [] }));
    renderModal();
    expect(await screen.findByText('All episodes are already named correctly')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Organize 0 files/ })).toBeDisabled();
  });

  it('has no axe violations', async () => {
    api = mockApi(routes());
    renderModal();
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('Season 01/old.1.mkv');
    expect((await axe(dialog)).violations).toEqual([]);
  });
});
