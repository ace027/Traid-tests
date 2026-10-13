import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DownloadClientConfig, MediaManagementConfig, NamingConfig, NamingExamples } from '@sonarr/shared';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui';
import { errorMessage } from './hooks';

export const mediaKeys = {
  mediaManagement: ['config', 'mediamanagement'] as const,
  naming: ['config', 'naming'] as const,
  namingExamples: (draft: NamingConfig) => ['config', 'naming', 'examples', draft] as const,
  downloadClient: ['config', 'downloadclient'] as const,
};

function useConfigSave<T>(path: string, key: readonly unknown[], onSuccess?: () => void, inline = true) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<T, unknown, Partial<T>>({
    mutationFn: (cfg) => api.put<T>(path, cfg),
    onSuccess: async (saved) => {
      qc.setQueryData(key, saved);
      await qc.invalidateQueries({ queryKey: key });
      onSuccess?.();
    },
    onError: (error) => {
      if (!inline) toast.error(errorMessage(error));
    },
  });
}

export const useMediaManagementConfig = () =>
  useQuery({ queryKey: mediaKeys.mediaManagement, queryFn: () => api.get<MediaManagementConfig>('config/mediamanagement') });
export const useSaveMediaManagementConfig = (onSuccess?: () => void) =>
  useConfigSave<MediaManagementConfig>('config/mediamanagement', mediaKeys.mediaManagement, onSuccess);

export const useNamingConfig = () =>
  useQuery({ queryKey: mediaKeys.naming, queryFn: () => api.get<NamingConfig>('config/naming') });
export const useSaveNamingConfig = (onSuccess?: () => void) =>
  useConfigSave<NamingConfig>('config/naming', mediaKeys.naming, onSuccess);

export const useDownloadClientConfig = () =>
  useQuery({ queryKey: mediaKeys.downloadClient, queryFn: () => api.get<DownloadClientConfig>('config/downloadclient') });
export const useSaveDownloadClientConfig = (onSuccess?: () => void) =>
  useConfigSave<DownloadClientConfig>('config/downloadclient', mediaKeys.downloadClient, onSuccess, false);

/** Examples for an unsaved draft; the draft is debounced 300 ms so typing does not flood the server. */
export function useNamingExamples(draft: NamingConfig | undefined) {
  const [debounced, setDebounced] = useState(draft);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(draft), 300);
    return () => clearTimeout(t);
  }, [draft]);
  return useQuery({
    queryKey: debounced ? mediaKeys.namingExamples(debounced) : ['config', 'naming', 'examples', 'none'],
    queryFn: () => api.get<NamingExamples>('config/naming/examples', { query: { ...debounced } }),
    enabled: debounced !== undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
