// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createGame, ITEMS, shopStock, type GameState, type Player } from '../../src/engine';
import { publicState, type PublicGameState } from '../../src/shared/protocol';
import { renderBattle } from '../../src/client/ui/battle';
import { renderShop, modText } from '../../src/client/ui/shop';
import { renderTown } from '../../src/client/ui/town';
import { renderInventory } from '../../src/client/ui/inventory';
import { renderGameOver } from '../../src/client/ui/gameover';

const game = (): GameState =>
  createGame({
    seed: 1,
    players: [
      { id: 'p1', name: 'Ann', classId: 'knight' },
      { id: 'p2', name: 'Bob', classId: 'mage' },
    ],
  });
const btns = (el: HTMLElement) => [...el.querySelectorAll('button')] as HTMLButtonElement[];
const byText = (el: HTMLElement, t: string | RegExp) =>
  btns(el).find((b) => (typeof t === 'string' ? b.textContent === t : t.test(b.textContent ?? '')));
const me = (s: GameState | PublicGameState, id = 'p1'): Player => s.players.find((p) => p.id === id)!;

describe('renderBattle', () => {
  const pvp = (): PublicGameState => ({
    ...publicState(game()),
    phase: 'battle',
    battle: { attackerId: 'p1', defender: { kind: 'player', id: 'p2' }, round: 1 },
  });

  it('attacker gets attack/defend/skill/flee and emits battle actions', () => {
    const s = pvp();
    const act = vi.fn();
    const el = renderBattle(s, me(s), [], act);
    expect(btns(el).map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Attack', 'Defend', 'Flee', expect.stringMatching(/^Skill: /)]),
    );
    byText(el, 'Defend')!.click();
    byText(el, /^Skill/)!.click();
    expect(act).toHaveBeenCalledWith({ type: 'battleAction', action: 'defend' });
    expect(act).toHaveBeenCalledWith({ type: 'battleAction', action: 'skill' });
  });

  it('lists consumables as Item buttons only', () => {
    const s = pvp();
    const cons = Object.values(ITEMS).find((i) => i.kind === 'consumable')!;
    const eq = Object.values(ITEMS).find((i) => i.kind === 'equipment')!;
    const player = { ...me(s), inventory: [cons.id, eq.id] };
    const act = vi.fn();
    const el = renderBattle(s, player, [], act);
    const items = btns(el).filter((b) => b.textContent!.startsWith('Item: '));
    expect(items.length).toBe(1);
    items[0].click();
    expect(act).toHaveBeenCalledWith({ type: 'battleAction', action: 'item', itemId: cons.id });
  });

  it('non-attacker sees waiting text and no buttons', () => {
    const s = pvp();
    const el = renderBattle(s, me(s, 'p2'), [], vi.fn());
    expect(el.textContent).toContain('Waiting for Ann to act');
    expect(btns(el).length).toBe(0);
  });

  it('renders round events and returns empty root without a battle', () => {
    const s = pvp();
    const el = renderBattle(s, me(s), [{ type: 'defend', playerId: 'p2' } as never], vi.fn());
    expect(el.querySelector('.round-events')!.textContent).toContain('Bob defends');
    const none = renderBattle({ ...s, battle: undefined } as never, me(s), [], vi.fn());
    expect(none.children.length).toBe(0);
  });
});

describe('renderShop', () => {
  const at = (gold: number, inventory: string[] = []): Player => {
    const s = game();
    const tile = Object.values(s.tiles).find((t) => t.kind === 'shop')!;
    return { ...me(s), tileId: tile.id, gold, inventory } as Player;
  };

  it('with no gold: warns, disables all Buy, still allows Leave', () => {
    const act = vi.fn();
    const el = renderShop(at(0), act);
    expect(el.textContent).toContain('You cannot afford anything here.');
    const buys = btns(el).filter((b) => b.textContent === 'Buy');
    expect(buys.length).toBeGreaterThan(0);
    expect(buys.every((b) => b.disabled)).toBe(true);
    byText(el, 'Leave')!.click();
    expect(act).toHaveBeenCalledWith({ type: 'leaveShop' });
  });

  it('with plenty of gold: Buy enabled and emits buy', () => {
    const p = at(9999);
    const act = vi.fn();
    const el = renderShop(p, act);
    expect(el.textContent).not.toContain('cannot afford');
    const buys = btns(el).filter((b) => b.textContent === 'Buy');
    expect(buys.every((b) => !b.disabled)).toBe(true);
    buys[0].click();
    expect(act).toHaveBeenCalledWith({ type: 'buy', itemId: shopStock(p.tileId)[0] });
  });

  it('shows Sell for inventory items and emits sell', () => {
    const id = Object.keys(ITEMS)[0];
    const act = vi.fn();
    const el = renderShop(at(0, [id]), act);
    byText(el, 'Sell')!.click();
    expect(act).toHaveBeenCalledWith({ type: 'sell', itemId: id });
    expect(byText(renderShop(at(0), vi.fn()), 'Sell')).toBeUndefined();
  });

  it('modText formats signed mods', () => {
    expect(modText({ mods: { atk: 2, def: -1 } } as never)).toBe('+2 atk, -1 def');
  });
});

