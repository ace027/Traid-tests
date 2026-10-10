import { describe, expect, it } from 'vitest';
import { buildDefaultMap, buildDefaultTowns, validateMap } from '../../src/engine/map';

describe('default map', () => {
  const tiles = buildDefaultMap();
  const all = Object.values(tiles);

  it('has zero problems', () => {
    expect(validateMap(tiles)).toEqual([]);
  });

  it('has the required composition', () => {
    expect(all.length).toBeGreaterThanOrEqual(38);
    expect(all.filter((t) => t.kind === 'start')).toHaveLength(1);
    expect(all.filter((t) => t.kind === 'boss')).toHaveLength(1);
    expect(all.filter((t) => t.kind === 'town').length).toBeGreaterThanOrEqual(4);
    expect(all.filter((t) => t.kind === 'shop').length).toBeGreaterThanOrEqual(3);
    expect(all.filter((t) => t.next.length > 1).length).toBeGreaterThanOrEqual(3);
    expect(all.every((t) => t.next.length >= 1)).toBe(true);
    expect(tiles['boss'].next).toEqual(['start']);
  });

  it('stays on the 20x12 grid without overlap', () => {
    const keys = new Set(all.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(all.length);
    expect(all.every((t) => t.x >= 0 && t.x < 20 && t.y >= 0 && t.y < 12)).toBe(true);
  });

  it('reaches the boss from start', () => {
    const seen = new Set<string>(['start']);
    const q = ['start'];
    while (q.length) for (const n of tiles[q.shift()!].next) if (!seen.has(n)) { seen.add(n); q.push(n); }
    expect(seen.has('boss')).toBe(true);
  });

  it('reports a deleted tile referenced by next', () => {
    const broken = buildDefaultMap();
    delete broken['m05'];
    const problems = validateMap(broken);
    expect(problems.some((p) => p.includes('unknown next id m05'))).toBe(true);
  });

  it('reports missing start/boss and unreachable tiles', () => {
    const broken = buildDefaultMap();
    broken['m01'].next = ['m01'];
    expect(validateMap(broken).some((p) => p.includes('unreachable'))).toBe(true);
    delete broken['start'];
    delete broken['boss'];
    const problems = validateMap(broken);
    expect(problems.some((p) => p.includes('missing start'))).toBe(true);
    expect(problems.some((p) => p.includes('missing boss'))).toBe(true);
  });

  it('builds a town record per town tile', () => {
    const towns = buildDefaultTowns(tiles);
    expect(Object.keys(towns).length).toBe(all.filter((t) => t.kind === 'town').length);
    expect(Object.values(towns).every((t) => t.ownerId === null && t.level === 1)).toBe(true);
  });
});
