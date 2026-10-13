import { useContext, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AuthGate } from './components/layout/AuthGate';
import { navigation } from './components/layout/navigation';
import { Placeholder } from './pages/Placeholder';
import { NotFound } from './pages/NotFound';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { SettingsIndex } from './pages/settings/SettingsIndex';
import { MediaManagement } from './pages/settings/MediaManagement';
import { Profiles } from './pages/settings/Profiles';
import { Quality } from './pages/settings/Quality';
import { Tags } from './pages/settings/Tags';
import { General } from './pages/settings/General';
import { UiSettings } from './pages/settings/UiSettings';

/**
 * Settings pages fetch with TanStack Query. App provides the shared client; this
 * only supplies a private one when the routes are rendered without it (tests, embeds).
 */
function EnsureQueryClient({ children }: { children: ReactNode }) {
  const existing = useContext(QueryClientContext);
  const [fallback] = useState(() => (existing ? null : new QueryClient()));
  return fallback ? <QueryClientProvider client={fallback}>{children}</QueryClientProvider> : <>{children}</>;
}

const withQuery = (page: ReactNode) => <EnsureQueryClient>{page}</EnsureQueryClient>;

const placeholder = (title: string) => <Placeholder title={title} />;

/**
 * Children of /settings. Indexers, download clients, import lists, connect and metadata stay placeholders;
 * paths are relative to /settings ('index' is the overview).
 */
export const settingsRoutes: RouteObject[] = [
  { index: true, element: <SettingsIndex /> },
  { path: 'mediamanagement', element: withQuery(<MediaManagement />) },
  { path: 'profiles', element: withQuery(<Profiles />) },
  { path: 'quality', element: withQuery(<Quality />) },
  { path: 'indexers', element: placeholder('Indexers') },
  { path: 'downloadclients', element: placeholder('Download Clients') },
  { path: 'importlists', element: placeholder('Import Lists') },
  { path: 'connect', element: placeholder('Connect') },
  { path: 'metadata', element: placeholder('Metadata') },
  { path: 'tags', element: withQuery(<Tags />) },
  { path: 'general', element: withQuery(<General />) },
  { path: 'ui', element: withQuery(<UiSettings />) },
];

/** Placeholder routes for every non-settings nav path. */
function sectionRoutes(): RouteObject[] {
  const routes: RouteObject[] = [];
  const seen = new Set<string>();
  for (const section of navigation) {
    if (section.path.startsWith('/settings')) continue;
    for (const entry of [{ label: section.label, path: section.path }, ...(section.children ?? [])]) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      routes.push(
        entry.path === '/'
          ? { index: true, element: placeholder(entry.label) }
          : { path: entry.path.slice(1), element: placeholder(entry.label) },
      );
    }
  }
  return routes;
}

export const routes: RouteObject[] = [
  // Sign-in screens live outside the app shell.
  { path: '/login', element: <Login /> },
  { path: '/setup', element: <Setup /> },
  {
    path: '/',
    element: (
      <AuthGate>
        <AppLayout />
      </AuthGate>
    ),
    children: [
      ...sectionRoutes(),
      { path: 'settings', children: settingsRoutes },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter(basename?: string) {
  return createBrowserRouter(routes, basename ? { basename } : undefined);
}
