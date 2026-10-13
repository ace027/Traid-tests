import type { Episode, EpisodeFile, QualityProfile, RootFolder, Series, SeriesLookup, Tag } from '@sonarr/shared';

/** Typed sample data for the series UI tests. Every factory returns a fresh object. */

const stats = (episodeFileCount: number, episodeCount: number, sizeOnDisk: number, seasonCount = 1) => ({
  seasonCount,
  episodeFileCount,
  episodeCount,
  totalEpisodeCount: episodeCount,
  sizeOnDisk,
  percentOfEpisodes: episodeCount ? (episodeFileCount / episodeCount) * 100 : 0,
});

export function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    id: 1,
    title: 'Breaking Bad',
    sortTitle: 'breaking bad',
    status: 'ended',
    overview: 'A chemistry teacher turns to crime.',
    network: 'AMC',
    airTime: '21:00',
    images: [
      { coverType: 'poster', url: '', remoteUrl: 'https://img.example/bb-poster.jpg' },
      { coverType: 'fanart', url: '', remoteUrl: 'https://img.example/bb-fanart.jpg' },
    ],
    seasons: [
      { seasonNumber: 0, monitored: false, statistics: { ...stats(0, 0, 0), totalEpisodeCount: 1 } },
      { seasonNumber: 1, monitored: true, statistics: stats(1, 2, 1_500_000_000) },
      { seasonNumber: 2, monitored: true, statistics: stats(0, 1, 0) },
    ],
    year: 2008,
    path: '/tv/Breaking Bad (2008)',
    qualityProfileId: 1,
    seasonFolder: true,
    monitored: true,
    monitorNewItems: 'all',
    runtime: 47,
    tvdbId: 81189,
    tvMazeId: 169,
    imdbId: 'tt0903747',
    firstAired: '2008-01-20',
    seriesType: 'standard',
    cleanTitle: 'breakingbad',
    titleSlug: 'breaking-bad',
    rootFolderPath: '/tv',
    certification: null,
    genres: ['Drama', 'Crime'],
    tags: [],
    added: '2024-01-01T00:00:00Z',
    ratings: { votes: 100, value: 9.3 },
    statistics: stats(1, 3, 1_500_000_000, 2),
    ...overrides,
  };
}

/** A continuing series without any images (exercises the poster fallback). */
export function makeContinuingSeries(overrides: Partial<Series> = {}): Series {
  return makeSeries({
    id: 2,
    title: 'Andor',
    sortTitle: 'andor',
    status: 'continuing',
    network: 'Disney+',
    images: [],
    seasons: [{ seasonNumber: 1, monitored: true, statistics: stats(12, 12, 20_000_000_000) }],
    year: 2022,
    path: '/tv/Andor (2022)',
    tvdbId: 393189,
    tvMazeId: 41474,
    titleSlug: 'andor',
    cleanTitle: 'andor',
    genres: ['Science-Fiction'],
    added: '2024-02-01T00:00:00Z',
    statistics: stats(12, 12, 20_000_000_000, 1),
    ...overrides,
  });
}

export function makeLookup(overrides: Partial<SeriesLookup> = {}): SeriesLookup {
  const { id: _id, statistics: _s, ...rest } = makeSeries({ path: '', rootFolderPath: '' });
  return { ...rest, remotePoster: 'https://img.example/bb-poster.jpg', ...overrides };
}

export function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 101,
    seriesId: 1,
    tvMazeId: 1001,
    episodeFileId: 0,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Pilot',
    airDate: '2008-01-20',
    airDateUtc: '2008-01-21T02:00:00Z',
    overview: '',
    runtime: 58,
    hasFile: false,
    monitored: true,
    ...overrides,
  };
}

/** S01E01 downloaded, S01E02 missing, S02E01 unmonitored, S02E02 unaired. */
export function makeEpisodes(): Episode[] {
  return [
    makeEpisode({ id: 101, episodeNumber: 1, title: 'Pilot', episodeFileId: 501, hasFile: true }),
    makeEpisode({ id: 102, episodeNumber: 2, title: "Cat's in the Bag...", airDate: '2008-01-27', airDateUtc: '2008-01-28T02:00:00Z' }),
    makeEpisode({ id: 201, seasonNumber: 2, episodeNumber: 1, title: 'Seven Thirty-Seven', airDate: '2009-03-08', airDateUtc: '2009-03-09T02:00:00Z', monitored: false }),
    makeEpisode({ id: 202, seasonNumber: 2, episodeNumber: 2, title: 'Future Episode', airDate: '2999-01-01', airDateUtc: '2999-01-01T02:00:00Z' }),
  ];
}

export function makeEpisodeFile(overrides: Partial<EpisodeFile> = {}): EpisodeFile {
  return {
    id: 501,
    seriesId: 1,
    seasonNumber: 1,
    relativePath: 'Season 01/Breaking.Bad.S01E01.720p.HDTV.mkv',
    path: '/tv/Breaking Bad (2008)/Season 01/Breaking.Bad.S01E01.720p.HDTV.mkv',
    size: 1_500_000_000,
    dateAdded: '2024-01-02T00:00:00Z',
    quality: {
      quality: { id: 4, name: 'HDTV-720p', source: 'television', resolution: 720 },
      revision: { version: 1, real: 0, isRepack: false },
    } as EpisodeFile['quality'],
    ...overrides,
  };
}

export function makeRootFolder(overrides: Partial<RootFolder> = {}): RootFolder {
  return { id: 1, path: '/tv', accessible: true, freeSpace: 2 * 1024 ** 4, unmappedFolders: [], ...overrides };
}

export function makeQualityProfile(overrides: Partial<QualityProfile> = {}): QualityProfile {
  return { id: 1, name: 'HD-1080p', upgradeAllowed: true, cutoff: 3, items: [], ...overrides };
}

export function makeTag(overrides: Partial<Tag> = {}): Tag {
  return { id: 1, label: 'drama', ...overrides } as Tag;
}
