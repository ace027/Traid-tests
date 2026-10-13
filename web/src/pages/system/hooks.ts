import { useMutation, useQuery, useQueryClient, keepPreviousData, type QueryKey } from '@tanstack/react-query';
import type {
  BackupResource,
  Command,
  DiskSpaceResource,
  HealthResource,
  LogEntry,
  LogFileResource,
  LogLevel,
  Paged,
  ScheduledTaskResource,
  SystemStatus,
  UpdateResource,
} from '@sonarr/shared';
import { ApiError, api, buildApiUrl, loadInitialize, queryKeys } from '../../lib/api';
import { useToast } from '../../components/ui';
import { errorMessage } from '../settings/hooks';

export { errorMessage, formatBytes } from '../settings/hooks';

interface MutationOptions<TData = unknown> {
  /** Do not toast errors: the caller shows them inline. */
  inline?: boolean;
  onSuccess?: (data: TData) => void;
}

/** Same wiring as the settings hooks: invalidate `keys` on success, toast failures. */
function useApiMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  keys: QueryKey[],
  options: MutationOptions<TData> = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async (data) => {
      await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
      options.onSuccess?.(data);
    },
    onError: (error) => {
      if (!options.inline) toast.error(errorMessage(error));
    },
  });
}

/** Overridable side effects (tests replace them). */
export const systemEnv = {
  /** Delay between /ping attempts while waiting for a restart. */
  pingIntervalMs: 2000,
  /** After this long without seeing the server go down, reload anyway. */
  restartGraceMs: 10_000,
  reload: () => window.location.reload(),
};

// ---- status, health, disk space -------------------------------------------

export const useSystemStatus = () =>
  useQuery({ queryKey: queryKeys.systemStatus, queryFn: () => api.get<SystemStatus>('system/status') });

export const useHealth = () =>
  useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.get<HealthResource[]>('health'),
    // SSE keeps it fresh; the interval covers a dropped stream.
    refetchInterval: 5 * 60_000,
  });

/** Health items that count as issues (warnings and errors). */
export const healthIssues = (items: HealthResource[] | undefined) =>
  (items ?? []).filter((h) => h.type === 'warning' || h.type === 'error');

export const useDiskSpace = () =>
  useQuery({ queryKey: queryKeys.diskSpace, queryFn: () => api.get<DiskSpaceResource[]>('diskspace') });

export const useUpdates = () =>
  useQuery({ queryKey: queryKeys.updates, queryFn: () => api.get<UpdateResource[]>('update') });

// ---- tasks and commands ---------------------------------------------------

export const isActiveCommand = (c: Pick<Command, 'status'>) => c.status === 'queued' || c.status === 'started';

export const useTasks = () =>
  useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => api.get<ScheduledTaskResource[]>('system/task'),
    // Relative times ("in 3 minutes") drift; refresh them now and then.
    refetchInterval: 60_000,
  });

/** All commands; polls every 2 s while any is queued or started (SSE also invalidates). */
export const useCommands = () =>
  useQuery({
    queryKey: queryKeys.commands,
    queryFn: () => api.get<Command[]>('command'),
    refetchInterval: (query) => (query.state.data?.some(isActiveCommand) ? 2000 : false),
  });

/**
 * Runs a command by name (POST /command). `running` is true while a command with that
 * name is queued or started, and the caller should disable its button meanwhile. The
 * server de-dupes too, so a double click never queues twice.
 */
