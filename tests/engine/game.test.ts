import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../../src/engine/game';
import type { GameState } from '../../src/engine/types';

const P = [
  { id: 'a', name: 'Ann', classId: 'knight' as const },
  { id: 'b', name: 'Bob', classId: 'mage' as const },
];

function mk(seed = 1): GameState {
  return createGame({ seed, players: P });
}

describe('createGame', () => {
  it('accepts 2-4 players only', () => {
    expect(() => createGame({ seed: 1, players: [P[0]] })).toThrow();
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: 'x', classId: 'rogue' as const }));
    expect(() => createGame({ seed: 1, players: five })).toThrow();
    expect(() => createGame({ seed: 1, players: [P[0], P[0]] })).toThrow();
    for (const n of [2, 3, 4]) {
      const ps = five.slice(0, n);
      expect(createGame({ seed: 1, players: ps }).players).toHaveLength(n);
    }
  });

  it('sets up starting state', () => {
    const s = mk();
    expect(s.phase).toBe('roll');
    expect(s.players.every((p) => p.gold === 100 && p.tileId === 'start')).toBe(true);
    expect(s.players[0].stats.atk).toBe(11);
    expect(Object.keys(s.towns).length).toBeGreaterThan(0);
  });
});

describe('applyAction', () => {
  it('rejects wrong-turn actions', () => {
    const r = applyAction(mk(), 'b', { type: 'roll' });
    expect(r.error).toBeTruthy();
  });

  it('rejects illegal action for phase', () => {
    expect(applyAction(mk(), 'a', { type: 'endTurn' }).error).toBeTruthy();
    expect(applyAction(mk(), 'a', { type: 'leaveShop' }).error).toBeTruthy();
  });

  it('roll moves the player', () => {
    const r = applyAction(mk(), 'a', { type: 'roll' });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].tileId).not.toBe('start');
    expect(r.events[0].type).toBe('roll');
  });

  it('choose-path rejects unreachable tile and accepts a branch', () => {
    let s = mk();
    s = { ...s, phase: 'choose-path', pendingMoves: 2, players: s.players.map((p, i) => (i === 0 ? { ...p, tileId: 'm05' } : p)) };
    expect(applyAction(s, 'a', { type: 'choosePath', tileId: 'm20' }).error).toBeTruthy();
    const r = applyAction(s, 'a', { type: 'choosePath', tileId: 'b01' });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].tileId).not.toBe('m05');
  });

  it('ending on a shop opens shop phase and buy works', () => {
    let s = mk();
    s = { ...s, phase: 'roll', players: s.players.map((p, i) => (i === 0 ? { ...p, tileId: 'm06' } : p)) };
    // find a seed whose roll is 1 (m06 -> m07 shop)
    let r;
    for (let seed = 1; seed < 200; seed++) {
      r = applyAction({ ...s, rngState: seed }, 'a', { type: 'roll' });
      if (r.state.phase === 'shop') break;
    }
    expect(r!.state.phase).toBe('shop');
    expect(r!.state.players[0].tileId).toBe('m07');
    const b = applyAction(r!.state, 'a', { type: 'buy', itemId: 'healing-draught' });
    expect(b.error).toBeUndefined();
    expect(b.state.players[0].inventory).toContain('healing-draught');
    expect(b.state.players[0].gold).toBe(70);
    expect(applyAction(b.state, 'a', { type: 'buy', itemId: 'nope' }).error).toBeTruthy();
    const l = applyAction(b.state, 'a', { type: 'leaveShop' });
    expect(l.state.phase).toBe('end-turn');
    const e = applyAction(l.state, 'a', { type: 'endTurn' });
    expect(e.state.phase).toBe('roll');
    expect(e.state.turnIndex).toBe(1);
  });

  it('PvP starts when ending movement on another player tile', () => {
    let s = mk();
    s = { ...s, players: s.players.map((p) => ({ ...p, tileId: 'm01' })) };
    // roll 1 moves to m02 (monster); put rival on m02
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, tileId: 'm02' } : p)) };
    let r;
    for (let seed = 1; seed < 200; seed++) {
      r = applyAction({ ...s, rngState: seed }, 'a', { type: 'roll' });
      if (r.state.players[0].tileId === 'm02') break;
    }
    expect(r!.state.phase).toBe('battle');
    expect(r!.state.battle?.defender).toEqual({ kind: 'player', id: 'b' });
  });

  it('defeated player auto-ends turn', () => {
    let s = mk();
    // weak player vs strong monster on m02
    s = {
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, tileId: 'm01', stats: { ...p.stats, hp: 1, def: 0 } } : p)),
    };
    let r;
    for (let seed = 1; seed < 300; seed++) {
      r = applyAction({ ...s, rngState: seed }, 'a', { type: 'roll' });
      if (r.state.phase === 'battle') break;
    }
    expect(r!.state.phase).toBe('battle');
    let st = r!.state;
    for (let i = 0; i < 50 && st.phase === 'battle'; i++) {
      st = applyAction(st, 'a', { type: 'battleAction', action: 'defend' }).state;
    }
    expect(st.phase).toBe('roll');
    expect(st.turnIndex).toBe(1);
  });

  it('errors after game over', () => {
    const s = { ...mk(), phase: 'game-over' as const };
    expect(applyAction(s, 'a', { type: 'roll' }).error).toBe('The game is over');
  });

  it('is JSON round-trippable and pure', () => {
    const s = mk();
    const before = JSON.stringify(s);
    const r = applyAction(s, 'a', { type: 'roll' });
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
