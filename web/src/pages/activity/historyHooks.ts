import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlocklistResource, HistoryEventType, HistoryResource, Paged } from '@sonarr/shared';
import { api, queryKeys } from '../../lib/api';
import { useToast } from '../../components/ui';
import { errorMessage, formatBytes } from '../settings/hooks';

export interface HistoryParams {
  page: number;
  pageSize: number;
  sortKey: 'date';
  sortDirection: 'ascending' | 'descending';
  /** Omitted means every event type. */
  eventType?: HistoryEventType;
}

export interface BlocklistParams {
  page: number;
  pageSize: number;
  sortKey: 'date';
  sortDirection: 'ascending' | 'descending';
}

export const useHistory = (params: HistoryParams) =>
  useQuery({
    queryKey: queryKeys.history({ ...params }),
    queryFn: ({ signal }) => api.get<Paged<HistoryResource>>('history', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  });

export const useBlocklist = (params: BlocklistParams) =>
  useQuery({
    queryKey: queryKeys.blocklist({ ...params }),
    queryFn: ({ signal }) => api.get<Paged<BlocklistResource>>('blocklist', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  });

function useBlocklistMutation<TVars>(fn: (vars: TVars) => Promise<unknown>, success: (vars: TVars) => string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, unknown, TVars>({
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      toast.success(success(vars));
      void qc.invalidateQueries({ queryKey: queryKeys.blocklistAll });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** DELETE /blocklist/:id */
export const useRemoveBlocklist = () =>
  useBlocklistMutation(
    ({ id }: { id: number; title?: string }) => api.del(`blocklist/${id}`),
    ({ title }) => (title ? `Removed ${title} from the blocklist` : 'Removed from the blocklist'),
  );

/** DELETE /blocklist/bulk {ids} */
export const useRemoveBlocklistBulk = () =>
  useBlocklistMutation(
    ({ ids }: { ids: number[] }) => api.fetch('blocklist/bulk', { method: 'DELETE', body: { ids } }),
    ({ ids }) => `Removed ${ids.length} ${ids.length === 1 ? 'release' : 'releases'} from the blocklist`,
  );

// ---- display helpers ------------------------------------------------------------

export const historyEventLabels: Record<HistoryEventType, string> = {
  grabbed: 'Grabbed',
  downloadFolderImported: 'Imported',
  downloadFailed: 'Failed',
  episodeFileDeleted: 'Deleted',
  episodeFileRenamed: 'Renamed',
  downloadIgnored: 'Ignored',
};

const DAY = 86_400_000;

/** '3 hours ago', 'yesterday', '2 weeks ago'; falls back to a short date beyond a year. */
export function formatRelative(iso: string | undefined, now = new Date()): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / (7 * DAY)), 'week');
  if (abs < 365 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), 'month');
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Full local date and time, used as the tooltip of relative dates. */
export function formatAbsolute(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const dataLabels: Record<string, string> = {
  indexer: 'Indexer',
  downloadClient: 'Download client',
  downloadClientName: 'Download client',
  releaseGroup: 'Release group',
  importedPath: 'Imported to',
  droppedPath: 'Imported from',
  sourcePath: 'Source path',
  path: 'Path',
  sourceRelativePath: 'Previous name',
  relativePath: 'New name',
  reason: 'Reason',
  message: 'Message',
  size: 'Size',
  protocol: 'Protocol',
  publishedDate: 'Published',
  guid: 'Release ID',
  torrentInfoHash: 'Torrent info hash',
  downloadUrl: 'Download URL',
};

const reasonLabels: Record<string, string> = {
  upgrade: 'Replaced by a better quality file',
  manual: 'Deleted manually',
  missingFromDisk: 'Missing from disk',
};

/** Splits camelCase keys into words: 'customFormatScore' -> 'Custom format score'. */
function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Event data as readable label/value pairs, known keys first, empty values dropped. */
export function historyDetails(data: Record<string, string> | undefined): { label: string; value: string }[] {
  const entries = Object.entries(data ?? {}).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
  const known = Object.keys(dataLabels);
  entries.sort(([a], [b]) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    return (ia === -1 ? known.length : ia) - (ib === -1 ? known.length : ib);
  });
  return entries.map(([key, raw]) => {
    let value = String(raw);
    if (key === 'size' && /^\d+$/.test(value)) value = formatBytes(Number(value));
    else if (key === 'protocol') value = value === 'usenet' ? 'Usenet' : value === 'torrent' ? 'Torrent' : value;
    else if (key === 'reason') value = reasonLabels[value] ?? value;
    else if (key === 'publishedDate') value = formatAbsolute(value) || value;
    return { label: dataLabels[key] ?? humanize(key), value };
  });
}
