import { describe, expect, it } from 'vitest';
import type { GameState, Player } from '../../src/engine';
import { CLASSES } from '../../src/engine/data/classes';
import { ITEMS, shopStock } from '../../src/engine/data/items';
import {
  ATK_BOOST_CAP,
  buyItem,
  equipItem,
  sellItem,
  useItem,
} from '../../src/engine/inventory';

const SHOP_TILE = 'shop-1';

function makePlayer(over: Partial<Player> = {}): Player {
  return {
    id: 'a',
    name: 'A',
    classId: 'knight',
    stats: { ...CLASSES.knight.base },
    gold: 500,
    tileId: SHOP_TILE,
    inventory: [],
    equipment: {},
    level: 1,
    xp: 0,
    defeated: false,
    ...over,
  };
}

function makeState(player: Player, phase: GameState['phase'] = 'shop'): GameState {
  return {
    seed: 1,
    rngState: 1,
    players: [player],
    turnIndex: 0,
    day: 1,
    week: 1,
    phase,
    tiles: {
      'tile-start': { id: 'tile-start', kind: 'start', x: 0, y: 0, next: [] },
      [SHOP_TILE]: { id: SHOP_TILE, kind: 'shop', x: 1, y: 0, next: [] },
    },
    towns: {},
    pendingMoves: 0,
    battle: null,
    log: [],
    winnerId: null,
  };
}

const pl = (s: GameState) => s.players[0];
const stock = shopStock(SHOP_TILE);
const stockedWeapons = stock.filter((id) => ITEMS[id].slot === 'weapon');

describe('shopStock', () => {
  it('is deterministic and includes all consumables', () => {
    expect(shopStock(SHOP_TILE)).toEqual(stock);
    for (const id of ['healing-draught', 'fury-tonic', 'warp-scroll']) expect(stock).toContain(id);
  });
});

