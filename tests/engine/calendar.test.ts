import { describe, expect, it } from 'vitest';
import { advanceTurn, computeScore } from '../../src/engine/calendar';
import type { GameState, Player } from '../../src/engine/types';

function mkPlayer(id: string, gold = 0): Player {
  return {
    id, name: id, classId: 'mage',
    stats: { hp: 40, maxHp: 80, atk: 10, def: 5, spd: 5, luck: 5 },
    gold, tileId: 'm10', inventory: [], equipment: {}, level: 1, xp: 0, defeated: false,
  };
}

function mkState(n = 2): GameState {
  return {
    seed: 1, rngState: 1,
    players: Array.from({ length: n }, (_, i) => mkPlayer(`p${i}`)),
    turnIndex: 0, day: 1, week: 1, phase: 'end-turn', tiles: { start: { id: 'start', kind: 'start', x: 0, y: 0, next: [] } },
    towns: { t1: { tileId: 't1', ownerId: 'p1', level: 2, income: 20 } },
    pendingMoves: 0, battle: null, log: [], winnerId: null,
  };
}

describe('advanceTurn', () => {
  it('moves to the next player within a day', () => {
    const s = advanceTurn(mkState());
    expect(s.turnIndex).toBe(1);
    expect(s.day).toBe(1);
    expect(s.phase).toBe('roll');
  });

  it('rolls the day after the last player and pays income', () => {
    const s = advanceTurn({ ...mkState(), turnIndex: 1 });
    expect(s.turnIndex).toBe(0);
    expect(s.day).toBe(2);
    expect(s.players[1].gold).toBe(40);
    expect(s.players[0].gold).toBe(0);
  });

  it('rolls the week after day 7', () => {
    const s = advanceTurn({ ...mkState(), turnIndex: 1, day: 7 });
    expect(s.day).toBe(1);
    expect(s.week).toBe(2);
  });

  it('ends the game after week 4 with the top scorer winning', () => {
    const base = mkState();
    base.players[0].gold = 100;
    const s = advanceTurn({ ...base, turnIndex: 1, day: 7, week: 4 });
    expect(s.phase).toBe('game-over');
    expect(s.winnerId).toBe('p1'); // 40 income + 300 town value
  });

  it('ties go to the lowest player index', () => {
    const s = mkState(3);
    s.towns = {};
    expect(advanceTurn({ ...s, turnIndex: 2, day: 7, week: 4 }).winnerId).toBe('p0');
  });

  it('boss defeated ends the game immediately', () => {
    const s = advanceTurn(mkState(), { bossDefeated: true });
    expect(s.phase).toBe('game-over');
    expect(s.winnerId).toBe('p1');
  });

  it('skips defeated players; they respawn at start with half hp next day', () => {
    const s0 = mkState(3);
    s0.players[1].defeated = true;
    const s1 = advanceTurn(s0);
    expect(s1.turnIndex).toBe(2);
    const s2 = advanceTurn(s1);
    expect(s2.day).toBe(2);
    expect(s2.turnIndex).toBe(0);
    expect(s2.players[1].defeated).toBe(false);
    expect(s2.players[1].tileId).toBe('start');
    expect(s2.players[1].stats.hp).toBe(40);
  });

  it('handles all players defeated at once', () => {
    const s0 = mkState(2);
    s0.players.forEach((p) => (p.defeated = true));
    const s = advanceTurn(s0);
    expect(s.day).toBe(2);
    expect(s.turnIndex).toBe(0);
    expect(s.players.every((p) => !p.defeated && p.tileId === 'start')).toBe(true);
    expect(s.phase).toBe('roll');
  });

  it('does nothing once the game is over', () => {
    const s = { ...mkState(), phase: 'game-over' as const };
    expect(advanceTurn(s)).toBe(s);
  });
});

describe('computeScore', () => {
  it('is gold plus 150 per town level owned', () => {
    const s = mkState();
    s.players[1].gold = 25;
    expect(computeScore(s, 'p1')).toBe(325);
    expect(computeScore(s, 'p0')).toBe(0);
  });
});
