import { describe, expect, it } from 'vitest';
import type { ClassId, GameState, Player } from '../../src/engine';
import { nextInt } from '../../src/engine/rng';
import { CLASSES } from '../../src/engine/data/classes';
import { BOSS_ID, MONSTERS, monstersForTier, monsterXp } from '../../src/engine/data/monsters';
import { ITEMS, shopStock } from '../../src/engine/data/items';
import {
  computeDamage,
  defendedDamage,
  fleeChance,
  resolveBattleAction,
  startMonsterBattle,
  startPlayerBattle,
  type BattleAction,
} from '../../src/engine/combat';

function makePlayer(id: string, classId: ClassId, over: Partial<Player> = {}): Player {
  const base = CLASSES[classId].base;
  return {
    id,
    name: id.toUpperCase(),
    classId,
    stats: { ...base },
    gold: 100,
    tileId: 't0',
    inventory: [],
    equipment: {},
    level: 1,
    xp: 0,
    defeated: false,
    ...over,
  };
}

function makeState(players: Player[], seed = 42): GameState {
  return {
    seed,
    rngState: seed,
    players,
    turnIndex: 0,
    day: 1,
    week: 1,
    phase: 'tile-resolve',
    tiles: {},
    towns: {},
    pendingMoves: 0,
    battle: null,
    log: [],
    winnerId: null,
  };
}

const ATTACK: BattleAction = { type: 'battleAction', action: 'attack' };
const p = (s: GameState, id: string) => s.players.find((x) => x.id === id)!;

function fightOut(state: GameState, action: BattleAction = ATTACK, limit = 200): GameState {
  let s = state;
  for (let i = 0; i < limit && s.phase === 'battle'; i++) s = resolveBattleAction(s, action).state;
  return s;
}

describe('content data', () => {
  it('has the required counts and ranges', () => {
    for (const t of [1, 2, 3] as const) expect(monstersForTier(t).length).toBeGreaterThanOrEqual(3);
    const boss = MONSTERS.find((m) => m.id === BOSS_ID)!;
    expect(boss.tier).toBe(4);
    expect(boss.stats.maxHp).toBe(600);
    for (const m of monstersForTier(1)) expect(m.stats.maxHp).toBeGreaterThanOrEqual(20);
    for (const m of monstersForTier(1)) expect(m.stats.maxHp).toBeLessThanOrEqual(30);
    for (const m of monstersForTier(3)) expect(m.stats.maxHp).toBeGreaterThanOrEqual(90);
    for (const m of monstersForTier(3)) expect(m.stats.maxHp).toBeLessThanOrEqual(120);
    for (const c of Object.values(CLASSES)) {
      expect(c.base.hp).toBeGreaterThanOrEqual(40);
      expect(c.base.hp).toBeLessThanOrEqual(60);
      expect(c.base.atk).toBeGreaterThanOrEqual(8);
      expect(c.base.atk).toBeLessThanOrEqual(14);
    }
    const items = Object.values(ITEMS);
    const count = (slot: string) => items.filter((i) => i.slot === slot).length;
    expect(count('weapon')).toBeGreaterThanOrEqual(4);
    expect(count('armor')).toBeGreaterThanOrEqual(4);
    expect(count('charm')).toBeGreaterThanOrEqual(3);
    const effects = items.filter((i) => i.kind === 'consumable').map((i) => i.effect);
    expect(effects.length).toBeGreaterThanOrEqual(4);
    expect(effects).toEqual(expect.arrayContaining(['heal', 'boost-atk', 'warp']));
    for (const i of items) {
      expect(i.price).toBeGreaterThanOrEqual(30);
      expect(i.price).toBeLessThanOrEqual(400);
    }
    for (const m of MONSTERS) for (const d of m.drops) expect(ITEMS[d]).toBeDefined();
    for (const id of shopStock('any-tile')) expect(ITEMS[id]).toBeDefined();
  });
});

describe('damage math', () => {
  it('never deals less than 1', () => {
    expect(computeDamage(1, 999, 0.9)).toBe(1);
    expect(defendedDamage(1)).toBe(1);
  });
  it('defend halves damage', () => {
    expect(defendedDamage(20)).toBe(10);
    // in battle: a defended round takes less damage than an undefended one with the same seed
    const a = startMonsterBattle(makeState([makePlayer('a', 'knight')], 7), 'a', 'thornback-boar');
    const hit = resolveBattleAction(a, ATTACK).events.find((e) => e.target === 'a')!;
    const def = resolveBattleAction(a, { type: 'battleAction', action: 'defend' }).events.find((e) => e.target === 'a')!;
    expect(def.amount as number).toBeLessThan(hit.amount as number);
  });
  it('flee probability clamps to 0.1..0.9', () => {
    expect(fleeChance(5, 5)).toBeCloseTo(0.4);
    expect(fleeChance(100, 0)).toBe(0.9);
    expect(fleeChance(0, 100)).toBe(0.1);
    expect(fleeChance(10, 5)).toBeCloseTo(0.5);
  });
});

