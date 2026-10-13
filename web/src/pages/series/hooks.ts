import { useEffect, useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  AddSeriesInput,
  Command,
  Episode,
  EpisodeFile,
  MonitorOption,
  ReleaseResource,
  RootFolder,
  Series,
  SeriesLookup,
  SeriesStatus,
  SeriesType,
  UpdateSeriesInput,
} from '@sonarr/shared';
import { ApiError, api, queryKeys } from '../../lib/api';
import { useToast } from '../../components/ui';
import { errorMessage } from '../settings/hooks';

// Root folders, quality profiles, tags and UI config come from the settings hooks.
export { useRootFolders, useQualityProfiles, useTags, useUiConfig, formatBytes, errorMessage } from '../settings/hooks';

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

/** One root folder with its unmapped folders (Library Import). */
export const useRootFolder = (id: number | undefined) =>
  useQuery({
    queryKey: queryKeys.rootFolder(id ?? 0),
    queryFn: () => api.get<RootFolder>(`rootfolder/${id}`),
    enabled: id !== undefined && id > 0,
  });

// ---- series ---------------------------------------------------------------

export const useSeriesList = () => useQuery({ queryKey: queryKeys.series, queryFn: () => api.get<Series[]>('series') });

export const useSeries = (id: number | undefined) =>
  useQuery({
    queryKey: queryKeys.seriesDetail(id ?? 0),
    queryFn: () => api.get<Series>(`series/${id}`),
    enabled: id !== undefined && id > 0,
  });

/** Lookup by name or 'tvdb:123'; only runs for terms of two or more characters. */
export const seriesLookupQuery = (term: string) => {
  const t = term.trim();
  return queryOptions({
    queryKey: queryKeys.seriesLookup(t),
    queryFn: ({ signal }) => api.get<SeriesLookup[]>('series/lookup', { query: { term: t }, signal }),
    enabled: t.length >= 2,
    staleTime: 5 * 60_000,
  });
};

export const useSeriesLookup = (term: string) => useQuery(seriesLookupQuery(term));

export const useAddSeries = (options?: MutationOptions<Series>) =>
  useApiMutation((input: AddSeriesInput) => api.post<Series>('series', input), [queryKeys.series], options);

export const useUpdateSeries = (options?: MutationOptions<Series>) =>
  useApiMutation(
    ({ id, ...input }: UpdateSeriesInput & { id: number }) => api.put<Series>(`series/${id}`, input),
    [queryKeys.series, ['episode']],
    options,
  );

export const useDeleteSeries = (options?: MutationOptions<void>) =>
  useApiMutation(
    ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) =>
      api.del(`series/${id}`, { query: { deleteFiles } }),
    [queryKeys.series],
    options,
  );

// ---- episodes ---------------------------------------------------------------

export const useEpisodes = (seriesId: number | undefined) =>
  useQuery({
    queryKey: queryKeys.episodes(seriesId ?? 0),
    queryFn: () => api.get<Episode[]>('episode', { query: { seriesId } }),
    enabled: seriesId !== undefined && seriesId > 0,
  });

export const useEpisodeFiles = (seriesId: number | undefined) =>
  useQuery({
    queryKey: queryKeys.episodeFiles(seriesId ?? 0),
    queryFn: () => api.get<EpisodeFile[]>('episodefile', { query: { seriesId } }),
    enabled: seriesId !== undefined && seriesId > 0,
  });

export const useMonitorEpisode = (options?: MutationOptions<Episode>) =>
  useApiMutation(
    ({ id, monitored }: { id: number; monitored: boolean }) => api.put<Episode>(`episode/${id}`, { monitored }),
    [['episode'], queryKeys.series],
    options,
  );

export const useMonitorEpisodes = (options?: MutationOptions<unknown>) =>
  useApiMutation(
    (body: { episodeIds: number[]; monitored: boolean }) => api.put<unknown>('episode/monitor', body),
    [['episode'], queryKeys.series],
    options,
  );

