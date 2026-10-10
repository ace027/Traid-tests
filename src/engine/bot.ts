import type { Action, GameState, Player } from './types';
import { createRng, nextFloat } from './rng';
import { CAPTURE_COST_PER_LEVEL, MAX_TOWN_LEVEL, UPGRADE_COST_PER_LEVEL } from './movement';
import { ITEMS, shopStock } from './data/items';

/** Local generator seeded from the state; never advances state.rngState. */
function localRandom(state: GameState, salt: number): () => number {
  let r = createRng((state.rngState ^ Math.imul(salt + 1, 0x9e3779b1) ^ state.log.length) | 0);
  return () => {
    const [v, n] = nextFloat(r);
    r = n;
    return v;
  };
}

function weaponAtk(id: string | undefined): number {
  return id ? ITEMS[id]?.mods.atk ?? 0 : 0;
}

function bestOwnedWeapon(p: Player): string | undefined {
  let best: string | undefined;
  for (const id of p.inventory) {
    const it = ITEMS[id];
    if (it?.slot === 'weapon' && weaponAtk(id) > weaponAtk(best)) best = id;
  }
  return best;
}

export function chooseBotAction(state: GameState, playerId: string): Action {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player ${playerId}`);
  const rand = localRandom(state, state.turnIndex * 31 + state.pendingMoves);
  const hpFrac = player.stats.hp / player.stats.maxHp;

  switch (state.phase) {
    case 'roll': {
      const heal = player.inventory.find((id) => ITEMS[id]?.effect === 'heal');
      if (heal && hpFrac < 0.5) return { type: 'useItem', itemId: heal };
      return { type: 'roll' };
    }
    case 'choose-path': {
      const steps = state.tiles[player.tileId]?.next ?? [];
      if (steps.length === 0) throw new Error(`no path from tile ${player.tileId}`);
      return { type: 'choosePath', tileId: steps[Math.floor(rand() * steps.length)] };
    }
    case 'battle': {
      if (hpFrac < 0.3) return { type: 'battleAction', action: 'flee' };
      if (player.classId === 'cleric' && hpFrac < 0.5) {
        return { type: 'battleAction', action: 'skill' };
      }
      return { type: 'battleAction', action: 'attack' };
    }
    case 'shop': {
      const owned = bestOwnedWeapon(player);
      const equipped = player.equipment.weapon;
      if (owned && weaponAtk(owned) > weaponAtk(equipped)) {
        return { type: 'equip', itemId: owned };
      }
      const currentBest = Math.max(weaponAtk(owned), weaponAtk(equipped));
      let pick: string | undefined;
      for (const id of shopStock(player.tileId)) {
        const it = ITEMS[id];
        if (it?.slot !== 'weapon' || it.price > player.gold) continue;
        if (weaponAtk(id) > currentBest && weaponAtk(id) > weaponAtk(pick)) pick = id;
      }
      if (pick) return { type: 'buy', itemId: pick };
      return { type: 'leaveShop' };
    }
    case 'town': {
      const town = state.towns[player.tileId];
      if (town) {
        if (town.ownerId === player.id) {
          const cost = UPGRADE_COST_PER_LEVEL * town.level;
          if (town.level < MAX_TOWN_LEVEL && player.gold >= cost + 100) return { type: 'upgradeTown' };
        } else if (town.ownerId !== null) {
          const cost = CAPTURE_COST_PER_LEVEL * town.level;
          if (player.gold >= cost + 150) return { type: 'captureTown' };
        }
      }
      return { type: 'leaveTown' };
    }
    default:
      return { type: 'endTurn' };
  }
}
