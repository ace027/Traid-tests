import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { DiskSpaceResource, HealthResource, HealthType } from '@sonarr/shared';
import { Card, PageHeader, StatusBadge, type StatusKind } from '../../components/ui';
import { cn } from '../../lib/cn';
import { LoadError } from '../activity/History';
import { formatBytes, formatSpan, useDiskSpace, useHealth, useSystemStatus } from './hooks';

const healthKind: Record<HealthType, StatusKind> = { ok: 'ok', notice: 'info', warning: 'warning', error: 'error' };
const healthLabel: Record<HealthType, string> = { ok: 'OK', notice: 'Notice', warning: 'Warning', error: 'Error' };

/** Free space below this fraction of the total is shown in the warning colour. */
export const LOW_SPACE_FRACTION = 0.1;

function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-surface-hover" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

function HealthCard() {
  const health = useHealth();
  const items = (health.data ?? []).filter((h) => h.type !== 'ok');
  return (
    <Card title="Health" aria-busy={health.isPending || undefined}>
      {health.isError && !health.data ? (
        <LoadError what="health" error={health.error} onRetry={() => void health.refetch()} />
      ) : health.isPending ? (
        <SkeletonLines />
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-text">
          <StatusBadge status="ok" label="OK" />
          No issues with your configuration
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item: HealthResource) => (
            <li key={`${item.source}:${item.message}`} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
              <StatusBadge status={healthKind[item.type] ?? 'info'} label={healthLabel[item.type] ?? item.type} />
              <span className="min-w-0 flex-1 text-sm break-words text-text">{item.message}</span>
              {item.wikiUrl && (
                <a
                  href={item.wikiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex items-center gap-1 rounded-sm text-sm text-accent hover:underline"
                >
                  Wiki
                  <span className="sr-only"> for: {item.message} (opens in a new tab)</span>
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DiskRow({ disk }: { disk: DiskSpaceResource }) {
  const total = Math.max(0, disk.totalSpace);
  const free = Math.min(Math.max(0, disk.freeSpace), total);
  const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const low = total > 0 && free / total < LOW_SPACE_FRACTION;
  const name = disk.label && disk.label !== disk.path ? `${disk.label} (${disk.path})` : disk.path;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 font-medium break-all text-text">{name}</span>
        <span className={cn('whitespace-nowrap', low ? 'font-medium text-warning' : 'text-text-muted')}>
          {formatBytes(free)} free of {formatBytes(total)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={`Disk space used on ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedPct}
          aria-valuetext={`${usedPct}% used, ${formatBytes(free)} free`}
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-hover"
        >
          <div className={cn('h-full rounded-full', low ? 'bg-warning' : 'bg-accent')} style={{ width: `${usedPct}%` }} />
        </div>
        <span className={cn('w-20 text-right text-xs tabular-nums', low ? 'font-medium text-warning' : 'text-text-muted')}>
          {usedPct}% used
        </span>
      </div>
      {low && <span className="text-xs text-warning">Low disk space</span>}
    </li>
  );
}

function DiskSpaceCard() {
  const disks = useDiskSpace();
  return (
    <Card title="Disk Space" aria-busy={disks.isPending || undefined}>
      {disks.isError && !disks.data ? (
        <LoadError what="disk space" error={disks.error} onRetry={() => void disks.refetch()} />
      ) : disks.isPending ? (
        <SkeletonLines lines={2} />
      ) : disks.data.length === 0 ? (
        <p className="text-sm text-text-muted">No root folders or data folders to report.</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {disks.data.map((d) => (
            <DiskRow key={d.path} disk={d} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AboutCard() {
  const status = useSystemStatus();
  const s = status.data;
  const rows: [string, ReactNode][] = s
    ? [
        ['Version', s.version],
        ['Runtime', `Node ${s.runtimeVersion}`],
        ['Database', `SQLite ${s.databaseVersion}`],
        ['AppData directory', s.appData],
        ['Startup directory', s.startupPath],
        ['Mode', s.isProduction ? 'Production' : 'Development'],
        ['Uptime', formatSpan(Date.now() - Date.parse(s.startTime))],
      ]
    : [];
  return (
    <Card title="About" aria-busy={status.isPending || undefined}>
      {status.isError && !s ? (
        <LoadError what="system status" error={status.error} onRetry={() => void status.refetch()} />
      ) : !s ? (
        <SkeletonLines lines={5} />
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-medium text-text-muted">{label}</dt>
              <dd className="min-w-0 break-all text-text">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

const links = [
  { label: 'Sonarr wiki', href: 'https://wiki.servarr.com/sonarr' },
  { label: 'Project README', href: 'https://github.com/ace027/Traid-tests#readme' },
];

function MoreInfoCard() {
  return (
    <Card title="More Info">
      <ul className="flex flex-col gap-2 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-accent hover:underline"
            >
              {l.label}
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Status() {
  return (
    <>
      <PageHeader title="System" description="Health, disk space and information about this installation." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="xl:col-span-2">
          <HealthCard />
        </div>
        <DiskSpaceCard />
        <AboutCard />
        <div className="xl:col-span-2">
          <MoreInfoCard />
        </div>
      </div>
    </>
  );
}
