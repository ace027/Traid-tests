import type { MonitorOption } from './series.js';

export interface MonitorableEpisode {
  seasonNumber: number;
  episodeNumber: number;
  airDateUtc?: string | null;
  hasFile: boolean;
}

/**
 * Applies a monitor option to a list of episodes and returns monitored flags in the same order.
 * Specials (season 0) are never monitored by any option.
 */
export function monitorEpisodes(option: MonitorOption, episodes: MonitorableEpisode[], now: Date): boolean[] {
  const regular = episodes.filter((e) => e.seasonNumber > 0).map((e) => e.seasonNumber);
  const first = regular.length ? Math.min(...regular) : undefined;
  const last = regular.length ? Math.max(...regular) : undefined;
  const nowMs = now.getTime();
  return episodes.map((e) => {
    if (e.seasonNumber <= 0) return false;
    switch (option) {
      case 'all':
        return true;
      case 'none':
        return false;
      case 'future': {
        if (!e.airDateUtc) return true;
        const t = Date.parse(e.airDateUtc);
        return Number.isNaN(t) ? true : t > nowMs;
      }
      case 'missing':
        return !e.hasFile;
      case 'existing':
        return e.hasFile;
      case 'pilot':
        return e.seasonNumber === 1 && e.episodeNumber === 1;
      case 'firstSeason':
        return e.seasonNumber === first;
      case 'lastSeason':
        return e.seasonNumber === last;
    }
  });
}
