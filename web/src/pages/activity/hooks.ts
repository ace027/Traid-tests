import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Command, Paged, QueueResource } from '@sonarr/shared';
import { api, queryKeys } from '../../lib/api';
import { useToast } from '../../components/ui';
import { errorMessage } from '../settings/hooks';

export type QueueSortKey = 'timeleft' | 'title' | 'series' | 'progress' | 'added';

export interface QueueParams {
  page: number;
  pageSize: number;
  sortKey: QueueSortKey;
  sortDirection: 'ascending' | 'descending';
  includeUnknownSeriesItems: boolean;
}

export interface QueueStatusResource {
  totalCount: number;
  count: number;
  unknownCount: number;
  errors: boolean;
  warnings: boolean;
}

/** Polling fallback for when the event stream is down; 'queue' events refresh it immediately. */
export const QUEUE_REFETCH_MS = 5000;

export const useQueue = (params: QueueParams) =>
  useQuery({
    queryKey: queryKeys.queue({ ...params }),
    queryFn: ({ signal }) => api.get<Paged<QueueResource>>('queue', { query: { ...params }, signal }),
    refetchInterval: QUEUE_REFETCH_MS,
    placeholderData: keepPreviousData,
  });

export const useQueueStatus = () =>
  useQuery({
    queryKey: queryKeys.queueStatus,
    queryFn: () => api.get<QueueStatusResource>('queue/status'),
    refetchInterval: QUEUE_REFETCH_MS,
  });

export interface RemoveOptions {
  removeFromClient: boolean;
  blocklist: boolean;
}

function useQueueMutation<TVars>(fn: (vars: TVars) => Promise<unknown>, success: (vars: TVars) => string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, unknown, TVars>({
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      toast.success(success(vars));
      void qc.invalidateQueries({ queryKey: queryKeys.queueAll });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** DELETE /queue/:id?removeFromClient&blocklist */
export const useRemoveQueueItem = () =>
  useQueueMutation(
    ({ id, removeFromClient, blocklist }: RemoveOptions & { id: number; title?: string }) =>
      api.del(`queue/${id}`, { query: { removeFromClient, blocklist } }),
    ({ title }) => (title ? `Removed ${title}` : 'Removed from queue'),
  );

/** DELETE /queue/bulk {ids, removeFromClient, blocklist} */
export const useRemoveQueueItems = () =>
  useQueueMutation(
    ({ ids, removeFromClient, blocklist }: RemoveOptions & { ids: number[] }) =>
      api.fetch('queue/bulk', {
        method: 'DELETE',
        body: { ids, removeFromClient, blocklist },
        query: { removeFromClient, blocklist },
      }),
    ({ ids }) => `Removed ${ids.length} ${ids.length === 1 ? 'item' : 'items'} from the queue`,
  );

/** Asks the server to poll the download clients now (RefreshMonitoredDownloads). */
export function useRefreshQueue() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Command, unknown, void>({
    mutationFn: () => api.post<Command>('command', { name: 'RefreshMonitoredDownloads' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.queueAll });
      void qc.invalidateQueries({ queryKey: queryKeys.commands });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ---- formatting ------------------------------------------------------------------

/** Percentage downloaded, 0-100 (whole number). */
export function queueProgress(item: Pick<QueueResource, 'size' | 'sizeleft'>): number {
  if (!item.size || item.size <= 0) return 0;
  const done = ((item.size - Math.max(0, item.sizeleft)) / item.size) * 100;
  return Math.max(0, Math.min(100, Math.round(done)));
}

/**
 * Normalizes a time span ('00:05:03', '1.02:03:04', '26:03:04') to h:mm:ss,
 * folding days into hours ('1.02:03:04' -> '26:03:04'). Unknown input returns '-'.
 */
export function formatTimeLeft(timeleft: string | undefined | null): string {
  if (!timeleft) return '-';
  const m = /^(?:(\d+)[.:](?=\d+:\d+:\d+))?(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(timeleft.trim());
  if (!m) return '-';
  const hours = Number(m[1] ?? 0) * 24 + Number(m[2]);
  return `${hours}:${m[3].padStart(2, '0')}:${m[4].padStart(2, '0')}`;
}
