// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, shopStock, ITEMS, type GameState } from '../../src/engine';
import { publicState, type PublicGameState } from '../../src/shared/protocol';
import { createStore, type Store } from '../../src/client/store';
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
});