describe('monster battles', () => {
  it('grants gold and xp and applies level-up growth', () => {
    const player = makePlayer('a', 'knight', { xp: 95, stats: { ...CLASSES.knight.base, atk: 200 } });
    const s0 = startMonsterBattle(makeState([player]), 'a', 'moss-slime');
    const { state, events } = resolveBattleAction(s0, ATTACK);
    const a = p(state, 'a');
    const slime = MONSTERS.find((m) => m.id === 'moss-slime')!;
    expect(a.gold).toBe(100 + slime.goldReward);
    expect(a.level).toBe(2);
    expect(a.xp).toBe(95 + monsterXp(slime) - 100);
    const g = CLASSES.knight.growth;
    expect(a.stats.maxHp).toBe(CLASSES.knight.base.maxHp + (g.maxHp ?? 0));
    expect(a.stats.def).toBe(CLASSES.knight.base.def + (g.def ?? 0));
    expect(state.phase).toBe('end-turn');
    expect(state.battle).toBeNull();
    expect(events.some((e) => e.type === 'level-up')).toBe(true);
  });

  it('rogue skill doubles monster gold', () => {
    const player = makePlayer('a', 'rogue', { stats: { ...CLASSES.rogue.base, atk: 200 } });
    const s0 = startMonsterBattle(makeState([player]), 'a', 'moss-slime');
    const { state } = resolveBattleAction(s0, { type: 'battleAction', action: 'skill' });
    expect(p(state, 'a').gold).toBe(100 + 2 * 15);
  });

  it('cleric skill heals 35% max hp', () => {
    const player = makePlayer('a', 'cleric', { stats: { ...CLASSES.cleric.base, hp: 10, def: 999 } });
    const s0 = startMonsterBattle(makeState([player]), 'a', 'moss-slime');
    const { state } = resolveBattleAction(s0, { type: 'battleAction', action: 'skill' });
    // healed floor(54*0.35)=18, then took 1 damage (def 999)
    expect(p(state, 'a').stats.hp).toBe(10 + 18 - 1);
  });

  it('player defeated by a monster loses 20% gold', () => {
    const player = makePlayer('a', 'mage', { stats: { ...CLASSES.mage.base, hp: 1, def: 0 }, gold: 100 });
    const s0 = startMonsterBattle(makeState([player]), 'a', 'thornback-boar');
    const { state } = resolveBattleAction(s0, { type: 'battleAction', action: 'defend' });
    const a = p(state, 'a');
    expect(a.defeated).toBe(true);
    expect(a.gold).toBe(80);
    expect(state.phase).toBe('end-turn');
  });

  it('boss defeat ends the game with the killer as winner', () => {
    const player = makePlayer('a', 'knight', { stats: { ...CLASSES.knight.base, atk: 5000 } });
    const s0 = startMonsterBattle(makeState([player]), 'a', BOSS_ID);
    const { state } = resolveBattleAction(s0, ATTACK);
    expect(state.phase).toBe('game-over');
    expect(state.winnerId).toBe('a');
  });

  it('boss kill gives +500 gold; winner is top scorer, not necessarily the slayer', () => {
    const slayer = makePlayer('a', 'knight', { stats: { ...CLASSES.knight.base, atk: 5000 }, gold: 0 });
    const rich = makePlayer('b', 'mage', { gold: 2000 });
    const s0 = startMonsterBattle(makeState([slayer, rich]), 'a', BOSS_ID);
    const { state, events } = resolveBattleAction(s0, ATTACK);
    expect(p(state, 'a').gold).toBeGreaterThanOrEqual(500);
    expect(events.some((e) => e.type === 'boss-defeated')).toBe(true);
    expect(state.phase).toBe('game-over');
    expect(state.winnerId).toBe('b');
  });

  it('boss slain on the last day of week 4 still ends with a winner', () => {
    const slayer = makePlayer('a', 'knight', { stats: { ...CLASSES.knight.base, atk: 5000 } });
    const other = makePlayer('b', 'mage', { gold: 10 });
    const base = makeState([slayer, other]);
    const s0 = startMonsterBattle({ ...base, week: 4, day: 7 }, 'a', BOSS_ID);
    const { state } = resolveBattleAction(s0, ATTACK);
    expect(state.phase).toBe('game-over');
    expect(state.winnerId).toBe('a');
  });

  it('is deterministic for a fixed seed and does not mutate input', () => {
    const s0 = startMonsterBattle(makeState([makePlayer('a', 'rogue')], 99), 'a', 'burrow-rat');
    const snapshot = JSON.stringify(s0);
    const r1 = fightOut(s0);
    const r2 = fightOut(s0);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it('flee either ends the battle or the monster strikes back', () => {
    let fled = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s0 = startMonsterBattle(makeState([makePlayer('a', 'rogue')], seed), 'a', 'moss-slime');
      const { state } = resolveBattleAction(s0, { type: 'battleAction', action: 'flee' });
      if (state.phase === 'end-turn') fled++;
      else expect(p(state, 'a').stats.hp).toBeLessThan(CLASSES.rogue.base.hp);
    }
    // rogue spd 10 vs slime spd 3 => 0.54
    expect(fled / 200).toBeGreaterThan(0.4);
    expect(fled / 200).toBeLessThan(0.7);
  });
});

describe('player battles', () => {
  it('loser is defeated and loses 30% gold, winner takes 20%', () => {
    const a = makePlayer('a', 'knight', { stats: { ...CLASSES.knight.base, atk: 999 }, gold: 50 });
    const b = makePlayer('b', 'mage', { gold: 200 });
    const s0 = startPlayerBattle(makeState([a, b]), 'a', 'b');
    const { state } = resolveBattleAction(s0, ATTACK);
    expect(p(state, 'b').defeated).toBe(true);
    expect(p(state, 'b').gold).toBe(140);
    expect(p(state, 'a').gold).toBe(90);
    expect(p(state, 'a').xp).toBe(50);
    expect(state.phase).toBe('end-turn');
  });

  it('rogue skill steals 10% gold in PvP', () => {
    const a = makePlayer('a', 'rogue', { gold: 0 });
    const b = makePlayer('b', 'knight', { gold: 200 });
    const s0 = startPlayerBattle(makeState([a, b]), 'a', 'b');
    const { state } = resolveBattleAction(s0, { type: 'battleAction', action: 'skill' });
    expect(p(state, 'a').gold).toBe(20);
    expect(p(state, 'b').gold).toBe(180);
  });

  it('rejects PvP against an already defeated player', () => {
    const s = makeState([makePlayer('a', 'knight'), makePlayer('b', 'mage', { defeated: true })]);
    expect(() => startPlayerBattle(s, 'a', 'b')).toThrow(/defeated/);
  });
});

describe('tier-1 balance', () => {
  const classes: ClassId[] = ['knight', 'mage', 'rogue', 'cleric'];
  for (const cls of classes) {
    it(`${cls} wins 55-95% of always-attack tier-1 battles`, () => {
      const tier1 = monstersForTier(1);
      let wins = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const [mi, rs] = nextInt(seed * 7919, 0, tier1.length - 1);
        const s = makeState([makePlayer('a', cls)], seed);
        s.rngState = rs;
        const end = fightOut(startMonsterBattle(s, 'a', tier1[mi].id));
        if (!p(end, 'a').defeated) wins++;
      }
      const rate = wins / 200;
      console.log(`[balance] ${cls}: ${(rate * 100).toFixed(1)}%`);
      expect(rate).toBeGreaterThanOrEqual(0.55);
      expect(rate).toBeLessThanOrEqual(0.95);
    });
  }
});

