import type { Tile, TileKind, Town } from './types';

// Compact row form: [id, kind, x, y, next[]]. Grid is 20x12.
type Row = [string, TileKind, number, number, string[]];

const ROWS: Row[] = [
  // Main loop, clockwise from the start tile.
  ['start', 'start', 0, 0, ['m01']],
  ['m01', 'plain', 2, 0, ['m02']],
  ['m02', 'monster', 4, 0, ['m03']],
  ['m03', 'town', 6, 0, ['m04']],
  ['m04', 'event', 8, 0, ['m05']],
  ['m05', 'plain', 10, 0, ['m06', 'b01']], // branch point 1
  ['m06', 'monster', 12, 0, ['m07']],
  ['m07', 'shop', 14, 0, ['m08']],
  ['m08', 'heal', 16, 0, ['m09']],
  ['m09', 'plain', 18, 0, ['m10']],
  ['m10', 'town', 19, 2, ['m11']],
  ['m11', 'monster', 19, 4, ['m12']],
  ['m12', 'event', 19, 6, ['m13', 'c01']], // branch point 2
  ['m13', 'plain', 19, 8, ['m14']],
  ['m14', 'shop', 19, 10, ['m15']],
  ['m15', 'monster', 18, 11, ['m16']],
  ['m16', 'town', 16, 11, ['m17']],
  ['m17', 'heal', 14, 11, ['m18']],
  ['m18', 'plain', 12, 11, ['m19', 'd01']], // branch point 3
  ['m19', 'monster', 10, 11, ['m20']],
  ['m20', 'event', 8, 11, ['m21']],
  ['m21', 'town', 6, 11, ['m22']],
  ['m22', 'shop', 4, 11, ['m23']],
  ['m23', 'monster', 2, 11, ['m24']],
  ['m24', 'plain', 0, 9, ['m25']],
  ['m25', 'heal', 0, 7, ['m26']],
  ['m26', 'monster', 0, 5, ['m27']],
  ['m27', 'event', 0, 3, ['boss']],
  ['boss', 'boss', 0, 1, ['start']],
  // Branch 1: rejoins at m11.
  ['b01', 'monster', 10, 2, ['b02']],
  ['b02', 'event', 12, 2, ['b03']],
  ['b03', 'shop', 14, 3, ['b04']],
  ['b04', 'plain', 16, 4, ['m11']],
  // Branch 2: rejoins at m17.
  ['c01', 'monster', 17, 6, ['c02']],
  ['c02', 'town', 16, 7, ['c03']],
  ['c03', 'event', 15, 8, ['c04']],
  ['c04', 'plain', 14, 9, ['m17']],
  // Branch 3: rejoins at m21.
  ['d01', 'monster', 12, 9, ['d02']],
  ['d02', 'event', 10, 8, ['d03']],
  ['d03', 'heal', 8, 8, ['d04']],
  ['d04', 'monster', 6, 8, ['m21']],
];

export function buildDefaultMap(): Record<string, Tile> {
  const tiles: Record<string, Tile> = {};
  for (const [id, kind, x, y, next] of ROWS) {
    tiles[id] = { id, kind, x, y, next: [...next] };
  }
  return tiles;
}

/** Fresh unowned level-1 town records for every town tile. */
export function buildDefaultTowns(
  tiles: Record<string, Tile>,
): Record<string, Town> {
  const towns: Record<string, Town> = {};
  for (const tile of Object.values(tiles)) {
    if (tile.kind === 'town') {
      towns[tile.id] = { tileId: tile.id, ownerId: null, level: 1, income: 20 };
    }
  }
  return towns;
}

export function validateMap(tiles: Record<string, Tile>): string[] {
  const problems: string[] = [];
  const all = Object.values(tiles);
  const starts = all.filter((t) => t.kind === 'start');
  const bosses = all.filter((t) => t.kind === 'boss');
  if (!tiles['start'] || tiles['start'].kind !== 'start') {
    problems.push("missing start tile 'start'");
  }
  if (!tiles['boss'] || tiles['boss'].kind !== 'boss') {
    problems.push("missing boss tile 'boss'");
  }
  if (starts.length > 1) problems.push('more than one start tile');
  if (bosses.length > 1) problems.push('more than one boss tile');

  for (const [key, tile] of Object.entries(tiles)) {
    if (tile.id !== key) problems.push(`tile key ${key} does not match id ${tile.id}`);
    if (tile.next.length === 0) problems.push(`tile ${key} has no next tiles`);
    for (const n of tile.next) {
      if (!tiles[n]) problems.push(`tile ${key} references unknown next id ${n}`);
    }
  }

  if (tiles['start']) {
    const seen = new Set<string>(['start']);
    const queue = ['start'];
    while (queue.length > 0) {
      const cur = tiles[queue.shift() as string];
      if (!cur) continue;
      for (const n of cur.next) {
        if (tiles[n] && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    for (const id of Object.keys(tiles)) {
      if (!seen.has(id)) problems.push(`tile ${id} is unreachable from start`);
    }
  }
  return problems;
}
