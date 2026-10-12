export type QualitySource =
  | 'television'
  | 'web'
  | 'webRip'
  | 'dvd'
  | 'bluray'
  | 'blurayRaw'
  | 'unknown';

export interface Quality {
  id: number;
  name: string;
  source: QualitySource;
  resolution: number;
}

export const QUALITIES: readonly Quality[] = [
  { id: 0, name: 'Unknown', source: 'unknown', resolution: 0 },
  { id: 1, name: 'SDTV', source: 'television', resolution: 480 },
  { id: 2, name: 'DVD', source: 'dvd', resolution: 480 },
  { id: 3, name: 'WEBDL-1080p', source: 'web', resolution: 1080 },
  { id: 4, name: 'HDTV-720p', source: 'television', resolution: 720 },
  { id: 5, name: 'WEBDL-720p', source: 'web', resolution: 720 },
  { id: 6, name: 'Bluray-720p', source: 'bluray', resolution: 720 },
  { id: 7, name: 'Bluray-1080p', source: 'bluray', resolution: 1080 },
  { id: 8, name: 'WEBDL-480p', source: 'web', resolution: 480 },
  { id: 9, name: 'HDTV-1080p', source: 'television', resolution: 1080 },
  { id: 10, name: 'Raw-HD', source: 'blurayRaw', resolution: 1080 },
  { id: 12, name: 'WEBRip-480p', source: 'webRip', resolution: 480 },
  { id: 13, name: 'Bluray-480p', source: 'bluray', resolution: 480 },
  { id: 14, name: 'WEBRip-720p', source: 'webRip', resolution: 720 },
  { id: 15, name: 'WEBRip-1080p', source: 'webRip', resolution: 1080 },
  { id: 16, name: 'HDTV-2160p', source: 'television', resolution: 2160 },
  { id: 17, name: 'WEBRip-2160p', source: 'webRip', resolution: 2160 },
  { id: 18, name: 'WEBDL-2160p', source: 'web', resolution: 2160 },
  { id: 19, name: 'Bluray-2160p', source: 'bluray', resolution: 2160 },
  { id: 20, name: 'Bluray-1080p Remux', source: 'bluray', resolution: 1080 },
  { id: 21, name: 'Bluray-2160p Remux', source: 'bluray', resolution: 2160 },
];

export interface DefaultQualityDefinition {
  quality: Quality;
  title: string;
  weight: number;
  /** MB per minute. */
  minSize: number;
  maxSize: number | null;
  preferredSize: number | null;
}

// [id, min, max, preferred] in MB per minute (Sonarr defaults, approximated).
const SIZE_LIMITS: Record<number, [number, number | null, number | null]> = {
  0: [1, 100, 95],
  1: [2, 100, 95],
  2: [2, 100, 95],
  3: [4, 130, 95],
  4: [3, 125, 95],
  5: [3, 130, 95],
  6: [4, 130, 95],
  7: [4.5, 130, 95],
  8: [2, 100, 95],
  9: [4, 125, 95],
  10: [4, 125, 95],
  12: [2, 100, 95],
  13: [2, 100, 95],
  14: [3, 130, 95],
  15: [4, 130, 95],
  16: [25, 200, 95],
  17: [25, 200, 95],
  18: [25, 200, 95],
  19: [35, 400, 95],
  20: [35, 400, 95],
  21: [60, null, null],
};

export const defaultQualityDefinitions: readonly DefaultQualityDefinition[] = QUALITIES.map(
  (quality, index) => {
    const [minSize, maxSize, preferredSize] = SIZE_LIMITS[quality.id] ?? [1, 100, 95];
    return { quality, title: quality.name, weight: index + 1, minSize, maxSize, preferredSize };
  },
);

export interface DefaultQualityProfile {
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
  items: { quality: Quality; allowed: boolean }[];
}

const byId = (id: number): Quality => {
  const q = QUALITIES.find((x) => x.id === id);
  if (!q) throw new Error(`Unknown quality id ${id}`);
  return q;
};

/** Build items for every quality ordered lowest to highest, allowing only `allowedIds`. */
function buildItems(allowedIds: number[]): DefaultQualityProfile['items'] {
  const allowed = new Set(allowedIds);
  return QUALITIES.map((quality) => ({ quality, allowed: allowed.has(quality.id) }));
}

function profile(name: string, cutoff: number, allowedIds: number[]): DefaultQualityProfile {
  byId(cutoff);
  return { name, upgradeAllowed: true, cutoff, items: buildItems(allowedIds) };
}

export const defaultQualityProfiles: readonly DefaultQualityProfile[] = [
  profile('Any', 1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
  profile('SD', 2, [1, 2, 8, 12, 13]),
  profile('HD-720p', 4, [4, 5, 6, 14]),
  profile('HD-1080p', 9, [3, 7, 9, 15, 20]),
  profile('Ultra-HD', 16, [16, 17, 18, 19, 21]),
  profile('HD - 720p/1080p', 4, [4, 5, 6, 14, 3, 7, 9, 15, 20]),
];
