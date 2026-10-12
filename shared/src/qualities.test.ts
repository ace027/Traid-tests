import { describe, expect, it } from 'vitest';
import { QUALITIES, defaultQualityDefinitions, defaultQualityProfiles } from './qualities.js';
import { qualityProfileSchema } from './schemas.js';

describe('qualities', () => {
  it('has unique ids and names', () => {
    expect(new Set(QUALITIES.map((q) => q.id)).size).toBe(QUALITIES.length);
    expect(new Set(QUALITIES.map((q) => q.name)).size).toBe(QUALITIES.length);
  });

  it('has a definition per quality', () => {
    expect(defaultQualityDefinitions).toHaveLength(QUALITIES.length);
  });

  it('every default profile cutoff is allowed in that profile', () => {
    for (const p of defaultQualityProfiles) {
      const item = p.items.find((i) => i.quality.id === p.cutoff);
      expect(item?.allowed, p.name).toBe(true);
      expect(qualityProfileSchema.safeParse({ id: 1, ...p }).success, p.name).toBe(true);
    }
  });

  it('schema rejects a profile whose cutoff is not allowed', () => {
    const p = defaultQualityProfiles[1]!;
    const bad = { id: 1, ...p, cutoff: 19 };
    expect(qualityProfileSchema.safeParse(bad).success).toBe(false);
  });
});
