import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { resetInitializeCache } from '../lib/api';
import { Login } from './Login';
import { Setup } from './Setup';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const init = { apiKey: '', urlBase: '', instanceName: 'Sonarr', version: '1.0.0', authMethod: 'forms', setupRequired: false, authenticated: false };

/** Serves initialize.json and hands every other request to `handler`. */
function stubFetch(handler: (url: string, req?: RequestInit) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, req?: RequestInit) => {
    const url = String(input);
    if (url === '/initialize.json') return json(init);
    return handler(url, req);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderAt(element: React.ReactElement, path: string) {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '/', element: <h1>Home</h1> },
      { path: '/login', element: <h1>Login page</h1> },
    ],
    { initialEntries: [path] },
  );
  const utils = render(<RouterProvider router={router} />);
  return { router, ...utils };
}

beforeEach(() => resetInitializeCache());
afterEach(() => {
  vi.unstubAllGlobals();
  resetInitializeCache();
});

describe('Login page', () => {
  it('has labelled fields and no axe violations', async () => {
    stubFetch(() => json({}));
    const { container } = renderAt(<Login />, '/signin');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to Sonarr' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'password');
    expect(screen.getByRole('switch', { name: 'Remember me' })).toHaveAttribute('aria-checked', 'false');
    expect((await axe(container)).violations).toEqual([]);
  });

  it('shows an error alert on 401 and clears the password', async () => {
    const fetchMock = stubFetch(() => json({ message: 'Invalid username or password' }, 401));
    const user = userEvent.setup();
    const { container } = renderAt(<Login />, '/signin');
    await user.type(screen.getByLabelText(/Username/), 'admin');
    await user.type(screen.getByLabelText(/Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.');
    expect(screen.getByLabelText(/Password/)).toHaveValue('');
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u) === '/login')!;
    expect(JSON.parse(String(loginCall[1]!.body))).toEqual({ username: 'admin', password: 'wrong', rememberMe: false });
    expect((await axe(container)).violations).toEqual([]);
  });

  it('submits with remember me and navigates home on success', async () => {
    const fetchMock = stubFetch(() => json({ authenticated: true }));
    const user = userEvent.setup();
    renderAt(<Login />, '/signin');
    await user.type(screen.getByLabelText(/Username/), 'admin');
    await user.type(screen.getByLabelText(/Password/), 'secret1');
    await user.click(screen.getByRole('switch', { name: 'Remember me' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u) === '/login')!;
    expect(JSON.parse(String(loginCall[1]!.body))).toEqual({ username: 'admin', password: 'secret1', rememberMe: true });
  });

  it('explains the rate limit on 429', async () => {
    stubFetch(() => json({ message: 'Too many' }, 429));
    const user = userEvent.setup();
    renderAt(<Login />, '/signin');
    await user.type(screen.getByLabelText(/Username/), 'admin');
    await user.type(screen.getByLabelText(/Password/), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many failed attempts/);
  });
});

describe('Setup page', () => {
  it('has no axe violations, validates, and creates the account', async () => {
    const fetchMock = stubFetch(() => json({ authenticated: true }));
    const user = userEvent.setup();
    const { container } = renderAt(<Setup />, '/setup');
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Sonarr' })).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Use at least 6 characters')).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/initialize/setup')).toBe(false);

    await user.type(screen.getByLabelText(/^Username/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'secret1');
    await user.type(screen.getByLabelText(/^Confirm password/), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument());
    const call = fetchMock.mock.calls.find(([u]) => String(u) === '/initialize/setup')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ username: 'admin', password: 'secret1' });
  });

  it('goes to the login page when setup was already completed', async () => {
    stubFetch(() => json({ message: 'Setup has already been completed' }, 409));
    const user = userEvent.setup();
    renderAt(<Setup />, '/setup');
    await user.type(screen.getByLabelText(/^Username/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'secret1');
    await user.type(screen.getByLabelText(/^Confirm password/), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument();
  });
});