// ---- commands -------------------------------------------------------------

export interface RunCommandOptions {
  /** Toast shown instead of the error when the server answers 400 'Unknown command'. */
  unknownCommandMessage?: string;
}

/** POST /command { name, ...body } and toast 'Started {label}'. */
export function useRunCommand(options: RunCommandOptions = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Command, unknown, { name: string; body?: Record<string, unknown>; label?: string }>({
    mutationFn: ({ name, body }) => api.post<Command>('command', { name, ...body }),
    onSuccess: (_data, { name, label }) => {
      toast.success(`Started ${label ?? name}`);
      void qc.invalidateQueries({ queryKey: queryKeys.commands });
    },
    onError: (error) => {
      if (
        options.unknownCommandMessage &&
        error instanceof ApiError &&
        error.status === 400 &&
        /unknown command/i.test(error.message)
      ) {
        toast.info(options.unknownCommandMessage);
        return;
      }
      toast.error(errorMessage(error));
    },
  });
}

// ---- releases ---------------------------------------------------------------

export type ReleaseSearchParams = { episodeId: number } | { seriesId: number; seasonNumber: number };

/**
 * Interactive search (GET /release). Runs only while `enabled` (the modal is open), never
 * retries (searches hit every indexer) and is always considered stale so reopening searches again.
 */
export const useReleases = (params: ReleaseSearchParams, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.releases({ ...params }),
    queryFn: ({ signal }) => api.get<ReleaseResource[]>('release', { query: { ...params }, signal }),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

/** POST /release {guid, indexerId}; toasts 'Grabbed {title}' or the server's message (e.g. 409). */
export function useGrabRelease() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, unknown, Pick<ReleaseResource, 'guid' | 'indexerId' | 'title'>>({
    mutationFn: ({ guid, indexerId }) => api.post('release', { guid, indexerId }),
    onSuccess: (_data, { title }) => {
      toast.success(`Grabbed ${title}`);
      void qc.invalidateQueries({ queryKey: queryKeys.queueAll });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ---- helpers ----------------------------------------------------------------

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export const monitorOptionLabels: Record<MonitorOption, string> = {
  all: 'All Episodes',
  future: 'Future Episodes',
  missing: 'Missing Episodes',
  existing: 'Existing Episodes',
  pilot: 'Pilot Episode',
  firstSeason: 'First Season',
  lastSeason: 'Last Season',
  none: 'None',
};

export const seriesTypeLabels: Record<SeriesType, string> = {
  standard: 'Standard',
  daily: 'Daily',
  anime: 'Anime',
};

export const statusLabels: Record<SeriesStatus, string> = {
  continuing: 'Continuing',
  ended: 'Ended',
  upcoming: 'Upcoming',
  deleted: 'Deleted',
};

export const statusVariant = (status: SeriesStatus) =>
  status === 'continuing' ? 'success' : status === 'ended' ? 'neutral' : status === 'upcoming' ? 'info' : 'danger';

type WithImages = Pick<Series, 'images'> & { remotePoster?: string };

export function posterUrl(s: WithImages): string | undefined {
  const img = s.images.find((i) => i.coverType === 'poster');
  return img?.remoteUrl || img?.url || s.remotePoster || undefined;
}

export function fanartUrl(s: WithImages): string | undefined {
  const img = s.images.find((i) => i.coverType === 'fanart');
  return img?.remoteUrl || img?.url || undefined;
}

/** 'The Office' -> 'TO'; used when a series has no poster. */
export function initials(title: string): string {
  const words = title
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));
  return (words.slice(0, 2).map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '').join('') || '?').toUpperCase();
}

/** Folder name for library import lookup: 'Show Name (2019)' -> 'Show Name'. */
export function folderLookupTerm(folderName: string): string {
  return folderName.replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

export function seasonName(n: number): string {
  return n === 0 ? 'Specials' : `Season ${n}`;
}
