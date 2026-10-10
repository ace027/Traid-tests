import type { GameState, Player, Slot, Stats } from './types';
import { ITEMS, shopStock } from './data/items';
import { CLASSES } from './data/classes';

export interface InventoryResult {
  state: GameState;
  error?: string;
}

export const SELL_RATE = 0.5;
export const ATK_BOOST = 4;
export const ATK_BOOST_CAP = 12;

const STAT_KEYS: (keyof Stats)[] = ['hp', 'maxHp', 'atk', 'def', 'spd', 'luck'];

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function fail(state: GameState, error: string): InventoryResult {
  return { state, error };
}

function findPlayer(state: GameState, playerId: string): Player | undefined {
  return state.players.find((p) => p.id === playerId);
}

/** Add (sign=1) or remove (sign=-1) an item's stat mods. hp is clamped to maxHp. */
function applyMods(player: Player, mods: Partial<Stats>, sign: 1 | -1): void {
  for (const k of STAT_KEYS) {
    if (k === 'hp') continue;
    const v = mods[k];
    if (v) player.stats[k] += v * sign;
  }
  player.stats.maxHp = Math.max(1, player.stats.maxHp);
  player.stats.hp = Math.min(player.stats.hp, player.stats.maxHp);
}

/** Total permanent atk gained from boost consumables (derived; types are fixed). */
export function atkBoostTotal(player: Player): number {
  const cls = CLASSES[player.classId];
  let expected = cls.base.atk + (cls.growth.atk ?? 0) * (player.level - 1);
  for (const id of Object.values(player.equipment)) {
    if (id) expected += ITEMS[id]?.mods.atk ?? 0;
  }
  return player.stats.atk - expected;
}

/** Remove one copy of itemId from inventory; unequip if no copy remains. */
function removeFromInventory(player: Player, itemId: string): void {
  const idx = player.inventory.indexOf(itemId);
  if (idx >= 0) player.inventory.splice(idx, 1);
  if (player.inventory.includes(itemId)) return;
  for (const slot of Object.keys(player.equipment) as Slot[]) {
    if (player.equipment[slot] === itemId) {
      applyMods(player, ITEMS[itemId].mods, -1);
      delete player.equipment[slot];
    }
  }
}

function currentPlayerCheck(state: GameState, playerId: string): Player | string {
  const p = findPlayer(state, playerId);
  if (!p) return `Unknown player ${playerId}`;
  if (p.defeated) return `${p.name} is defeated`;
  return p;
}

export function buyItem(state: GameState, playerId: string, itemId: string): InventoryResult {
  if (state.phase !== 'shop') return fail(state, 'Not in a shop');
  const chk = currentPlayerCheck(state, playerId);
  if (typeof chk === 'string') return fail(state, chk);
  const item = ITEMS[itemId];
  if (!item) return fail(state, `Unknown item ${itemId}`);
  if (!shopStock(chk.tileId).includes(itemId)) return fail(state, `${item.name} is not sold here`);
  if (chk.gold < item.price) return fail(state, `Not enough gold for ${item.name}`);
  const next = clone(state);
  const p = findPlayer(next, playerId)!;
  p.gold -= item.price;
  p.inventory.push(itemId);
  next.log.push(`${p.name} bought ${item.name} for ${item.price} gold`);
  return { state: next };
}

export function sellPrice(itemId: string): number {
  const item = ITEMS[itemId];
  return item ? Math.floor(item.price * SELL_RATE) : 0;
}

export function sellItem(state: GameState, playerId: string, itemId: string): InventoryResult {
  if (state.phase !== 'shop') return fail(state, 'Not in a shop');
  const chk = currentPlayerCheck(state, playerId);
  if (typeof chk === 'string') return fail(state, chk);
  const item = ITEMS[itemId];
  if (!item) return fail(state, `Unknown item ${itemId}`);
  if (!chk.inventory.includes(itemId)) return fail(state, `${item.name} is not in inventory`);
  const next = clone(state);
  const p = findPlayer(next, playerId)!;
  removeFromInventory(p, itemId);
  const price = sellPrice(itemId);
  p.gold += price;
  next.log.push(`${p.name} sold ${item.name} for ${price} gold`);
  return { state: next };
}

export function equipItem(state: GameState, playerId: string, itemId: string): InventoryResult {
  if (state.phase === 'battle' || state.phase === 'game-over') {
    return fail(state, 'Cannot change equipment now');
  }
  const chk = currentPlayerCheck(state, playerId);
  if (typeof chk === 'string') return fail(state, chk);
  const item = ITEMS[itemId];
  if (!item) return fail(state, `Unknown item ${itemId}`);
  if (item.kind !== 'equipment' || !item.slot) return fail(state, `${item.name} cannot be equipped`);
  if (!chk.inventory.includes(itemId)) return fail(state, `${item.name} is not in inventory`);
  if (chk.equipment[item.slot] === itemId) return fail(state, `${item.name} is already equipped`);
  const next = clone(state);
  const p = findPlayer(next, playerId)!;
  const prev = p.equipment[item.slot];
  if (prev) applyMods(p, ITEMS[prev].mods, -1);
  applyMods(p, item.mods, 1);
  p.equipment[item.slot] = itemId;
  next.log.push(`${p.name} equipped ${item.name}`);
  return { state: next };
}

function startTileId(state: GameState): string {
  const t = Object.values(state.tiles).find((tile) => tile.kind === 'start');
  return t ? t.id : 'start';
}

/**
 * Apply a consumable to a player inside an already-cloned state (mutates `next`).
 * Returns an error string on rejection. Exposed for combat's 'item' action.
 */
export function applyConsumable(next: GameState, playerId: string, itemId: string): string | undefined {
  const p = findPlayer(next, playerId);
  if (!p) return `Unknown player ${playerId}`;
  if (p.defeated) return `${p.name} is defeated`;
  const item = ITEMS[itemId];
  if (!item) return `Unknown item ${itemId}`;
  if (item.kind !== 'consumable') return `${item.name} is not a consumable`;
  if (!p.inventory.includes(itemId)) return `${item.name} is not in inventory`;
  switch (item.effect) {
    case 'heal': {
      if (p.stats.hp >= p.stats.maxHp) return `${p.name} is already at full HP`;
      const amount = item.mods.hp ?? Math.floor(p.stats.maxHp * 0.5);
      const healed = Math.min(amount, p.stats.maxHp - p.stats.hp);
      p.stats.hp += healed;
      next.log.push(`${p.name} used ${item.name} and recovered ${healed} HP`);
      break;
    }
    case 'boost-atk': {
      const boost = item.mods.atk ?? ATK_BOOST;
      const room = ATK_BOOST_CAP - atkBoostTotal(p);
      if (room <= 0) return `${p.name} cannot grow any stronger from tonics`;
      const gain = Math.min(boost, room);
      p.stats.atk += gain;
      next.log.push(`${p.name} used ${item.name}: ATK +${gain}`);
      break;
    }
    case 'warp': {
      if (next.phase === 'battle') return 'Cannot warp during battle';
      p.tileId = startTileId(next);
      next.log.push(`${p.name} used ${item.name} and warped to the start`);
      break;
    }
    default:
      return `${item.name} has no effect`;
  }
  removeFromInventory(p, itemId);
  return undefined;
}

export function useItem(state: GameState, playerId: string, itemId: string): InventoryResult {
  if (state.phase === 'game-over') return fail(state, 'The game is over');
  const next = clone(state);
  const err = applyConsumable(next, playerId, itemId);
  if (err) return fail(state, err);
  return { state: next };
}
