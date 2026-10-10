import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../../src/engine/game';
import { chooseBotAction } from '../../src/engine/bot';
import type { ClassId, GameEvent, GameState } from '../../src/engine/types';

const CLASSES: ClassId[] = ['knight', 'mage', 'rogue', 'cleric'];
const CAP = 20000;

function play(seed: number, n: number) {
  let state: GameState = createGame({
    seed,
    players: Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: `Bot${i}`,
      classId: CLASSES[i % 4],
    })),
  });
  const events: GameEvent[] = [];
  let actions = 0;
  while (state.phase !== 'game-over') {
    if (actions++ >= CAP) throw new Error(`seed ${seed} n ${n}: exceeded ${CAP} actions`);
    const id = state.players[state.turnIndex].id;
    const action = chooseBotAction(state, id);
    const r = applyAction(state, id, action);
    if (r.error) throw new Error(`seed ${seed} n ${n}: ${JSON.stringify(action)} -> ${r.error}`);
    events.push(...r.events);
    state = r.state;
  }
  return { state, events, actions };
}

describe('headless bot simulation', () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 5; seed++) {
      it(`${n} bots, seed ${seed} finishes`, () => {
        const { state, events } = play(seed, n);
        expect(state.winnerId).not.toBeNull();
        expect(state.players.some((p) => p.id === state.winnerId)).toBe(true);
        const bossDead = events.some((e) => e.type === 'boss-defeated');
        expect(state.week >= 4 || bossDead).toBe(true);
      });
    }
  }

  it('is deterministic', () => {
    expect(play(3, 3).state).toEqual(play(3, 3).state);
  });
});
