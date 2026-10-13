import { useSyncExternalStore } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { ServerEvent } from '@sonarr/shared';
import { loadInitialize, queryKeys } from './api';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Server event name -> query keys to invalidate. Unknown names are ignored.
 * Config aliases cover the naming the server may use for host/UI config.
 */
export const eventQueryKeys: Record<string, readonly QueryKey[]> = {
  rootfolder: [queryKeys.rootFolders],
  tag: [queryKeys.tags],
  qualitydefinition: [queryKeys.qualityDefinitions],
  qualityprofile: [queryKeys.qualityProfiles],
  command: [queryKeys.commands],
  hostconfig: [queryKeys.hostConfig, queryKeys.systemStatus],
  'config/host': [queryKeys.hostConfig, queryKeys.systemStatus],
  host: [queryKeys.hostConfig, queryKeys.systemStatus],
  uiconfig: [queryKeys.uiConfig],
  'config/ui': [queryKeys.uiConfig],
  ui: [queryKeys.uiConfig],
  series: [queryKeys.series],
  episode: [['episode'], queryKeys.wantedAll, queryKeys.calendarAll],
  episodefile: [['episodefile'], queryKeys.series, queryKeys.wantedAll, queryKeys.calendarAll],
  indexer: [queryKeys.indexers, queryKeys.indexerStatus],
  indexerstatus: [queryKeys.indexerStatus],
  downloadclient: [queryKeys.downloadClients],
  queue: [queryKeys.queueAll],
  history: [queryKeys.historyAll],
  blocklist: [queryKeys.blocklistAll],
};

export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30000;

/** Backoff delay for the n-th consecutive failure (0-based): 1s, 2s, 4s ... capped at 30s. */
export function backoffDelay(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
}

// ---- connection status store -------------------------------------------

let status: ConnectionStatus = 'disconnected';
const statusListeners = new Set<() => void>();

function setStatus(next: ConnectionStatus) {
  if (status === next) return;
  status = next;
  for (const l of statusListeners) l();
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** Live state of the realtime event stream. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribeStatus, getConnectionStatus, getConnectionStatus);
}

// ---- event handling -------------------------------------------------------

/** Invalidates the queries matching a server event. Returns true when it was handled. */
export function handleServerEvent(queryClient: QueryClient, event: Pick<ServerEvent, 'name'>): boolean {
  const keys = eventQueryKeys[event.name?.toLowerCase?.() ?? ''];
  if (!keys) return false;
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
  return true;
}

function invalidateAll(queryClient: QueryClient) {
  const unique = new Set(Object.values(eventQueryKeys).flat());
  for (const queryKey of unique) void queryClient.invalidateQueries({ queryKey });
}

/**
 * Opens the SSE stream at `${urlBase}/api/v3/events` (with `?apikey=` when initialize.json
 * provided a key; otherwise the same-origin session cookie authenticates it) and keeps the
 * query cache fresh. Transient drops are retried by EventSource itself (which
 * resends Last-Event-ID so missed events are replayed); if the browser gives
 * up (readyState CLOSED) we reconnect with exponential backoff from 1 s to
 * 30 s and refetch everything once back, since the replay position is lost.
 * Does nothing when EventSource is unavailable (jsdom, old browsers).
 *
 * Returns a stop function.
 */
export function startEventStream(queryClient: QueryClient): () => void {
  if (typeof globalThis.EventSource === 'undefined') {
    return () => {};
  }

  let stopped = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let needsResync = false;

  const connect = async () => {
    if (stopped) return;
    setStatus('connecting');
    let url: string;
    try {
      const { apiKey, urlBase } = await loadInitialize();
      url = apiKey ? `${urlBase}/api/v3/events?apikey=${encodeURIComponent(apiKey)}` : `${urlBase}/api/v3/events`;
    } catch {
      scheduleReconnect();
      return;
    }
    if (stopped) return;

    const es = new EventSource(url);
    source = es;

    es.onopen = () => {
      if (stopped || source !== es) return;
      attempt = 0;
      setStatus('connected');
      if (needsResync) {
        needsResync = false;
        invalidateAll(queryClient);
      }
    };

    es.onmessage = (msg: MessageEvent<string>) => {
      if (stopped || source !== es) return;
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      if (event && typeof event.name === 'string') handleServerEvent(queryClient, event);
    };

    es.onerror = () => {
      if (stopped || source !== es) return;
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        source = null;
        needsResync = true;
        scheduleReconnect();
      } else {
        // Browser is retrying on its own and will send Last-Event-ID.
        setStatus('connecting');
      }
    };
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    setStatus('disconnected');
    const delay = backoffDelay(attempt);
    attempt += 1;
    clearTimeout(timer);
    timer = setTimeout(() => void connect(), delay);
  };

  void connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
    source = null;
    setStatus('disconnected');
  };
}