export function useRunTask(name: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const commands = useCommands();
  const mutation = useMutation<Command, unknown, void>({
    mutationFn: () => api.post<Command>('command', { name }),
    onSuccess: async (cmd) => {
      qc.setQueryData<Command[]>(queryKeys.commands, (list) =>
        list ? [cmd, ...list.filter((c) => c.id !== cmd.id)] : [cmd],
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.commands }),
        qc.invalidateQueries({ queryKey: queryKeys.tasks }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const running = (commands.data ?? []).some((c) => c.name === name && isActiveCommand(c));
  return { run: () => mutation.mutate(), running: running || mutation.isPending, isPending: mutation.isPending };
}

// ---- logs -------------------------------------------------------------------

export interface LogParams {
  page: number;
  pageSize: number;
  level?: LogLevel;
}

export const useLogs = (params: LogParams) =>
  useQuery({
    queryKey: queryKeys.logs({ page: params.page, pageSize: params.pageSize, level: params.level }),
    queryFn: ({ signal }) =>
      api.get<Paged<LogEntry>>('log', {
        query: { page: params.page, pageSize: params.pageSize, level: params.level },
        signal,
      }),
    placeholderData: keepPreviousData,
  });

export const useLogFiles = () =>
  useQuery({ queryKey: queryKeys.logFiles, queryFn: () => api.get<LogFileResource[]>('log/file') });

// ---- backups, restore, restart ------------------------------------------------

export interface RestoreResult {
  restartRequired: boolean;
}

export const useBackups = () =>
  useQuery({ queryKey: queryKeys.backups, queryFn: () => api.get<BackupResource[]>('system/backup') });

export const useCreateBackup = (options?: MutationOptions<BackupResource>) =>
  useApiMutation(() => api.post<BackupResource>('system/backup'), [queryKeys.backups], options);

export const useDeleteBackup = (options?: MutationOptions<void>) =>
  useApiMutation(
    (name: string) => api.del<void>(`system/backup/${encodeURIComponent(name)}`),
    [queryKeys.backups],
    options,
  );

export const useRestoreBackup = (options?: MutationOptions<RestoreResult>) =>
  useApiMutation(
    (name: string) => api.post<RestoreResult>(`system/backup/restore/${encodeURIComponent(name)}`),
    [],
    options,
  );

/** Sends a request with the API key and a raw (non-JSON) body or response. */
async function rawApiFetch(path: string, init: { method: 'GET' | 'POST'; body?: Blob; contentType?: string }) {
  const { apiKey, urlBase } = await loadInitialize();
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  if (init.contentType) headers['Content-Type'] = init.contentType;
  const res = await fetch(buildApiUrl(urlBase, path), {
    method: init.method,
    headers,
    body: init.body,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = res.statusText || `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { message?: unknown };
      if (typeof data?.message === 'string' && data.message) message = data.message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

export const useUploadRestore = (options?: MutationOptions<RestoreResult>) =>
  useApiMutation(
    async (file: File) => {
      const res = await rawApiFetch('system/backup/restore/upload', {
        method: 'POST',
        body: file,
        contentType: 'application/zip',
      });
      const text = await res.text();
      return (text ? JSON.parse(text) : { restartRequired: true }) as RestoreResult;
    },
    [],
    options,
  );

/**
 * Downloads an API file with the API key header (a plain link could not send it) and
 * hands it to the browser as a blob URL.
 */
export async function downloadApiFile(path: string, filename: string): Promise<void> {
  const res = await rawApiFetch(path, { method: 'GET' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const useRestart = (options?: MutationOptions<unknown>) =>
  useApiMutation(() => api.post<unknown>('system/restart'), [], options);

export const useShutdown = (options?: MutationOptions<unknown>) =>
  useApiMutation(() => api.post<unknown>('system/shutdown'), [], options);

/** One /ping attempt; false while the server is down or restarting. */
async function ping(urlBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${urlBase}/ping`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Polls /ping after a restart request until the server answers again, then reloads the page.
 * The server may still answer for a moment before it goes down, so an "up" answer only counts
 * once it was seen down (or after `restartGraceMs`). Returns a cancel function.
 */
export function waitForRestart(urlBase: string, onBack: () => void = () => systemEnv.reload()): () => void {
  let cancelled = false;
  let seenDown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  const tick = async () => {
    if (cancelled) return;
    const up = await ping(urlBase);
    if (cancelled) return;
    if (!up) seenDown = true;
    else if (seenDown || Date.now() - started >= systemEnv.restartGraceMs) {
      onBack();
      return;
    }
    timer = setTimeout(() => void tick(), systemEnv.pingIntervalMs);
  };
  timer = setTimeout(() => void tick(), systemEnv.pingIntervalMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

// ---- formatting -------------------------------------------------------------

/** 'RefreshMonitoredDownloads' -> 'Refresh Monitored Downloads'; 'RssSync' -> 'RSS Sync'. */
export function humanizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\bRss\b/g, 'RSS')
    .trim();
}

/** Minutes -> '15 minutes', '12 hours', '1 day', '7 days'. */
export function formatInterval(minutes: number): string {
  if (!minutes || minutes <= 0) return 'Disabled';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

/** Milliseconds -> '2d 3h 4m' (or '45s' under a minute). */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d === 0 && h === 0 && m === 0) return `${s}s`;
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

/** Duration between two ISO times, or '-' when either is missing. */
export function durationBetween(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '-';
  return formatSpan(Date.parse(end) - Date.parse(start));
}
