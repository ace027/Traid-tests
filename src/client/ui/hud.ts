import { CLASSES, computeScore, stepsAvailable, type Action } from '../../engine';
import type { ClientMessage, PublicGameState } from '../../shared/protocol';
import * as board from '../render/board';
import type { Store } from '../store';
import { renderBattle } from './battle';
import { renderGameOver } from './gameover';
import { renderInventory } from './inventory';
import { renderLog } from './log';
import { renderShop } from './shop';
import { renderTown } from './town';
import './hud.css';

function div(cls: string, tag: 'div' | 'ul' | 'p' = 'div'): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export function mountHud(root: HTMLElement, store: Store, send: (m: ClientMessage) => void): void {
  const act = (action: Action) => send({ t: 'action', action });

  const top = div('hud-top panel');
  const side = div('hud-side panel');
  const ctx = div('hud-context panel');
  const logBox = div('hud-log panel');
  const logList = div('log-list', 'ul');
  logBox.append(logList);
  const invBox = div('hud-inventory panel');
  const invToggle = document.createElement('button');
  invToggle.textContent = 'Inventory';
  let invOpen = false;
  invToggle.addEventListener('click', () => {
    invOpen = !invOpen;
    render();
  });
  root.append(top, side, ctx, logBox, invToggle, invBox);

  // Board (plan 03-02) exposes setPathHandler; tolerate its absence.
  const setPathHandler = (board as Record<string, unknown>).setPathHandler as
    | ((fn: ((tileId: string) => void) | null) => void)
    | undefined;
  setPathHandler?.((tileId: string) => act({ type: 'choosePath', tileId }));

  function context(state: PublicGameState, myId: string | null): HTMLElement[] {
    const me = state.players.find((p) => p.id === myId);
    const current = state.players[state.turnIndex];
    if (state.phase === 'game-over') return [renderGameOver(state)];
    const out: HTMLElement[] = [];
    if (me?.defeated) {
      const n = div('notice', 'p');
      n.textContent = 'You were defeated. You will respawn at the start tile with half HP at the end of the day.';
      out.push(n);
    }
    if (state.phase === 'battle' && me) {
      out.push(renderBattle(state, me, store.get().lastEvents, act));
      return out;
    }
    if (!me || !current || current.id !== me.id) {
      const w = div('waiting', 'p');
      w.textContent = `Waiting for ${current?.name ?? 'other players'}`;
      out.push(w);
      return out;
    }
    const button = (label: string, a: Action) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => act(a));
      return b;
    };
    switch (state.phase) {
      case 'roll':
        out.push(button('Roll', { type: 'roll' }));
        break;
      case 'choose-path': {
        const p = div('prompt', 'p');
        p.textContent = 'Choose a highlighted tile';
        out.push(p);
        for (const id of stepsAvailable(state as never, me.id)) {
          out.push(button(`Go to ${id}`, { type: 'choosePath', tileId: id }));
        }
        break;
      }
      case 'shop':
        out.push(renderShop(me, act));
        break;
      case 'town':
        out.push(renderTown(me, state.towns[me.tileId], act));
        break;
      case 'end-turn':
        out.push(button('End Turn', { type: 'endTurn' }));
        break;
      default: {
        const p = div('waiting', 'p');
        p.textContent = '...';
        out.push(p);
      }
    }
    return out;
  }

  function render(): void {
    const s = store.get();
    const state = s.state;
    if (!state) return;
    const me = state.players.find((p) => p.id === s.playerId);
    const current = state.players[state.turnIndex];

    top.textContent = '';
    const parts = [`Week ${state.week}, Day ${state.day}`, `Turn: ${current?.name ?? '-'}`];
    if (me) parts.push(`Gold ${me.gold}`, `HP ${me.stats.hp}/${me.stats.maxHp}`, `Lv ${me.level}`);
    for (const t of parts) {
      const span = document.createElement('span');
      span.textContent = t;
      top.append(span);
    }

    side.textContent = '';
    for (const p of state.players) {
      const row = div(p.id === current?.id ? 'score-row current' : 'score-row');
      const towns = Object.values(state.towns).filter((t) => t.ownerId === p.id).length;
      row.textContent = `${p.name} (${CLASSES[p.classId].name}) - ${p.gold}g, ${towns} towns, score ${computeScore(state as never, p.id)}`;
      side.append(row);
    }

    ctx.textContent = '';
    ctx.append(...context(state, s.playerId));

    renderLog(logList, state, s.lastEvents);

    const canInv = !!me && state.phase !== 'battle' && state.phase !== 'choose-path' && state.phase !== 'game-over';
    invToggle.hidden = !canInv;
    invBox.hidden = !(canInv && invOpen);
    invBox.textContent = '';
    if (canInv && invOpen && me) invBox.append(renderInventory(me, act));
  }

  store.subscribe(render);
  render();
}
