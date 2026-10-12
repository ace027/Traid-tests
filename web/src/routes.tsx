import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { navigation } from './components/layout/navigation';
import { Placeholder } from './pages/Placeholder';
import { NotFound } from './pages/NotFound';

const placeholder = (title: string) => <Placeholder title={title} />;

/**
 * Children of /settings. Plan 01-04 swaps the placeholders for real pages;
 * paths are relative to /settings ('index' is the overview).
 */
export const settingsRoutes: RouteObject[] = [
  { index: true, element: placeholder('Settings') },
  { path: 'mediamanagement', element: placeholder('Media Management') },
  { path: 'profiles', element: placeholder('Profiles') },
  { path: 'quality', element: placeholder('Quality') },
  { path: 'indexers', element: placeholder('Indexers') },
  { path: 'downloadclients', element: placeholder('Download Clients') },
  { path: 'importlists', element: placeholder('Import Lists') },
  { path: 'connect', element: placeholder('Connect') },
  { path: 'metadata', element: placeholder('Metadata') },
  { path: 'tags', element: placeholder('Tags') },
  { path: 'general', element: placeholder('General') },
  { path: 'ui', element: placeholder('UI') },
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
  {
    path: '/',
    element: <AppLayout />,
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