describe('pvp item theft', () => {
  const duel = (loser: Partial<Player>) => {
    const a = makePlayer('a', 'knight', { stats: { ...CLASSES.knight.base, atk: 999 } });
    const b = makePlayer('b', 'mage', loser);
    return resolveBattleAction(startPlayerBattle(makeState([a, b]), 'a', 'b'), ATTACK);
  };

  it('moves exactly one non-equipped item to the winner', () => {
    const { state, events } = duel({
      inventory: ['potion', 'potion', 'iron-sword'],
      equipment: { weapon: 'iron-sword' },
    });
    expect(p(state, 'b').inventory).toHaveLength(2);
    expect(p(state, 'a').inventory).toEqual(['potion']);
    expect(p(state, 'b').inventory).toContain('iron-sword');
    const ev = events.filter((e) => e.type === 'item-stolen');
    expect(ev).toEqual([{ type: 'item-stolen', from: 'b', to: 'a', itemId: 'potion' }]);
  });

  it('steals nothing when loser has no items or only equipped ones', () => {
    for (const loser of [{}, { inventory: ['iron-sword'], equipment: { weapon: 'iron-sword' } }]) {
      const { state, events } = duel(loser);
      expect(p(state, 'a').inventory).toEqual([]);
      expect(events.some((e) => e.type === 'item-stolen')).toBe(false);
    }
  });
});
