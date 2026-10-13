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
import { Indexers } from './pages/settings/Indexers';
import { DownloadClients } from './pages/settings/DownloadClients';
import { Queue } from './pages/activity/Queue';
import { History } from './pages/activity/History';
import { Blocklist } from './pages/activity/Blocklist';
import { Missing } from './pages/wanted/Missing';
import { CutoffUnmet } from './pages/wanted/CutoffUnmet';
import { Calendar } from './pages/calendar/Calendar';
import { SeriesIndex } from './pages/series/SeriesIndex';
import { AddNew } from './pages/series/AddNew';
import { LibraryImport } from './pages/series/LibraryImport';
import { SeriesDetail } from './pages/series/SeriesDetail';

/**
 * Series and settings pages fetch with TanStack Query. App provides the shared client; this
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
 * Children of /settings. Import lists, connect and metadata stay placeholders;
 * paths are relative to /settings ('index' is the overview).
 */
export const settingsRoutes: RouteObject[] = [
  { index: true, element: <SettingsIndex /> },
  { path: 'mediamanagement', element: withQuery(<MediaManagement />) },
  { path: 'profiles', element: withQuery(<Profiles />) },
  { path: 'quality', element: withQuery(<Quality />) },
  { path: 'indexers', element: withQuery(<Indexers />) },
  { path: 'downloadclients', element: withQuery(<DownloadClients />) },
  { path: 'importlists', element: placeholder('Import Lists') },
  { path: 'connect', element: placeholder('Connect') },
  { path: 'metadata', element: placeholder('Metadata') },
  { path: 'tags', element: withQuery(<Tags />) },
  { path: 'general', element: withQuery(<General />) },
  { path: 'ui', element: withQuery(<UiSettings />) },
];

/** Real pages for nav paths; every other non-settings nav path is a placeholder. */
const pages: Record<string, ReactNode> = {
  '/': withQuery(<SeriesIndex />),
  '/add/new': withQuery(<AddNew />),
  '/add/import': withQuery(<LibraryImport />),
  '/calendar': withQuery(<Calendar />),
  '/activity/queue': withQuery(<Queue />),
  '/activity/history': withQuery(<History />),
  '/activity/blocklist': withQuery(<Blocklist />),
  '/wanted/missing': withQuery(<Missing />),
  '/wanted/cutoffunmet': withQuery(<CutoffUnmet />),
};

/** Series routes that are not in the navigation. */
export const seriesRoutes: RouteObject[] = [{ path: 'series/:titleSlug', element: withQuery(<SeriesDetail />) }];

/** Routes for every non-settings nav path (real page or placeholder). */
function sectionRoutes(): RouteObject[] {
  const routes: RouteObject[] = [];
  const seen = new Set<string>();
  for (const section of navigation) {
    if (section.path.startsWith('/settings')) continue;
    for (const entry of [{ label: section.label, path: section.path }, ...(section.children ?? [])]) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      const element = pages[entry.path] ?? placeholder(entry.label);
      routes.push(entry.path === '/' ? { index: true, element } : { path: entry.path.slice(1), element });
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
      ...seriesRoutes,
      { path: 'settings', children: settingsRoutes },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter(basename?: string) {
  return createBrowserRouter(routes, basename ? { basename } : undefined);
}
