import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { HostConfig, QualityDefinition, QualityProfile, QualityProfileInput, RootFolder, Tag, UiConfig } from '@sonarr/shared';
import { ApiError, api, queryKeys } from '../../lib/api';
import { useToast } from '../../components/ui';

/** Human readable message for a failed request (first validation message wins). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.errors[0]?.errorMessage ?? error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
}

interface MutationOptions {
  /** Do not toast errors: the caller shows them inline (e.g. next to a field). */
  inline?: boolean;
  onSuccess?: () => void;
}

/** Shared mutation wiring: invalidate `keys` on success, toast failures. */
function useApiMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  keys: QueryKey[],
  options: MutationOptions = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
      options.onSuccess?.();
    },
    onError: (error) => {
      if (!options.inline) toast.error(errorMessage(error));
    },
  });
}

// Root folders
export const useRootFolders = () =>
  useQuery({ queryKey: queryKeys.rootFolders, queryFn: () => api.get<RootFolder[]>('rootfolder') });

export const useAddRootFolder = (options?: MutationOptions) =>
  useApiMutation((path: string) => api.post<RootFolder>('rootfolder', { path }), [queryKeys.rootFolders], {
    inline: true,
    ...options,
  });

export const useDeleteRootFolder = (options?: MutationOptions) =>
  useApiMutation((id: number) => api.del(`rootfolder/${id}`), [queryKeys.rootFolders], options);

// Tags
export const useTags = () => useQuery({ queryKey: queryKeys.tags, queryFn: () => api.get<Tag[]>('tag') });

export const useCreateTag = (options?: MutationOptions) =>
  useApiMutation((label: string) => api.post<Tag>('tag', { label }), [queryKeys.tags], { inline: true, ...options });

export const useUpdateTag = (options?: MutationOptions) =>
  useApiMutation((tag: Tag) => api.put<Tag>(`tag/${tag.id}`, tag), [queryKeys.tags], { inline: true, ...options });

export const useDeleteTag = (options?: MutationOptions) =>
  useApiMutation((id: number) => api.del(`tag/${id}`), [queryKeys.tags], options);

// Quality definitions
export const useQualityDefinitions = () =>
  useQuery({ queryKey: queryKeys.qualityDefinitions, queryFn: () => api.get<QualityDefinition[]>('qualitydefinition') });

export const useUpdateQualityDefinitions = (options?: MutationOptions) =>
  useApiMutation(
    (defs: QualityDefinition[]) => api.put<QualityDefinition[]>('qualitydefinition/update', defs),
    [queryKeys.qualityDefinitions],
    options,
  );

// Quality profiles
export const useQualityProfiles = () =>
  useQuery({ queryKey: queryKeys.qualityProfiles, queryFn: () => api.get<QualityProfile[]>('qualityprofile') });

export const useQualityProfileSchema = () =>
  useQuery({ queryKey: queryKeys.qualityProfileSchema, queryFn: () => api.get<QualityProfile>('qualityprofile/schema') });

export const useCreateQualityProfile = (options?: MutationOptions) =>
  useApiMutation((p: QualityProfileInput) => api.post<QualityProfile>('qualityprofile', p), [queryKeys.qualityProfiles], {
    inline: true,
    ...options,
  });

export const useUpdateQualityProfile = (options?: MutationOptions) =>
  useApiMutation(
    (p: QualityProfileInput & { id: number }) => api.put<QualityProfile>(`qualityprofile/${p.id}`, p),
    [queryKeys.qualityProfiles],
    { inline: true, ...options },
  );

export const useDeleteQualityProfile = (options?: MutationOptions) =>
  useApiMutation((id: number) => api.del(`qualityprofile/${id}`), [queryKeys.qualityProfiles], options);

// Host config
export const useHostConfig = () =>
  useQuery({ queryKey: queryKeys.hostConfig, queryFn: () => api.get<HostConfig>('config/host') });

export const useUpdateHostConfig = (options?: MutationOptions) =>
  useApiMutation((cfg: Partial<HostConfig>) => api.put<HostConfig>('config/host', cfg), [queryKeys.hostConfig], {
    inline: true,
    ...options,
  });

export const useResetApiKey = (options?: MutationOptions) =>
  useApiMutation(() => api.post<HostConfig>('config/host/apikey/reset'), [queryKeys.hostConfig], options);

// UI config
export const useUiConfig = () =>
  useQuery({ queryKey: queryKeys.uiConfig, queryFn: () => api.get<UiConfig>('config/ui') });

export const useUpdateUiConfig = (options?: MutationOptions) =>
  useApiMutation((cfg: Partial<UiConfig>) => api.put<UiConfig>('config/ui', cfg), [queryKeys.uiConfig], options);

/** 1536 -> "1.5 KB"; 1.2e12 -> "1.1 TB" (binary units, like Sonarr). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
