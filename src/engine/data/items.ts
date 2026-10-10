import type { Item } from '../types';

const list: Item[] = [
  // Weapons
  { id: 'oak-cudgel', name: 'Oak Cudgel', kind: 'equipment', slot: 'weapon', price: 40, mods: { atk: 3 } },
  { id: 'ironbite-sword', name: 'Ironbite Sword', kind: 'equipment', slot: 'weapon', price: 120, mods: { atk: 6 } },
  { id: 'starfall-blade', name: 'Starfall Blade', kind: 'equipment', slot: 'weapon', price: 260, mods: { atk: 10, luck: 2 } },
  { id: 'runed-glaive', name: 'Runed Glaive', kind: 'equipment', slot: 'weapon', price: 400, mods: { atk: 14, spd: -1 } },
  // Armors
  { id: 'quilted-vest', name: 'Quilted Vest', kind: 'equipment', slot: 'armor', price: 35, mods: { def: 2 } },
  { id: 'scaleweave-mail', name: 'Scaleweave Mail', kind: 'equipment', slot: 'armor', price: 110, mods: { def: 5, maxHp: 5 } },
  { id: 'bastion-plate', name: 'Bastion Plate', kind: 'equipment', slot: 'armor', price: 250, mods: { def: 9, maxHp: 10, spd: -1 } },
  { id: 'aegis-of-dawn', name: 'Aegis of Dawn', kind: 'equipment', slot: 'armor', price: 390, mods: { def: 12, maxHp: 20 } },
  // Charms
  { id: 'lucky-pebble', name: 'Lucky Pebble', kind: 'equipment', slot: 'charm', price: 50, mods: { luck: 5 } },
  { id: 'swiftfeather', name: 'Swiftfeather', kind: 'equipment', slot: 'charm', price: 90, mods: { spd: 4 } },
  { id: 'heartstone', name: 'Heartstone', kind: 'equipment', slot: 'charm', price: 150, mods: { maxHp: 15 } },
  // Consumables (heal with mods.hp heals that flat amount; without it heals 50% maxHp)
  { id: 'healing-draught', name: 'Healing Draught', kind: 'consumable', price: 30, mods: {}, effect: 'heal' },
  { id: 'trail-ration', name: 'Trail Ration', kind: 'consumable', price: 30, mods: { hp: 15 }, effect: 'heal' },
  { id: 'fury-tonic', name: 'Fury Tonic', kind: 'consumable', price: 60, mods: { atk: 4 }, effect: 'boost-atk' },
  { id: 'warp-scroll', name: 'Warp Scroll', kind: 'consumable', price: 80, mods: {}, effect: 'warp' },
];

export const ITEMS: Record<string, Item> = Object.fromEntries(
  list.map((i) => [i.id, i]),
);

const CONSUMABLES = list.filter((i) => i.kind === 'consumable').map((i) => i.id);
const EQUIPMENT = list.filter((i) => i.kind === 'equipment').map((i) => i.id);

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic stock for a shop tile: every consumable plus 6 of the 11
 * equipment pieces, rotated by a hash of the tile id.
 */
export function shopStock(tileId: string): string[] {
  const offset = hash(tileId) % EQUIPMENT.length;
  const gear: string[] = [];
  for (let i = 0; i < 6; i++) gear.push(EQUIPMENT[(offset + i * 2) % EQUIPMENT.length]);
  return [...CONSUMABLES, ...gear];
}
