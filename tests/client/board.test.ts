// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultMap, buildDefaultTowns } from '../../src/engine';
import type { Player } from '../../src/engine';
import type { PublicGameState } from '../../src/shared/protocol';
import { mountBoard, setPathHandler, tileAt, tileCenter } from '../../src/client/render/board';
import { PALETTE } from '../../src/client/render/art';
import { createStore } from '../../src/client/store';

type Call = { name: string; args: unknown[] };

/** A 2D context stub that records method calls and style assignments. */
function stubContext(calls: Call[]) {
  const props: Record<string, unknown> = {};
  const gradient = { addColorStop: () => {} };
  return new Proxy(
    {},
    {
      get(_t, key: string) {
        if (key in props) return props[key];
        return (...args: unknown[]) => {
          calls.push({ name: key, args });
          if (key === 'createRadialGradient' || key === 'createLinearGradient') return gradient;
          if (key === 'measureText') return { width: 10 };
          return undefined;
        };
      },
      set(_t, key: string, value) {
        props[key] = value;
        calls.push({ name: `set:${key}`, args: [value] });
        return true;
      },
    },
  );
}

function player(id: string, tileId: string): Player {
  return {
    id,
    name: id,
    classId: 'knight',
    stats: { hp: 10, maxHp: 10, atk: 1, def: 1, spd: 1, luck: 1 },
    gold: 0,
    tileId,
    inventory: [],
    equipment: {},
    level: 1,
    xp: 0,
    defeated: false,
  };
}

function gameState(over: Partial<PublicGameState> = {}): PublicGameState {
  const tiles = buildDefaultMap();
  return {
    players: [player('p1', 'm05'), player('p2', 'start')],
    turnIndex: 0,
    day: 1,
    week: 1,
    phase: 'choose-path',
    tiles,
    towns: buildDefaultTowns(tiles),
    pendingMoves: 2,
    battle: null,
    log: [],
    winnerId: null,
    ...over,
  };
}

let calls: Call[];
let canvas: HTMLCanvasElement;

beforeEach(() => {
  calls = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => stubContext(calls) as unknown as CanvasRenderingContext2D,
  );
  canvas = document.createElement('canvas');
  document.body.append(canvas);
});

afterEach(() => {
  setPathHandler(null);
  canvas.remove();
  vi.restoreAllMocks();
});

function highlightStrokes(): number {
  // The highlight ring is the only stroke drawn with the highlight colour.
  let style: unknown = null;
  let n = 0;
  for (const c of calls) {
    if (c.name === 'set:strokeStyle') style = c.args[0];
    if (c.name === 'stroke' && style === PALETTE.highlight) n++;
  }
  return n;
}

function click(x: number, y: number) {
  canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
}

describe('board', () => {
  it('tileAt maps every tile centre back to its id', () => {
    const store = createStore();
    store.set({ playerId: 'p1', state: gameState() });
    mountBoard(canvas, store);
    for (const id of Object.keys(buildDefaultMap())) {
      const c = tileCenter(id);
      expect(c).not.toBeNull();
      expect(tileAt(c!.x, c!.y)).toBe(id);
    }
    expect(tileAt(-50, -50)).toBeNull();
  });

  it('highlights path targets only on my turn in choose-path', () => {
    const store = createStore();
    store.set({ playerId: 'p1', state: gameState() });
    mountBoard(canvas, store);
    // m05 branches to m06 and b01: two rings.
    expect(highlightStrokes()).toBe(2);

    calls.length = 0;
    store.set({ playerId: 'p2', state: gameState() });
    expect(highlightStrokes()).toBe(0);

    calls.length = 0;
    store.set({ playerId: 'p1', state: gameState({ phase: 'roll' }) });
    expect(highlightStrokes()).toBe(0);
  });

  it('clicking a target calls the path handler; other tiles do not', () => {
    const store = createStore();
    store.set({ playerId: 'p1', state: gameState() });
    mountBoard(canvas, store);
    const handler = vi.fn();
    setPathHandler(handler);

    const plain = tileCenter('m04')!;
    click(plain.x, plain.y);
    expect(handler).not.toHaveBeenCalled();

    const target = tileCenter('b01')!;
    click(target.x, target.y);
    expect(handler).toHaveBeenCalledWith('b01');
  });

  it('ignores clicks when it is not my turn', () => {
    const store = createStore();
    store.set({ playerId: 'p2', state: gameState() });
    mountBoard(canvas, store);
    const handler = vi.fn();
    setPathHandler(handler);
    const target = tileCenter('m06')!;
    click(target.x, target.y);
    expect(handler).not.toHaveBeenCalled();
  });

  it('draws a token per player, including four on one tile', () => {
    const store = createStore();
    const players = ['a', 'b', 'c', 'd'].map((id) => player(id, 'start'));
    store.set({ playerId: 'a', state: gameState({ players, phase: 'roll' }) });
    mountBoard(canvas, store);
    const initials = calls.filter((c) => c.name === 'fillText' && c.args[0] === 'K');
    const xs = new Set(initials.map((c) => `${c.args[1]},${c.args[2]}`));
    expect(xs.size).toBe(4);
  });

  it('survives a new state and a resize while a move animation runs', () => {
    const store = createStore();
    store.set({ playerId: 'p1', state: gameState({ phase: 'roll' }) });
    mountBoard(canvas, store);
    const moved = gameState({ phase: 'choose-path', players: [player('p1', 'm05'), player('p2', 'm03')] });
    store.set({ state: moved, lastEvents: [{ type: 'roll', playerId: 'p2', value: 3 }, { type: 'move', playerId: 'p2', tileId: 'm03' }] });
    window.dispatchEvent(new Event('resize'));
    const later = gameState({ phase: 'roll', players: [player('p1', 'm06'), player('p2', 'm03')] });
    expect(() => store.set({ state: later, lastEvents: [] })).not.toThrow();
    expect(tileAt(tileCenter('m06')!.x, tileCenter('m06')!.y)).toBe('m06');
  });
});
