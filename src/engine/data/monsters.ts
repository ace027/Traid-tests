import type { Monster, Stats } from '../types';

export const BOSS_ID = 'boss-sovereign-of-ash';

function s(hp: number, atk: number, def: number, spd: number, luck: number): Stats {
  return { hp, maxHp: hp, atk, def, spd, luck };
}

export const MONSTERS: Monster[] = [
  // Tier 1
  { id: 'moss-slime', name: 'Moss Slime', tier: 1, stats: s(20, 8, 2, 3, 2), goldReward: 15, drops: ['healing-draught'] },
  { id: 'burrow-rat', name: 'Burrow Rat', tier: 1, stats: s(24, 10, 3, 8, 5), goldReward: 20, drops: ['trail-ration', 'lucky-pebble'] },
  { id: 'thornback-boar', name: 'Thornback Boar', tier: 1, stats: s(30, 22, 6, 4, 3), goldReward: 30, drops: ['quilted-vest', 'healing-draught'] },
  { id: 'ember-wisp', name: 'Ember Wisp', tier: 1, stats: s(22, 15, 1, 9, 10), goldReward: 25, drops: ['fury-tonic'] },
  // Tier 2
  { id: 'bog-lurker', name: 'Bog Lurker', tier: 2, stats: s(55, 16, 6, 5, 4), goldReward: 55, drops: ['oak-cudgel', 'healing-draught'] },
  { id: 'gravel-golem', name: 'Gravel Golem', tier: 2, stats: s(70, 15, 10, 2, 2), goldReward: 65, drops: ['scaleweave-mail'] },
  { id: 'dusk-harpy', name: 'Dusk Harpy', tier: 2, stats: s(50, 19, 5, 12, 8), goldReward: 60, drops: ['swiftfeather', 'warp-scroll'] },
  // Tier 3
  { id: 'cinder-drake', name: 'Cinder Drake', tier: 3, stats: s(110, 26, 12, 8, 6), goldReward: 140, drops: ['ironbite-sword', 'fury-tonic'] },
  { id: 'hollow-knight-wraith', name: 'Hollow Wraith', tier: 3, stats: s(90, 30, 8, 11, 10), goldReward: 130, drops: ['heartstone'] },
  { id: 'frostfang-troll', name: 'Frostfang Troll', tier: 3, stats: s(120, 24, 14, 4, 4), goldReward: 150, drops: ['bastion-plate', 'healing-draught'] },
  // Tier 4 (boss)
  { id: BOSS_ID, name: 'Sovereign of Ash', tier: 4, stats: s(600, 42, 22, 9, 10), goldReward: 1000, drops: ['runed-glaive', 'aegis-of-dawn'] },
];

export function monstersForTier(tier: 1 | 2 | 3 | 4): Monster[] {
  return MONSTERS.filter((m) => m.tier === tier);
}

export function getMonster(id: string): Monster | undefined {
  return MONSTERS.find((m) => m.id === id);
}

/** XP awarded for defeating a monster (Monster has no xp field). */
export function monsterXp(m: Monster): number {
  return Math.round(m.stats.maxHp * 0.6 + m.stats.atk * 1.5 + m.tier * 5);
}
