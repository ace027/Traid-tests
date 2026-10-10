import type { ClassId, Stats } from '../types';

export interface ClassDef {
  name: string;
  base: Stats;
  /** Stat gains applied on every level up. Integers only. */
  growth: Partial<Stats>;
  skill: { name: string; description: string };
}

export const CLASSES: Record<ClassId, ClassDef> = {
  knight: {
    name: 'Bulwark Knight',
    base: { hp: 56, maxHp: 56, atk: 11, def: 7, spd: 4, luck: 4 },
    growth: { maxHp: 8, hp: 8, atk: 2, def: 2, spd: 1, luck: 1 },
    skill: {
      name: 'Sundering Blow',
      description: 'A heavy strike dealing 1.8x attack damage.',
    },
  },
  mage: {
    name: 'Ember Scholar',
    base: { hp: 42, maxHp: 42, atk: 13, def: 3, spd: 6, luck: 6 },
    growth: { maxHp: 5, hp: 5, atk: 3, def: 1, spd: 1, luck: 1 },
    skill: {
      name: 'Cinder Burst',
      description: 'A burst of flame that ignores the target\'s defense.',
    },
  },
  rogue: {
    name: 'Gutter Fox',
    base: { hp: 48, maxHp: 48, atk: 10, def: 4, spd: 10, luck: 12 },
    growth: { maxHp: 6, hp: 6, atk: 2, def: 1, spd: 2, luck: 2 },
    skill: {
      name: 'Light Fingers',
      description:
        'Strike while pilfering: steals 10% gold from a rival, or doubles the spoils of a slain monster.',
    },
  },
  cleric: {
    name: 'Lantern Warden',
    base: { hp: 54, maxHp: 54, atk: 9, def: 6, spd: 5, luck: 8 },
    growth: { maxHp: 7, hp: 7, atk: 1, def: 2, spd: 1, luck: 2 },
    skill: {
      name: 'Kindled Prayer',
      description: 'Restores 35% of maximum HP.',
    },
  },
};
