import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EpisodeFile, Paged, WantedRecord } from '@sonarr/shared';
import { api, queryKeys } from '../../lib/api';
import { useMonitorEpisodes, useRunCommand } from '../series/hooks';

export type WantedKind = 'missing' | 'cutoff';
export type WantedSortKey = 'airDateUtc' | 'series.sortTitle';

export interface WantedParams {
  page: number;
  pageSize: number;
  sortKey: WantedSortKey;
  sortDirection: 'ascending' | 'descending';
  monitored: boolean;
  includeSeries: true;
}

/** Cutoff unmet records may carry their current file. */
export type WantedItem = WantedRecord & { episodeFile?: EpisodeFile };

const wantedQuery = (kind: WantedKind, params: WantedParams) => ({
  queryKey: kind === 'missing' ? queryKeys.wantedMissing({ ...params }) : queryKeys.wantedCutoff({ ...params }),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    api.get<Paged<WantedItem>>(`wanted/${kind}`, { query: { ...params }, signal }),
  placeholderData: keepPreviousData,
});

export const useWantedMissing = (params: WantedParams) => useQuery(wantedQuery('missing', params));
export const useWantedCutoff = (params: WantedParams) => useQuery(wantedQuery('cutoff', params));
export const useWanted = (kind: WantedKind, params: WantedParams) => useQuery(wantedQuery(kind, params));

/** Command that searches every episode of a list. */
export const searchAllCommand: Record<WantedKind, { name: string; label: string }> = {
  missing: { name: 'MissingEpisodeSearch', label: 'missing episode search' },
  cutoff: { name: 'CutoffUnmetEpisodeSearch', label: 'cutoff unmet episode search' },
};

/** Search actions for the wanted lists: selected episodes (EpisodeSearch) or the whole list. */
export function useWantedSearch(kind: WantedKind) {
  const run = useRunCommand();
  return {
    isPending: run.isPending,
    searchEpisodes: (episodeIds: number[], options?: { onSuccess?: () => void }) =>
      run.mutate(
        {
          name: 'EpisodeSearch',
          body: { episodeIds },
          label: episodeIds.length === 1 ? 'episode search' : `search for ${episodeIds.length} episodes`,
        },
        options,
      ),
    searchAll: (options?: { onSuccess?: () => void }) => run.mutate({ ...searchAllCommand[kind] }, options),
  };
}

export { useMonitorEpisodes };
