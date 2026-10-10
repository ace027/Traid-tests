import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../../src/engine/game';
import { determineWinner } from '../../src/engine/calendar';
import { chooseBotAction } from '../../src/engine/bot';
import { BOSS_ID } from '../../src/engine/data/monsters';
import type { ClassId, GameEvent, GameState } from '../../src/engine/types';

const CLASSES: ClassId[] = ['knight', 'mage', 'rogue', 'cleric'];
const CAP = 20000;

function play(seed: number, n: number, buff = false) {
  let state: GameState = createGame({
    seed,
    players: Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: `Bot${i}`,
      classId: CLASSES[i % 4],
    })),
  });
  if (buff) {
    state = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        stats: { ...p.stats, hp: 99999, maxHp: 99999, atk: 999, def: 999, spd: 99, luck: 50 },
      })),
    };
  }
  const events: GameEvent[] = [];
  const seen: string[] = [];
  let actions = 0;
  while (state.phase !== 'game-over') {
    if (actions++ >= CAP) throw new Error(`seed ${seed} n ${n}: exceeded ${CAP} actions`);
    const id = state.players[state.turnIndex].id;
    const action = chooseBotAction(state, id);
    const r = applyAction(state, id, action);
    if (r.error) throw new Error(`seed ${seed} n ${n}: ${JSON.stringify(action)} -> ${r.error}`);
    events.push(...r.events);
    state = r.state;
    seen.push(`${state.week}.${state.day}`);
  }
  return { state, events, actions, seen };
}

describe('headless bot simulation', () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 5; seed++) {
      it(`${n} bots, seed ${seed} finishes`, () => {
        const { state } = play(seed, n);
        expect(state.winnerId).not.toBeNull();
        expect(state.players.some((p) => p.id === state.winnerId)).toBe(true);
        expect(state.phase).toBe('game-over');
      });
    }
  }

  it('buffed bots traverse every week, fight and defeat the boss', () => {
    for (const n of [2, 4]) {
      for (let seed = 1; seed <= 3; seed++) {
        const { state, events, seen } = play(seed, n, true);
        for (const w of [1, 2, 3, 4]) {
          expect(seen.some((x) => x.startsWith(`${w}.`)), `n ${n} seed ${seed} week ${w}`).toBe(true);
        }
        for (let d = 1; d <= 7; d++) expect(seen).toContain(`1.${d}`);
        expect(
          events.some((e) => e.type === 'battle-start' && e.monsterId === BOSS_ID),
          `n ${n} seed ${seed} boss battle`,
        ).toBe(true);
        const defeated = events.filter((e) => e.type === 'boss-defeated');
        expect(defeated).toHaveLength(1);
        expect(state.week).toBeLessThanOrEqual(4);
        expect(state.winnerId).toBe(determineWinner(state));
      }
    }
  });

  it('is deterministic', () => {
    expect(play(3, 3).state).toEqual(play(3, 3).state);
  });
});
