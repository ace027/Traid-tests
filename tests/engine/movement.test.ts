import { describe, expect, it } from 'vitest';
import { buildDefaultMap, buildDefaultTowns } from '../../src/engine/map';
import { autoAdvance, movePlayer, resolveTile, rollDice, stepsAvailable } from '../../src/engine/movement';
import type { GameState, Player } from '../../src/engine/types';

function mkPlayer(id: string, tileId = 'start', gold = 0): Player {
  return {
    id, name: id, classId: 'knight',
    stats: { hp: 50, maxHp: 100, atk: 10, def: 5, spd: 5, luck: 5 },
    gold, tileId, inventory: [], equipment: {}, level: 1, xp: 0, defeated: false,
  };
}

function mkState(tileId: string, gold = 0): GameState {
  const tiles = buildDefaultMap();
  return {
    seed: 1, rngState: 1, players: [mkPlayer('a', tileId, gold), mkPlayer('b', 'start', 50)],
    turnIndex: 0, day: 1, week: 1, phase: 'tile-resolve', tiles,
    towns: buildDefaultTowns(tiles), pendingMoves: 0, battle: null, log: [], winnerId: null,
  };
}

describe('rollDice', () => {
  it('stays in 1..6 and is deterministic', () => {
    let r = 42;
    for (let i = 0; i < 200; i++) {
      const out = rollDice(r);
      expect(out.value).toBeGreaterThanOrEqual(1);
      expect(out.value).toBeLessThanOrEqual(6);
      r = out.rngState;
    }
    expect(rollDice(7)).toEqual(rollDice(7));
  });
});

describe('movement', () => {
  it('branch tile offers more than one option, plain offers one', () => {
    expect(stepsAvailable(mkState('m05'), 'a')).toEqual(['m06', 'b01']);
    expect(stepsAvailable(mkState('m01'), 'a')).toEqual(['m02']);
  });

  it('movePlayer sets tile, decrements moves, and does not mutate', () => {
    const s = { ...mkState('m01'), pendingMoves: 3 };
    const n = movePlayer(s, 'a', 'm02');
    expect(n.players[0].tileId).toBe('m02');
    expect(n.pendingMoves).toBe(2);
    expect(s.players[0].tileId).toBe('m01');
    expect(() => movePlayer(s, 'a', 'm09')).toThrow();
  });

  it('autoAdvance stops at a branch or when moves run out', () => {
    const a = autoAdvance({ ...mkState('m03'), pendingMoves: 5 }, 'a');
    expect(a.players[0].tileId).toBe('m05');
    expect(a.pendingMoves).toBe(3);
    const b = autoAdvance({ ...mkState('m01'), pendingMoves: 2 }, 'a');
    expect(b.players[0].tileId).toBe('m03');
    expect(b.pendingMoves).toBe(0);
  });

  it('boss tile stops movement only in week 4', () => {
    const s = { ...mkState('m27'), pendingMoves: 3 };
    expect(movePlayer(s, 'a', 'boss').pendingMoves).toBe(2);
    expect(movePlayer({ ...s, week: 4 }, 'a', 'boss').pendingMoves).toBe(0);
  });
});

describe('resolveTile', () => {
  it('monster tile starts a battle with tier from week', () => {
    const r = resolveTile(mkState('m02'));
    expect(r.state.phase).toBe('battle');
    expect(r.state.battle?.defender).toEqual({ kind: 'monster', id: 'monster-tier-1' });
    expect(resolveTile({ ...mkState('m02'), week: 4 }).state.battle?.defender.id).toBe('monster-tier-4');
    expect(resolveTile({ ...mkState('m02'), week: 5 }).state.battle?.defender.id).toBe('monster-tier-4');
  });

  it('boss tile is a battle in week 4, inert otherwise', () => {
    expect(resolveTile(mkState('boss')).state.phase).toBe('end-turn');
    const r = resolveTile({ ...mkState('boss'), week: 4 });
    expect(r.state.phase).toBe('battle');
    expect(r.state.battle?.defender.id).toBe('boss');
  });

  it('shop tile opens the shop', () => {
    expect(resolveTile(mkState('m07')).state.phase).toBe('shop');
  });

  it('heal restores 30% and caps at maxHp', () => {
    const r = resolveTile(mkState('m08'));
    expect(r.state.players[0].stats.hp).toBe(80);
    const s = mkState('m08');
    s.players[0].stats.hp = 90;
    expect(resolveTile(s).state.players[0].stats.hp).toBe(100);
  });

  it('event changes gold by 10..50, deterministic, never below 0', () => {
    const r = resolveTile(mkState('m04', 500));
    const d = r.state.players[0].gold - 500;
    expect(Math.abs(d)).toBeGreaterThanOrEqual(10);
    expect(Math.abs(d)).toBeLessThanOrEqual(50);
    expect(resolveTile(mkState('m04', 500)).state).toEqual(r.state);
    for (let seed = 0; seed < 50; seed++) {
      const s = { ...mkState('m04', 0), rngState: seed };
      expect(resolveTile(s).state.players[0].gold).toBeGreaterThanOrEqual(0);
    }
  });

  it('town claim deducts 100 gold, not claimable under 100', () => {
    const r = resolveTile(mkState('m03', 150));
    expect(r.state.towns['m03'].ownerId).toBe('a');
    expect(r.state.players[0].gold).toBe(50);
    const poor = resolveTile(mkState('m03', 99));
    expect(poor.state.towns['m03'].ownerId).toBeNull();
    expect(poor.state.players[0].gold).toBe(99);
  });

  it('owner landing on own town does nothing', () => {
    const s = mkState('m03', 150);
    s.towns['m03'].ownerId = 'a';
    const r = resolveTile(s);
    expect(r.state.players[0].gold).toBe(150);
    expect(r.events).toEqual([]);
  });

  it('toll transfers gold to owner and never goes below 0', () => {
    const s = mkState('m03', 500);
    s.towns['m03'].ownerId = 'b';
    const r = resolveTile(s);
    expect(r.state.players[0].gold).toBe(480);
    expect(r.state.players[1].gold).toBe(70);
    const poor = mkState('m03', 5);
    poor.towns['m03'].ownerId = 'b';
    const r2 = resolveTile(poor);
    expect(r2.state.players[0].gold).toBe(0);
    expect(r2.state.players[1].gold).toBe(55);
  });
});
