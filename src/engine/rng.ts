// Pure mulberry32 RNG over a numeric state.

export function createRng(seed: number): number {
  return seed | 0;
}

export function nextFloat(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

export function nextInt(
  state: number,
  min: number,
  maxInclusive: number,
): [number, number] {
  const [f, next] = nextFloat(state);
  if (min === maxInclusive) return [min, next];
  return [min + Math.floor(f * (maxInclusive - min + 1)), next];
}
