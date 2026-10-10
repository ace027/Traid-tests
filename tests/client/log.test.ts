import { describe, expect, it } from 'vitest';
import { createGame, type GameEvent } from '../../src/engine';
import { publicState, type PublicGameState } from '../../src/shared/protocol';
import { describeEvent, describeEvents } from '../../src/client/ui/log';

function st(): PublicGameState {
  return publicState(
    createGame({
      seed: 1,
      players: [
        { id: 'p1', name: 'Ann', classId: 'knight' },
        { id: 'p2', name: 'Bob', classId: 'mage' },
      ],
    }),
  );
}
const ev = (e: Record<string, unknown>) => e as unknown as GameEvent;

describe('describeEvent', () => {
  const s = st();
  it('describes common events using player names', () => {
    expect(describeEvent(s, ev({ type: 'roll', playerId: 'p1', value: 4 }))).toBe('Ann rolled a 4');
    expect(describeEvent(s, ev({ type: 'damage', source: 'p1', target: 'p2', amount: 7, crit: true }))).toBe(
      'Ann hit Bob for 7 (critical!)',
    );
    expect(describeEvent(s, ev({ type: 'defend', playerId: 'p2' }))).toBe('Bob defends');
    expect(describeEvent(s, ev({ type: 'flee-failed', playerId: 'p2' }))).toBe('Bob failed to flee');
    expect(describeEvent(s, ev({ type: 'battle-end', playerId: 'p1', result: 'fled' }))).toBe('Ann fled the battle');
    expect(describeEvent(s, ev({ type: 'battle-end', playerId: 'p1', result: 'win' }))).toBe('The battle is won');
    expect(describeEvent(s, ev({ type: 'battle-end', playerId: 'p1', result: 'loss' }))).toBe('The battle is lost');
    expect(describeEvent(s, ev({ type: 'level-up', playerId: 'p1', level: 3 }))).toBe('Ann reached level 3');
    expect(describeEvent(s, ev({ type: 'town-capture', playerId: 'p1' }))).toBe('Ann captured a town');
  });
  it('falls back to id or generic text for unknown players', () => {
    expect(describeEvent(s, ev({ type: 'defend', playerId: 'zz' }))).toBe('zz defends');
    expect(describeEvent(s, ev({ type: 'defend' }))).toBe('someone defends');
    expect(describeEvent(s, ev({ type: 'loot', playerId: 'p1' }))).toBe('Ann found an item');
  });
  it('returns null for unknown event types', () => {
    expect(describeEvent(s, ev({ type: 'mystery' }))).toBeNull();
  });
  it('describeEvents drops nulls', () => {
    expect(describeEvents(s, [ev({ type: 'mystery' }), ev({ type: 'defend', playerId: 'p1' })])).toEqual(['Ann defends']);
  });
});