describe('renderTown', () => {
  const player = (gold: number): Player => ({ ...me(game()), gold }) as Player;
  const town = (ownerId: string | null, level: number) => ({ tileId: 't', ownerId, level, income: 10 }) as never;

  it('owner: Upgrade enabled with gold, disabled without or at max level', () => {
    const act = vi.fn();
    const ok = renderTown(player(80), town('p1', 1), act);
    const up = byText(ok, /^Upgrade \(80g\)/)!;
    expect(up.disabled).toBe(false);
    up.click();
    expect(act).toHaveBeenCalledWith({ type: 'upgradeTown' });
    expect(byText(renderTown(player(79), town('p1', 1), act), /^Upgrade/)!.disabled).toBe(true);
    expect(byText(renderTown(player(9999), town('p1', 3), act), /^Upgrade/)!.disabled).toBe(true);
  });

  it('rival-owned: Capture priced by level, disabled when poor', () => {
    const act = vi.fn();
    const el = renderTown(player(300), town('p2', 2), act);
    const cap = byText(el, 'Capture (300g)')!;
    expect(cap.disabled).toBe(false);
    cap.click();
    expect(act).toHaveBeenCalledWith({ type: 'captureTown' });
    expect(byText(renderTown(player(299), town('p2', 2), act), /^Capture/)!.disabled).toBe(true);
  });

  it('unowned or missing town: only Leave', () => {
    for (const t of [town(null, 1), undefined]) {
      const act = vi.fn();
      const el = renderTown(player(999), t, act);
      expect(btns(el).map((b) => b.textContent)).toEqual(['Leave']);
      btns(el)[0].click();
      expect(act).toHaveBeenCalledWith({ type: 'leaveTown' });
    }
  });
});

describe('renderInventory', () => {
  it('shows Empty with no items and equipment slots', () => {
    const el = renderInventory(me(game()), vi.fn());
    expect(el.querySelector('.items')!.textContent).toBe('Empty');
    expect(el.querySelectorAll('.equipped li').length).toBe(3);
  });

  it('Equip for equipment and Use for consumables emit the right actions', () => {
    const cons = Object.values(ITEMS).find((i) => i.kind === 'consumable')!;
    const eq = Object.values(ITEMS).find((i) => i.kind === 'equipment')!;
    const p = { ...me(game()), inventory: [eq.id, cons.id] } as Player;
    const act = vi.fn();
    const el = renderInventory(p, act);
    byText(el, 'Equip')!.click();
    byText(el, 'Use')!.click();
    expect(act).toHaveBeenCalledWith({ type: 'equip', itemId: eq.id });
    expect(act).toHaveBeenCalledWith({ type: 'useItem', itemId: cons.id });
  });
});

describe('renderGameOver', () => {
  it('names the winner and ranks every player', () => {
    const s = { ...publicState(game()), phase: 'game-over', winnerId: 'p2' } as PublicGameState;
    const el = renderGameOver(s);
    expect(el.querySelector('.winner-banner')!.textContent).toBe('Bob wins!');
    expect(el.querySelectorAll('.ranking li').length).toBe(2);
  });
  it('falls back to Game over without a winner', () => {
    const s = { ...publicState(game()), phase: 'game-over', winnerId: null } as PublicGameState;
    expect(renderGameOver(s).querySelector('.winner-banner')!.textContent).toBe('Game over');
  });
});
