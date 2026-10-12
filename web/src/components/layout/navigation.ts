import { Activity, Calendar, Monitor, Settings, TriangleAlert, Tv, type LucideIcon } from 'lucide-react';

export interface NavLeaf {
  label: string;
  path: string;
}

export interface NavSection {
  label: string;
  /** Where the top-level entry links to. */
  path: string;
  icon: LucideIcon;
  /** Path prefixes (besides children) that make this section active. */
  match: string[];
  children?: NavLeaf[];
}

/** Sonarr's navigation tree. Routes and the command palette are derived from this. */
export const navigation: NavSection[] = [
  {
    label: 'Series',
    path: '/',
    icon: Tv,
    match: ['/series', '/add'],
    children: [
      { label: 'Add New', path: '/add/new' },
      { label: 'Library Import', path: '/add/import' },
    ],
  },
  { label: 'Calendar', path: '/calendar', icon: Calendar, match: ['/calendar'] },
  {
    label: 'Activity',
    path: '/activity/queue',
    icon: Activity,
    match: ['/activity'],
    children: [
      { label: 'Queue', path: '/activity/queue' },
      { label: 'History', path: '/activity/history' },
      { label: 'Blocklist', path: '/activity/blocklist' },
    ],
  },
  {
    label: 'Wanted',
    path: '/wanted/missing',
    icon: TriangleAlert,
    match: ['/wanted'],
    children: [
      { label: 'Missing', path: '/wanted/missing' },
      { label: 'Cutoff Unmet', path: '/wanted/cutoffunmet' },
    ],
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    match: ['/settings'],
    children: [
      { label: 'Media Management', path: '/settings/mediamanagement' },
      { label: 'Profiles', path: '/settings/profiles' },
      { label: 'Quality', path: '/settings/quality' },
      { label: 'Indexers', path: '/settings/indexers' },
      { label: 'Download Clients', path: '/settings/downloadclients' },
      { label: 'Import Lists', path: '/settings/importlists' },
      { label: 'Connect', path: '/settings/connect' },
      { label: 'Metadata', path: '/settings/metadata' },
      { label: 'Tags', path: '/settings/tags' },
      { label: 'General', path: '/settings/general' },
      { label: 'UI', path: '/settings/ui' },
    ],
  },
  {
    label: 'System',
    path: '/system/status',
    icon: Monitor,
    match: ['/system'],
    children: [
      { label: 'Status', path: '/system/status' },
      { label: 'Tasks', path: '/system/tasks' },
      { label: 'Backup', path: '/system/backup' },
      { label: 'Updates', path: '/system/updates' },
      { label: 'Events', path: '/system/events' },
      { label: 'Log Files', path: '/system/logs/files' },
    ],
  },
];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

export function isSectionActive(section: NavSection, pathname: string): boolean {
  if (section.path === '/' && pathname === '/') return true;
  return section.match.some((p) => underPrefix(pathname, p));
}

export function isLeafActive(leaf: NavLeaf, pathname: string): boolean {
  return pathname === leaf.path || pathname === `${leaf.path}/`;
}

export interface NavEntry {
  /** Display title, e.g. 'Tags'. */
  label: string;
  /** Section it belongs to, e.g. 'Settings' (same as label for top level). */
  section: string;
  path: string;
  icon: LucideIcon;
}

/** Every unique navigable page, in navigation order. */
export function flattenNavigation(tree: NavSection[] = navigation): NavEntry[] {
  const seen = new Set<string>();
  const out: NavEntry[] = [];
  for (const s of tree) {
    const entries: NavEntry[] = [
      { label: s.label, section: s.label, path: s.path, icon: s.icon },
      ...(s.children ?? []).map((c) => ({ label: c.label, section: s.label, path: c.path, icon: s.icon })),
    ];
    for (const e of entries) {
      if (seen.has(e.path)) continue;
      seen.add(e.path);
      out.push(e);
    }
  }
  return out;
}

/** Title for a path, used by placeholder pages and document.title. */
export function titleForPath(pathname: string): string | undefined {
  return flattenNavigation().find((e) => e.path === pathname)?.label;
}
