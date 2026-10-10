import { ITEMS, type GameEvent } from '../../engine';
import type { PublicGameState } from '../../shared/protocol';

const MAX_LOG = 50;

function nameOf(state: PublicGameState, id: unknown): string {
  if (typeof id !== 'string') return 'someone';
  return state.players.find((p) => p.id === id)?.name ?? id;
}

function itemName(id: unknown): string {
  return typeof id === 'string' ? (ITEMS[id]?.name ?? id) : 'an item';
}

/** Human-readable text for a game event; null when the event is not worth showing. */
export function describeEvent(state: PublicGameState, e: GameEvent): string | null {
  const who = nameOf(state, e.playerId);
  switch (e.type) {
    case 'roll':
      return `${who} rolled a ${String(e.value)}`;
    case 'damage':
      return `${nameOf(state, e.source)} hit ${nameOf(state, e.target)} for ${String(e.amount)}${e.crit ? ' (critical!)' : ''}`;
    case 'defend':
      return `${who} defends`;
    case 'heal':
      return `${who} recovers ${String(e.amount)} HP`;
    case 'steal':
      return `${nameOf(state, e.to)} stole ${String(e.amount)} gold from ${nameOf(state, e.from)}`;
    case 'item':
      return `${who} uses ${itemName(e.itemId)}`;
    case 'flee-failed':
      return `${who} failed to flee`;
    case 'battle-end':
      if (e.result === 'fled') return `${who} fled the battle`;
      return e.result === 'win' ? 'The battle is won' : 'The battle is lost';
    case 'loot':
      return `${who} found ${itemName(e.itemId)}`;
    case 'level-up':
      return `${who} reached level ${String(e.level)}`;
    case 'pvp-start':
      return `${nameOf(state, e.attackerId)} attacks ${nameOf(state, e.defenderId)}`;
    case 'town-upgrade':
      return `${who} upgraded a town to level ${String(e.level)}`;
    case 'town-capture':
      return `${who} captured a town`;
    case 'boss-defeated':
      return `${who} defeated the boss`;
    case 'item-stolen':
      return `${nameOf(state, e.to)} took ${itemName(e.itemId)}`;
    default:
      return null;
  }
}

export function describeEvents(state: PublicGameState, events: GameEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const t = describeEvent(state, e);
    if (t) out.push(t);
  }
  return out;
}

export function renderLog(
  list: HTMLElement,
  state: PublicGameState,
  events: GameEvent[],
): void {
  const lines = [...state.log, ...describeEvents(state, events).filter((l) => !state.log.includes(l))].slice(-MAX_LOG);
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  list.textContent = '';
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
}
