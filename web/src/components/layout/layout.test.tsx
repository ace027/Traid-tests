import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { routes } from '../../routes';
import { flattenNavigation, navigation } from './navigation';

function renderAt(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(<RouterProvider router={router} />);
  return { router, ...utils };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('navigation', () => {
  it('covers every Sonarr page path', () => {
    const paths = flattenNavigation().map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/', '/add/new', '/add/import', '/calendar', '/activity/queue', '/activity/history', '/activity/blocklist',
        '/wanted/missing', '/wanted/cutoffunmet', '/settings', '/settings/mediamanagement', '/settings/profiles',
        '/settings/quality', '/settings/indexers', '/settings/downloadclients', '/settings/importlists',
        '/settings/connect', '/settings/metadata', '/settings/tags', '/settings/general', '/settings/ui',
        '/system/status', '/system/tasks', '/system/backup', '/system/updates', '/system/events', '/system/logs/files',
      ]),
    );
  });

  it.each(flattenNavigation().map((e) => [e.path, e.label]))('routes %s to a page titled %s', (path, label) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  });
});

describe('AppLayout', () => {
  it('renders all top-level sections, a skip link and main landmark', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const section of navigation) {
      expect(within(nav).getByRole('link', { name: section.label })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('expands the active section and marks the current page', () => {
    renderAt('/settings/tags');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const sub = within(nav).getByRole('list', { name: 'Settings pages' });
    expect(within(sub).getByRole('link', { name: 'Tags' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('list', { name: 'System pages' })).not.toBeInTheDocument();
  });

  it('renders NotFound inside the layout for unknown routes', () => {
    renderAt('/does/not/exist');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('toggles the mobile drawer with aria-expanded and closes on Escape and navigation', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const hamburger = screen.getByRole('button', { name: 'Open navigation' });
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    expect(hamburger).toHaveAttribute('aria-controls', 'app-sidebar');

    await user.click(hamburger);
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('app-sidebar')).toHaveAttribute('data-mobile-open');

    await user.keyboard('{Escape}');
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    await user.click(hamburger);
    await user.click(screen.getByRole('link', { name: 'Calendar' }));
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
  });

  it('collapses the sidebar to icons, keeps accessible names and persists the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/calendar');
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.getElementById('app-sidebar')).toHaveAttribute('data-collapsed');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const link = within(nav).getByRole('link', { name: 'Calendar' });
    expect(link).toHaveAttribute('title', 'Calendar');
    expect(localStorage.getItem('sonarr.sidebarCollapsed')).toBe('true');
    unmount();

    renderAt('/');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the command palette with Ctrl+K and navigates with arrows and Enter', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/');
    await user.keyboard('{Control>}k{/Control}');
    const dialog = screen.getByRole('dialog', { name: 'Go to page' });
    const input = within(dialog).getByRole('combobox', { name: 'Search pages' });
    expect(input).toHaveFocus();

    await user.type(input, 'tags');
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/settings/tags');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tags' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    const input2 = screen.getByRole('combobox', { name: 'Search pages' });
    await user.type(input2, 'system');
    await user.keyboard('{ArrowDown}');
    expect(input2.getAttribute('aria-activedescendant')).toBe(
      within(screen.getByRole('listbox')).getAllByRole('option')[1].id,
    );
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/system/tasks');
  });

  it('switches theme and sets data-theme on <html>', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: /^Theme:/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('sonarr.theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Theme: Light' }));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('sonarr.theme')).toBe('dark');
  });

  it('shows the live connection status', () => {
    renderAt('/');
    expect(screen.getByTitle(/Live updates:/)).toHaveAttribute('data-status', 'disconnected');
  });

  it('has no axe violations (closed and with drawer and palette open)', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/settings/general');
    expect((await axe(container)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect((await axe(container)).violations).toEqual([]);
    await user.keyboard('{Escape}');

    await act(async () => {
      await user.keyboard('{Control>}k{/Control}');
    });
    expect((await axe(document.body)).violations).toEqual([]);
  });
});
