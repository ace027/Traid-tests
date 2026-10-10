// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, shopStock, ITEMS, type GameState } from '../../src/engine';
import { publicState, type PublicGameState } from '../../src/shared/protocol';
import { createStore, type Store } from '../../src/client/store';
import { isReplaced, REPLACED_MESSAGE } from '../../src/client/net';
import { mountHud } from '../../src/client/ui/hud';

let root: HTMLElement;
let store: Store;
let send: ReturnType<typeof vi.fn>;

function base(): GameState {
  return createGame({
    seed: 1,
    players: [
      { id: 'p1', name: 'Ann', classId: 'knight' },
      { id: 'p2', name: 'Bob', classId: 'mage' },
    ],
  });
}
function show(patch: (s: GameState) => GameState, me = 'p1'): void {
  const state: PublicGameState = publicState(patch(base()));
  store.set({ playerId: me, state, lastEvents: [] });
}
const buttons = () => [...root.querySelectorAll('button')] as HTMLButtonElement[];
const find = (label: string | RegExp) =>
  buttons().find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')));

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  store = createStore();
  send = vi.fn();
  mountHud(root, store, send);
});

describe('hud', () => {
  it('shows Roll on my turn and sends roll', () => {
    show((s) => ({ ...s, phase: 'roll', turnIndex: 0 }));
    find('Roll')!.click();
    expect(send).toHaveBeenCalledWith({ t: 'action', action: { type: 'roll' } });
  });

  it('shows waiting text and no action buttons when not my turn', () => {
    show((s) => ({ ...s, phase: 'roll', turnIndex: 0 }), 'p2');
    expect(root.textContent).toContain('Waiting for Ann');
    expect(find('Roll')).toBeUndefined();
    expect(find('End Turn')).toBeUndefined();
  });

  it('battle panel sends attack and flee', () => {
    show((s) => ({
      ...s,
      phase: 'battle',
      battle: { attackerId: 'p1', defender: { kind: 'monster', id: s.log ? 'boss-sovereign-of-ash' : '' }, round: 1, monsterHp: 50 },
    }));
    find('Attack')!.click();
    find('Flee')!.click();
    expect(send).toHaveBeenCalledWith({ t: 'action', action: { type: 'battleAction', action: 'attack' } });
    expect(send).toHaveBeenCalledWith({ t: 'action', action: { type: 'battleAction', action: 'flee' } });
  });

  it('defender in pvp battle cannot act', () => {
    show(
      (s) => ({ ...s, phase: 'battle', battle: { attackerId: 'p1', defender: { kind: 'player', id: 'p2' }, round: 1 } }),
      'p2',
    );
    expect(find('Attack')).toBeUndefined();
  });

  it('shop disables unaffordable Buy and sends buy', () => {
    const stock = shopStock('x');
    void stock;
    show((s) => {
      const shopTile = Object.values(s.tiles).find((t) => t.kind === 'shop')!;
      const players = s.players.map((p) => (p.id === 'p1' ? { ...p, tileId: shopTile.id, gold: 35 } : p));
      return { ...s, phase: 'shop', players };
    });
    const tile = store.get().state!.players[0].tileId;
    const items = shopStock(tile).map((id) => ITEMS[id]);
    const rows = [...root.querySelectorAll('.shop > ul:first-of-type li')];
    expect(rows.length).toBe(items.length);
    const dear = items.findIndex((i) => i.price > 35);
    const cheap = items.findIndex((i) => i.price <= 35);
    expect((rows[dear].querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    (rows[cheap].querySelector('button') as HTMLButtonElement).click();
    expect(send).toHaveBeenCalledWith({ t: 'action', action: { type: 'buy', itemId: items[cheap].id } });
  });

  it('town panel shows Upgrade for owner and Capture for rival', () => {
    const setup = (owner: string) => (s: GameState): GameState => {
      const t = Object.values(s.tiles).find((x) => x.kind === 'town')!;
      const players = s.players.map((p) => (p.id === 'p1' ? { ...p, tileId: t.id, gold: 500 } : p));
      return { ...s, phase: 'town', players, towns: { ...s.towns, [t.id]: { tileId: t.id, ownerId: owner, level: 1, income: 10 } } };
    };
    show(setup('p1'));
    expect(find(/^Upgrade/)).toBeDefined();
    expect(find(/^Capture/)).toBeUndefined();
    show(setup('p2'));
    expect(find(/^Capture/)).toBeDefined();
    expect(find(/^Upgrade/)).toBeUndefined();
    find('Leave')!.click();
    expect(send).toHaveBeenCalledWith({ t: 'action', action: { type: 'leaveTown' } });
  });

  it('game over shows winner', () => {
    show((s) => ({ ...s, phase: 'game-over', winnerId: 'p2' }), 'p1');
    expect(root.querySelector('.winner-banner')!.textContent).toContain('Bob');
  });

  it('renders store errors in a role=alert element and clears them on next state', () => {
    show((s) => ({ ...s, phase: 'roll', turnIndex: 0 }));
    store.set({ error: 'Not enough gold' });
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('Not enough gold');
    store.set({ error: null });
    expect(root.querySelector('[role="alert"]')!.textContent).toBe('');
  });

  it('has live regions for turn indicator and log', () => {
    show((s) => ({ ...s, phase: 'roll', turnIndex: 0 }));
    expect(root.querySelector('.hud-top')!.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.log-list')!.getAttribute('role')).toBe('log');
  });

  it('choose-path lists destinations as buttons that send choosePath', () => {
    show((s) => {
      const from = s.tiles[s.players[0].tileId];
      return { ...s, phase: 'choose-path', turnIndex: 0, pendingMoves: 1, players: s.players.map((p, i) => (i === 0 ? { ...p, tileId: from.id } : p)) };
    });
    const go = buttons().filter((b) => /^Go to /.test(b.textContent ?? ''));
    expect(go.length).toBeGreaterThan(0);
    expect(root.querySelector('ol.path-targets')).not.toBeNull();
    go[0].click();
    expect(send.mock.calls.some((c) => c[0].action?.type === 'choosePath')).toBe(true);
  });

  it('battle round events container is a live log', () => {
    const state = publicState({
      ...base(),
      phase: 'battle',
      battle: { attackerId: 'p1', defender: { kind: 'player', id: 'p2' }, round: 1 },
    });
    store.set({ playerId: 'p1', state, lastEvents: [{ type: 'defend', playerId: 'p1' }] });
    const ul = root.querySelector('.round-events')!;
    expect(ul.getAttribute('role')).toBe('log');
    expect(ul.getAttribute('aria-live')).toBe('polite');
  });
});

describe('hud inventory gate', () => {
  const toggle = () => find('Inventory') as HTMLButtonElement;
  const box = () => root.querySelector('.hud-inventory') as HTMLElement;
  const onKind = (kind: 'shop' | 'town') => (s: GameState): GameState => {
    const t = Object.values(s.tiles).find((x) => x.kind === kind)!;
    return { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, tileId: t.id } : p)) };
  };

  it('is hidden for a waiting player even after toggling', () => {
    show((s) => ({ ...s, phase: 'roll', turnIndex: 0 }), 'p2');
    expect(toggle().hidden).toBe(true);
    expect(box().hidden).toBe(true);
    toggle().click();
    expect(toggle().hidden).toBe(true);
    expect(box().hidden).toBe(true);
    expect(box().children.length).toBe(0);
  });

  it('is hidden for the current player during battle', () => {
    show((s) => ({
      ...s,
      phase: 'battle',
      turnIndex: 0,
      battle: { attackerId: 'p1', defender: { kind: 'player', id: 'p2' }, round: 1 },
    }));
    expect(toggle().hidden).toBe(true);
    expect(box().hidden).toBe(true);
  });

  it('is hidden for the current player while choosing a path', () => {
    show((s) => ({ ...s, phase: 'choose-path', turnIndex: 0, pendingMoves: 1 }));
    expect(toggle().hidden).toBe(true);
    expect(box().hidden).toBe(true);
  });

  it('is hidden for the current player at game over', () => {
    show((s) => ({ ...s, phase: 'game-over', turnIndex: 0, winnerId: 'p1' }));
    expect(toggle().hidden).toBe(true);
    expect(box().hidden).toBe(true);
  });

  it.each([
    ['roll', (s: GameState): GameState => ({ ...s, phase: 'roll', turnIndex: 0 })],
    ['shop', (s: GameState): GameState => ({ ...onKind('shop')(s), phase: 'shop', turnIndex: 0 })],
    [
      'town',
      (s: GameState): GameState => {
        const moved = onKind('town')(s);
        const id = moved.players[0].tileId;
        return { ...moved, phase: 'town', turnIndex: 0, towns: { ...moved.towns, [id]: { tileId: id, ownerId: null, level: 1, income: 10 } as never } };
      },
    ],
    ['end-turn', (s: GameState): GameState => ({ ...s, phase: 'end-turn', turnIndex: 0 })],
  ])('shows the toggle for the current player in %s and opens the panel', (_phase, patch) => {
    show(patch);
    expect(toggle().hidden).toBe(false);
    expect(box().hidden).toBe(true);
    toggle().click();
    expect(box().hidden).toBe(false);
  });
});

