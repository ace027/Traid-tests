import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt } from '../../src/engine';

function seq(seed: number, n: number): number[] {
  let s = createRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [v, next] = nextFloat(s);
    out.push(v);
    s = next;
  }
  return out;
}

describe('rng', () => {
  it('same seed gives same sequence', () => {
    expect(seq(42, 20)).toEqual(seq(42, 20));
  });

  it('different seeds differ', () => {
    expect(seq(1, 10)).not.toEqual(seq(2, 10));
  });

  it('seed 0 produces varied output', () => {
    expect(new Set(seq(0, 10)).size).toBeGreaterThan(1);
  });

  it('floats are in [0,1)', () => {
    for (const v of seq(7, 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt stays within inclusive bounds', () => {
    let s = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const [v, next] = nextInt(s, 1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
      s = next;
    }
    expect(seen.size).toBe(6);
  });

  it('nextInt with min==max returns min', () => {
    const [v] = nextInt(createRng(5), 3, 3);
    expect(v).toBe(3);
  });
});