describe('buyItem', () => {
  it('buys with exact gold', () => {
    const price = ITEMS['healing-draught'].price;
    const s0 = makeState(makePlayer({ gold: price }));
    const snapshot = JSON.stringify(s0);
    const { state, error } = buyItem(s0, 'a', 'healing-draught');
    expect(error).toBeUndefined();
    expect(pl(state).gold).toBe(0);
    expect(pl(state).inventory).toEqual(['healing-draught']);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
  it('fails with insufficient gold', () => {
    const s0 = makeState(makePlayer({ gold: 29 }));
    const r = buyItem(s0, 'a', 'healing-draught');
    expect(r.error).toMatch(/gold/i);
    expect(r.state).toBe(s0);
  });
  it('fails outside the shop phase', () => {
    expect(buyItem(makeState(makePlayer(), 'roll'), 'a', 'healing-draught').error).toMatch(/shop/i);
  });
  it('fails for unknown or unstocked items', () => {
    expect(buyItem(makeState(makePlayer()), 'a', 'nope').error).toMatch(/unknown/i);
    const missing = Object.keys(ITEMS).find((id) => !stock.includes(id))!;
    expect(buyItem(makeState(makePlayer()), 'a', missing).error).toMatch(/not sold/i);
  });
});

describe('sellItem', () => {
  it('sells for 50% of the price', () => {
    const s0 = makeState(makePlayer({ gold: 0, inventory: ['fury-tonic'] }));
    const { state } = sellItem(s0, 'a', 'fury-tonic');
    expect(pl(state).gold).toBe(30);
    expect(pl(state).inventory).toEqual([]);
  });
  it('selling an equipped item unequips it and removes its mods', () => {
    let s = makeState(makePlayer({ inventory: ['ironbite-sword'] }));
    s = equipItem(s, 'a', 'ironbite-sword').state;
    expect(pl(s).stats.atk).toBe(CLASSES.knight.base.atk + 6);
    const { state } = sellItem(s, 'a', 'ironbite-sword');
    expect(pl(state).equipment.weapon).toBeUndefined();
    expect(pl(state).stats.atk).toBe(CLASSES.knight.base.atk);
  });
  it('fails when the item is not owned', () => {
    expect(sellItem(makeState(makePlayer()), 'a', 'fury-tonic').error).toMatch(/inventory/i);
  });
});

describe('equipItem', () => {
  it('replaces the slot and swaps mods', () => {
    let s = makeState(makePlayer({ inventory: ['oak-cudgel', 'runed-glaive'] }), 'roll');
    s = equipItem(s, 'a', 'oak-cudgel').state;
    expect(pl(s).stats.atk).toBe(CLASSES.knight.base.atk + 3);
    s = equipItem(s, 'a', 'runed-glaive').state;
    expect(pl(s).equipment.weapon).toBe('runed-glaive');
    expect(pl(s).stats.atk).toBe(CLASSES.knight.base.atk + 14);
    expect(pl(s).stats.spd).toBe(CLASSES.knight.base.spd - 1);
  });
  it('clamps hp when a maxHp item is removed', () => {
    let s = makeState(makePlayer({ inventory: ['heartstone', 'lucky-pebble'] }), 'roll');
    s = equipItem(s, 'a', 'heartstone').state;
    pl(s).stats.hp = pl(s).stats.maxHp;
    s = equipItem(s, 'a', 'lucky-pebble').state;
    expect(pl(s).stats.maxHp).toBe(CLASSES.knight.base.maxHp);
    expect(pl(s).stats.hp).toBe(CLASSES.knight.base.maxHp);
  });
  it('rejects consumables and missing items', () => {
    const s = makeState(makePlayer({ inventory: ['fury-tonic'] }));
    expect(equipItem(s, 'a', 'fury-tonic').error).toBeDefined();
    expect(equipItem(s, 'a', stockedWeapons[0]).error).toMatch(/inventory/i);
  });
});

describe('useItem', () => {
  it('heal potion restores 50% max hp', () => {
    const s0 = makeState(makePlayer({ inventory: ['healing-draught'], stats: { ...CLASSES.knight.base, hp: 10 } }));
    const { state, error } = useItem(s0, 'a', 'healing-draught');
    expect(error).toBeUndefined();
    expect(pl(state).stats.hp).toBe(10 + Math.floor(CLASSES.knight.base.maxHp / 2));
    expect(pl(state).inventory).toEqual([]);
  });
  it('rejects heal at full hp', () => {
    const s0 = makeState(makePlayer({ inventory: ['healing-draught'] }));
    const r = useItem(s0, 'a', 'healing-draught');
    expect(r.error).toMatch(/full/i);
    expect(pl(r.state).inventory).toEqual(['healing-draught']);
  });
  it('atk boost adds +4 permanently, capped at +12 total', () => {
    let s = makeState(makePlayer({ inventory: Array(4).fill('fury-tonic') }));
    for (let i = 0; i < 3; i++) s = useItem(s, 'a', 'fury-tonic').state;
    expect(pl(s).stats.atk).toBe(CLASSES.knight.base.atk + ATK_BOOST_CAP);
    const r = useItem(s, 'a', 'fury-tonic');
    expect(r.error).toBeDefined();
    expect(pl(r.state).inventory).toEqual(['fury-tonic']);
  });
  it('warp scroll moves the player to the start tile', () => {
    const { state } = useItem(makeState(makePlayer({ inventory: ['warp-scroll'] })), 'a', 'warp-scroll');
    expect(pl(state).tileId).toBe('tile-start');
  });
  it('fails for missing or non-consumable items', () => {
    const s0 = makeState(makePlayer({ inventory: ['oak-cudgel'] }));
    expect(useItem(s0, 'a', 'warp-scroll').error).toMatch(/inventory/i);
    expect(useItem(s0, 'a', 'oak-cudgel').error).toMatch(/consumable/i);
  });
});
