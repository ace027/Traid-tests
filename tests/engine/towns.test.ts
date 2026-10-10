import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../../src/engine/game';
import { resolveTile } from '../../src/engine/movement';
import { chooseBotAction } from '../../src/engine/bot';
import { advanceTurn } from '../../src/engine/calendar';
import type { GameState } from '../../src/engine/types';

const TILE = Object.keys(createGame({ seed: 1, players: [{ id: 'a', name: 'A', classId: 'knight' }, { id: 'b', name: 'B', classId: 'mage' }] }).towns)[0];

function setup(opts: { owner: string | null; level?: number; gold?: number; goldB?: number; turn?: number }): GameState {
  const s = createGame({
    seed: 1,
    players: [
      { id: 'a', name: 'A', classId: 'knight' },
      { id: 'b', name: 'B', classId: 'mage' },
    ],
  });
  return {
    ...s,
    turnIndex: opts.turn ?? 0,
    towns: { ...s.towns, [TILE]: { ...s.towns[TILE], ownerId: opts.owner, level: opts.level ?? 1 } },
    players: s.players.map((p) => ({
      ...p,
      tileId: TILE,
      gold: p.id === 'a' ? (opts.gold ?? 500) : (opts.goldB ?? 500),
    })),
  };
}

const enter = (s: GameState) => resolveTile(s).state;
const gold = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.gold;

describe('town phase', () => {
  it('unowned town is claimed as before and ends turn', () => {
    const s = enter(setup({ owner: null }));
    expect(s.phase).toBe('end-turn');
    expect(s.towns[TILE].ownerId).toBe('a');
  });

  it('owner landing enters town phase', () => {
    expect(enter(setup({ owner: 'a' })).phase).toBe('town');
  });

  it('upgrade costs 80*level and caps at level 3', () => {
    let s = enter(setup({ owner: 'a', gold: 80 }));
    let r = applyAction(s, 'a', { type: 'upgradeTown' });
    expect(r.error).toBeUndefined();
    expect(r.state.towns[TILE].level).toBe(2);
    expect(gold(r.state, 'a')).toBe(0);
    expect(r.state.phase).toBe('end-turn');

    s = enter(setup({ owner: 'a', level: 2, gold: 1000 }));
    r = applyAction(s, 'a', { type: 'upgradeTown' });
    expect(r.state.towns[TILE].level).toBe(3);
    expect(gold(r.state, 'a')).toBe(840);

    s = enter(setup({ owner: 'a', level: 3, gold: 1000 }));
    expect(applyAction(s, 'a', { type: 'upgradeTown' }).error).toBeTruthy();
  });

  it('rejects upgrade with insufficient gold', () => {
    const s = enter(setup({ owner: 'a', gold: 79 }));
    const r = applyAction(s, 'a', { type: 'upgradeTown' });
    expect(r.error).toBeTruthy();
    expect(r.state.towns[TILE].level).toBe(1);
  });

  it('rival pays toll then can capture; gold goes to old owner', () => {
    const s = enter(setup({ owner: 'b', level: 2, gold: 500, goldB: 0, turn: 0 }));
    expect(s.phase).toBe('town');
    expect(gold(s, 'a')).toBe(500 - 40);
    expect(gold(s, 'b')).toBe(40);
    const r = applyAction(s, 'a', { type: 'captureTown' });
    expect(r.error).toBeUndefined();
    expect(r.state.towns[TILE].ownerId).toBe('a');
    expect(r.state.towns[TILE].level).toBe(2);
    expect(gold(r.state, 'a')).toBe(460 - 300);
    expect(gold(r.state, 'b')).toBe(340);
    expect(r.state.phase).toBe('end-turn');
  });

  it('capture still pays a defeated old owner', () => {
    const base = enter(setup({ owner: 'b', gold: 500 }));
    const s = { ...base, players: base.players.map((p) => (p.id === 'b' ? { ...p, defeated: true } : p)) };
    const r = applyAction(s, 'a', { type: 'captureTown' });
    expect(gold(r.state, 'b')).toBe(gold(s, 'b') + 150);
  });

  it('capture rejected when too poor, or on own town; upgrade rejected on rival town', () => {
    const rival = enter(setup({ owner: 'b', gold: 160 }));
    expect(applyAction(rival, 'a', { type: 'captureTown' }).error).toBeTruthy();
    expect(applyAction(rival, 'a', { type: 'upgradeTown' }).error).toBeTruthy();
    const own = enter(setup({ owner: 'a' }));
    expect(applyAction(own, 'a', { type: 'captureTown' }).error).toBeTruthy();
  });

  it('leaveTown ends the turn; wrong player and wrong phase rejected', () => {
    const s = enter(setup({ owner: 'a' }));
    expect(applyAction(s, 'b', { type: 'leaveTown' }).error).toBeTruthy();
    expect(applyAction({ ...s, phase: 'roll' }, 'a', { type: 'leaveTown' }).error).toBeTruthy();
    const r = applyAction(s, 'a', { type: 'leaveTown' });
    expect(r.state.phase).toBe('end-turn');
    expect(r.state.towns[TILE].level).toBe(1);
  });

  it('daily income scales with level after an upgrade', () => {
    const s = enter(setup({ owner: 'a', gold: 80, goldB: 0 }));
    const up = applyAction(s, 'a', { type: 'upgradeTown' }).state;
    const end = advanceTurn(advanceTurn(up));
    expect(gold(end, 'a')).toBe(0 + up.towns[TILE].income * 2);
  });

  it('bot upgrades, captures or leaves', () => {
    expect(chooseBotAction(enter(setup({ owner: 'a', gold: 180 })), 'a').type).toBe('upgradeTown');
    expect(chooseBotAction(enter(setup({ owner: 'a', gold: 179 })), 'a').type).toBe('leaveTown');
    expect(chooseBotAction(enter(setup({ owner: 'b', gold: 400 })), 'a').type).toBe('captureTown');
    expect(chooseBotAction(enter(setup({ owner: 'b', gold: 200 })), 'a').type).toBe('leaveTown');
  });
});
