import { nextInt } from './rng';
import { LAST_WEEK, isBossEnabled } from './calendar';
import type { GameEvent, GameState, Player } from './types';

export const CLAIM_COST = 100;
export const HEAL_FRACTION = 0.3;

export function rollDice(rngState: number): { value: number; rngState: number } {
  const [value, next] = nextInt(rngState, 1, 6);
  return { value, rngState: next };
}

function findPlayer(state: GameState, playerId: string): Player {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`unknown player ${playerId}`);
  return p;
}

export function stepsAvailable(state: GameState, playerId: string): string[] {
  const p = findPlayer(state, playerId);
  const tile = state.tiles[p.tileId];
  return tile ? [...tile.next] : [];
}

/** Move one step to tileId (must be in stepsAvailable). Enabled boss tile ends movement. */
export function movePlayer(
  state: GameState,
  playerId: string,
  tileId: string,
): GameState {
  if (!stepsAvailable(state, playerId).includes(tileId)) {
    throw new Error(`tile ${tileId} is not reachable for ${playerId}`);
  }
  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, tileId } : p,
  );
  const stopsHere = state.tiles[tileId]?.kind === 'boss' && isBossEnabled(state);
  return {
    ...state,
    players,
    pendingMoves: stopsHere ? 0 : Math.max(0, state.pendingMoves - 1),
  };
}

/** Auto-advance through single-option tiles until a choice or no moves remain. */
export function autoAdvance(state: GameState, playerId: string): GameState {
  let s = state;
  while (s.pendingMoves > 0) {
    const steps = stepsAvailable(s, playerId);
    if (steps.length !== 1) break;
    s = movePlayer(s, playerId, steps[0]);
  }
  return s;
}

function setPlayer(state: GameState, player: Player): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === player.id ? player : p)),
  };
}

/** Placeholder monster id per tier; content wiring maps it to a Monster. */
export function monsterIdForTier(tier: number): string {
  return `monster-tier-${tier}`;
}

export function resolveTile(state: GameState): {
  state: GameState;
  events: GameEvent[];
} {
  const player = state.players[state.turnIndex];
  const tile = player && state.tiles[player.tileId];
  const endTurn = (s: GameState) => ({ ...s, phase: 'end-turn' as const });
  if (!player || !tile) return { state: endTurn(state), events: [] };
  const events: GameEvent[] = [];
  let s = state;

  switch (tile.kind) {
    case 'monster':
    case 'boss': {
      if (tile.kind === 'boss' && !isBossEnabled(state)) {
        return { state: endTurn(s), events };
      }
      const defenderId =
        tile.kind === 'boss' ? 'boss' : monsterIdForTier(Math.min(LAST_WEEK, state.week));
      s = {
        ...s,
        phase: 'battle',
        battle: {
          attackerId: player.id,
          defender: { kind: 'monster', id: defenderId },
          round: 1,
        },
      };
      events.push({ type: 'battle-start', playerId: player.id, monsterId: defenderId });
      return { state: s, events };
    }
    case 'shop':
      events.push({ type: 'shop-enter', playerId: player.id });
      return { state: { ...s, phase: 'shop' }, events };
    case 'heal': {
      const amount = Math.floor(player.stats.maxHp * HEAL_FRACTION);
      const hp = Math.min(player.stats.maxHp, player.stats.hp + amount);
      s = setPlayer(s, { ...player, stats: { ...player.stats, hp } });
      events.push({ type: 'heal', playerId: player.id, amount: hp - player.stats.hp });
      return { state: endTurn(s), events };
    }
    case 'event': {
      const [sign, r1] = nextInt(s.rngState, 0, 1);
      const [amt, r2] = nextInt(r1, 10, 50);
      const delta = sign === 0 ? amt : -amt;
      const gold = Math.max(0, player.gold + delta);
      s = setPlayer({ ...s, rngState: r2 }, { ...player, gold });
      events.push({ type: 'event-gold', playerId: player.id, delta: gold - player.gold });
      return { state: endTurn(s), events };
    }
    case 'town': {
      const town = s.towns[tile.id];
      if (!town) return { state: endTurn(s), events };
      if (town.ownerId === null) {
        if (player.gold >= CLAIM_COST) {
          s = setPlayer(
            { ...s, towns: { ...s.towns, [tile.id]: { ...town, ownerId: player.id } } },
            { ...player, gold: player.gold - CLAIM_COST },
          );
          events.push({ type: 'town-claim', playerId: player.id, tileId: tile.id, cost: CLAIM_COST });
        }
      } else if (town.ownerId !== player.id) {
        const toll = Math.min(player.gold, town.income * town.level);
        s = {
          ...s,
          players: s.players.map((p) => {
            if (p.id === player.id) return { ...p, gold: p.gold - toll };
            if (p.id === town.ownerId) return { ...p, gold: p.gold + toll };
            return p;
          }),
        };
        events.push({ type: 'town-toll', playerId: player.id, ownerId: town.ownerId, amount: toll });
      }
      return { state: endTurn(s), events };
    }
    default:
      return { state: endTurn(s), events };
  }
}

