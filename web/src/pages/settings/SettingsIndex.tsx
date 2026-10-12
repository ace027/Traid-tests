import { Link } from 'react-router-dom';
import {
  Cog,
  Download,
  FolderCog,
  Gauge,
  ListPlus,
  Palette,
  Plug,
  SlidersHorizontal,
  Tags as TagsIcon,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../../components/ui';

interface SettingsLink {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const links: SettingsLink[] = [
  { to: 'mediamanagement', label: 'Media Management', description: 'Root folders and file handling', icon: FolderCog },
  { to: 'profiles', label: 'Profiles', description: 'Quality profiles and upgrade rules', icon: SlidersHorizontal },
  { to: 'quality', label: 'Quality', description: 'Size limits for each quality', icon: Gauge },
  { to: 'indexers', label: 'Indexers', description: 'Where releases are searched', icon: Tv },
  { to: 'downloadclients', label: 'Download Clients', description: 'Apps that fetch your releases', icon: Download },
  { to: 'importlists', label: 'Import Lists', description: 'Add series from external lists', icon: ListPlus },
  { to: 'connect', label: 'Connect', description: 'Notifications and integrations', icon: Plug },
  { to: 'metadata', label: 'Metadata', description: 'Metadata files for your media', icon: Cog },
  { to: 'tags', label: 'Tags', description: 'Group and filter with tags', icon: TagsIcon },
  { to: 'general', label: 'General', description: 'Host, security and logging', icon: Cog },
  { to: 'ui', label: 'UI', description: 'Calendar, dates and theme', icon: Palette },
];

export function SettingsIndex() {
  return (
    <>
      <PageHeader title="Settings" description="Configure Sonarr." />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {links.map(({ to, label, description, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="focus-ring flex h-full items-start gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-sm transition-colors hover:border-border-strong hover:bg-surface-hover"
            >
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold text-text">{label}</span>
                <span className="block text-sm text-text-muted">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
