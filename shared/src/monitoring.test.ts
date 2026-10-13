import { describe, expect, it } from 'vitest';
import { monitorEpisodes } from './monitoring.js';

const now = new Date('2024-06-01T00:00:00Z');
const eps = [
  { seasonNumber: 0, episodeNumber: 1, airDateUtc: '2025-01-01T00:00:00Z', hasFile: true },
  { seasonNumber: 1, episodeNumber: 1, airDateUtc: '2023-01-01T00:00:00Z', hasFile: true },
  { seasonNumber: 1, episodeNumber: 2, airDateUtc: '2023-01-08T00:00:00Z', hasFile: false },
  { seasonNumber: 2, episodeNumber: 1, airDateUtc: '2024-01-01T00:00:00Z', hasFile: false },
  { seasonNumber: 2, episodeNumber: 2, airDateUtc: '2024-12-01T00:00:00Z', hasFile: false },
  { seasonNumber: 2, episodeNumber: 3, hasFile: false },
];

describe('monitorEpisodes', () => {
  it('all monitors everything but specials', () => {
    expect(monitorEpisodes('all', eps, now)).toEqual([false, true, true, true, true, true]);
  });
  it('none monitors nothing', () => {
    expect(monitorEpisodes('none', eps, now)).toEqual([false, false, false, false, false, false]);
  });
  it('future monitors unaired and unknown air dates, not specials', () => {
    expect(monitorEpisodes('future', eps, now)).toEqual([false, false, false, false, true, true]);
  });
  it('missing and existing split on hasFile', () => {
    expect(monitorEpisodes('missing', eps, now)).toEqual([false, false, true, true, true, true]);
    expect(monitorEpisodes('existing', eps, now)).toEqual([false, true, false, false, false, false]);
  });
  it('pilot monitors only S01E01', () => {
    expect(monitorEpisodes('pilot', eps, now)).toEqual([false, true, false, false, false, false]);
  });
  it('firstSeason and lastSeason ignore season 0', () => {
    expect(monitorEpisodes('firstSeason', eps, now)).toEqual([false, true, true, false, false, false]);
    expect(monitorEpisodes('lastSeason', eps, now)).toEqual([false, false, false, true, true, true]);
  });
  it('handles empty lists and specials-only shows', () => {
    expect(monitorEpisodes('all', [], now)).toEqual([]);
    const only = [{ seasonNumber: 0, episodeNumber: 1, hasFile: false }];
    for (const o of ['all', 'future', 'missing', 'pilot', 'firstSeason', 'lastSeason'] as const) {
      expect(monitorEpisodes(o, only, now)).toEqual([false]);
    }
  });
});