describe('hud error toast', () => {
  it('shows store.error in an alert and hides it once cleared', () => {
    const alert = () => root.querySelector('[role="alert"]') as HTMLElement;
    expect(alert().hidden).toBe(true);
    store.set({ error: 'Not enough gold' });
    expect(alert().hidden).toBe(false);
    expect(alert().textContent).toBe('Not enough gold');
    show((s) => ({ ...s, phase: 'roll', turnIndex: 0 }));
    store.set({ error: null });
    expect(alert().hidden).toBe(true);
    expect(alert().textContent).toBe('');
  });

  it('auto-clears the error after 4 seconds', () => {
    vi.useFakeTimers();
    try {
      const alert = () => root.querySelector('[role="alert"]') as HTMLElement;
      store.set({ error: 'Not enough gold' });
      vi.advanceTimersByTime(3900);
      expect(alert().hidden).toBe(false);
      vi.advanceTimersByTime(200);
      expect(store.get().error).toBeNull();
      expect(alert().hidden).toBe(true);
      expect(alert().textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never expires the replaced error', () => {
    vi.useFakeTimers();
    try {
      store.set({ connection: 'closed', error: REPLACED_MESSAGE });
      vi.advanceTimersByTime(10000);
      expect(store.get().error).toBe(REPLACED_MESSAGE);
      expect(isReplaced(store.get())).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
