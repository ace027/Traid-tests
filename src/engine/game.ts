import type {
  Action,
  ClassId,
  GameEvent,
  GameState,
  Player,
} from './types';
import { createRng, nextInt } from './rng';
import { buildDefaultMap, buildDefaultTowns } from './map';
import {
  autoAdvance,
  CAPTURE_COST_PER_LEVEL,
  MAX_TOWN_LEVEL,
  movePlayer,
  resolveTile,
  rollDice,
  stepsAvailable,
  UPGRADE_COST_PER_LEVEL,
} from './movement';
import { advanceTurn, getStartTileId } from './calendar';
import { resolveBattleAction, startMonsterBattle, startPlayerBattle } from './combat';
import { buyItem, equipItem, sellItem, useItem } from './inventory';
import { CLASSES } from './data/classes';
import { BOSS_ID, monstersForTier } from './data/monsters';

export const STARTING_GOLD = 100;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export interface CreateGameOptions {
  seed: number;
  players: { id: string; name: string; classId: ClassId }[];
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  error?: string;
}

export function createGame(opts: CreateGameOptions): GameState {
  const { seed, players } = opts;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`A game needs ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${players.length}`);
  }
  const ids = new Set<string>();
  for (const p of players) {
    if (!p.id) throw new Error('Player id must not be empty');
    if (ids.has(p.id)) throw new Error(`Duplicate player id ${p.id}`);
    ids.add(p.id);
    if (!CLASSES[p.classId]) throw new Error(`Unknown class ${String(p.classId)}`);
  }
  const tiles = buildDefaultMap();
  const startTileId = getStartTileId(tiles);
  return {
    seed,
    rngState: createRng(seed),
    players: players.map(
      (p): Player => ({
        id: p.id,
        name: p.name,
        classId: p.classId,
        stats: { ...CLASSES[p.classId].base },
        gold: STARTING_GOLD,
        tileId: startTileId,
        inventory: [],
        equipment: {},
        level: 1,
        xp: 0,
        defeated: false,
      }),
    ),
    turnIndex: 0,
    day: 1,
    week: 1,
    phase: 'roll',
    tiles,
    towns: buildDefaultTowns(tiles),
    pendingMoves: 0,
    battle: null,
    log: [],
    winnerId: null,
  };
}

function fail(state: GameState, error: string): ApplyResult {
  return { state, events: [], error };
}

/** After a state change: if it is end-turn and the current player was defeated, pass the turn. */
function settle(state: GameState, events: GameEvent[]): ApplyResult {
  let s = state;
  if (s.phase === 'end-turn' && s.players[s.turnIndex]?.defeated) {
    events.push({ type: 'auto-end-turn', playerId: s.players[s.turnIndex].id });
    s = advanceTurn(s);
  }
  return { state: s, events };
}

/** Replace the placeholder monster id from resolveTile with a real monster. */
function realiseMonsterBattle(state: GameState, events: GameEvent[]): GameState {
  if (state.phase !== 'battle' || !state.battle) return state;
  const b = state.battle;
  if (b.defender.kind !== 'monster') return state;
  let monsterId = b.defender.id;
  let s: GameState = { ...state, battle: null };
  if (monsterId === 'boss') {
    monsterId = BOSS_ID;
  } else {
    const m = /^monster-tier-(\d+)$/.exec(monsterId);
    if (m) {
      const tier = Math.min(3, Math.max(1, Number(m[1]))) as 1 | 2 | 3;
      const pool = monstersForTier(tier);
      if (pool.length === 0) throw new Error(`No monsters for tier ${tier}`);
      const [idx, rng] = nextInt(s.rngState, 0, pool.length - 1);
      monsterId = pool[idx].id;
      s = { ...s, rngState: rng };
    }
  }
  for (const e of events) {
    if (e.type === 'battle-start') e.monsterId = monsterId;
  }
  return startMonsterBattle(s, b.attackerId, monsterId);
}

/** Called when the mover has no moves left: PvP if sharing a tile, otherwise resolve the tile. */
function finishMovement(state: GameState, events: GameEvent[]): GameState {
  const mover = state.players[state.turnIndex];
  const tile = state.tiles[mover.tileId];
  if (tile && tile.kind !== 'start') {
    const rival = state.players.find(
      (p) => p.id !== mover.id && !p.defeated && p.tileId === mover.tileId,
    );
    if (rival) {
      events.push({ type: 'pvp-start', attackerId: mover.id, defenderId: rival.id });
      return startPlayerBattle({ ...state, pendingMoves: 0 }, mover.id, rival.id);
    }
  }
  const res = resolveTile({ ...state, pendingMoves: 0 });
  events.push(...res.events);
  return realiseMonsterBattle(res.state, events);
}

function afterStep(state: GameState, events: GameEvent[], playerId: string): GameState {
  const s = autoAdvance(state, playerId);
  events.push({ type: 'move', playerId, tileId: s.players[s.turnIndex].tileId, remaining: s.pendingMoves });
  if (s.pendingMoves > 0 && stepsAvailable(s, playerId).length > 0) {
    return { ...s, phase: 'choose-path' };
  }
  return finishMovement(s, events);
}

function dispatch(state: GameState, playerId: string, action: Action): ApplyResult {
  const events: GameEvent[] = [];
  const phase = state.phase;
  switch (action.type) {
    case 'roll': {
      if (phase !== 'roll') return fail(state, `Cannot roll during phase ${phase}`);
      const { value, rngState } = rollDice(state.rngState);
      events.push({ type: 'roll', playerId, value });
      const s = afterStep({ ...state, rngState, pendingMoves: value }, events, playerId);
      return settle(s, events);
    }
    case 'choosePath': {
      if (phase !== 'choose-path') return fail(state, `Cannot choose a path during phase ${phase}`);
      const s = afterStep(movePlayer(state, playerId, action.tileId), events, playerId);
      return settle(s, events);
    }
    case 'battleAction': {
      if (phase !== 'battle') return fail(state, 'No battle in progress');
      if (state.battle?.attackerId !== playerId) return fail(state, 'Not your battle');
      const res = resolveBattleAction(state, action);
      events.push(...res.events);
      return settle(res.state, events);
    }
    case 'buy':
    case 'sell': {
      if (phase !== 'shop') return fail(state, 'Not in a shop');
      const r =
        action.type === 'buy'
          ? buyItem(state, playerId, action.itemId)
          : sellItem(state, playerId, action.itemId);
      if (r.error) return fail(state, r.error);
      events.push({ type: action.type, playerId, itemId: action.itemId });
      return { state: r.state, events };
    }
    case 'equip':
    case 'useItem': {
      if (phase === 'battle' || phase === 'choose-path') {
        return fail(state, `Cannot do that during phase ${phase}`);
      }
      const r =
        action.type === 'equip'
          ? equipItem(state, playerId, action.itemId)
          : useItem(state, playerId, action.itemId);
      if (r.error) return fail(state, r.error);
      events.push({ type: action.type, playerId, itemId: action.itemId });
      return { state: r.state, events };
    }
    case 'leaveShop': {
      if (phase !== 'shop') return fail(state, 'Not in a shop');
      events.push({ type: 'leave-shop', playerId });
      return { state: { ...state, phase: 'end-turn' }, events };
    }
    case 'upgradeTown':
    case 'captureTown':
    case 'leaveTown': {
      if (phase !== 'town') return fail(state, 'Not in a town');
      const me = state.players.find((p) => p.id === playerId);
      const tileId = me?.tileId ?? '';
      const town = state.towns[tileId];
      if (!me || !town) return fail(state, 'No town here');
      if (action.type === 'leaveTown') {
        events.push({ type: 'leave-town', playerId });
        return { state: { ...state, phase: 'end-turn' }, events };
      }
      if (action.type === 'upgradeTown') {
        if (town.ownerId !== playerId) return fail(state, 'You do not own this town');
        if (town.level >= MAX_TOWN_LEVEL) return fail(state, 'Town is already at max level');
        const cost = UPGRADE_COST_PER_LEVEL * town.level;
        if (me.gold < cost) return fail(state, 'Not enough gold to upgrade');
        const level = town.level + 1;
        events.push({ type: 'town-upgrade', playerId, tileId, level, cost });
        return {
          state: {
            ...state,
            phase: 'end-turn',
            towns: { ...state.towns, [tileId]: { ...town, level } },
            players: state.players.map((p) => (p.id === playerId ? { ...p, gold: p.gold - cost } : p)),
          },
          events,
        };
      }
      if (town.ownerId === null || town.ownerId === playerId) {
        return fail(state, 'You can only capture a rival town');
      }
      const cost = CAPTURE_COST_PER_LEVEL * town.level;
      if (me.gold < cost) return fail(state, 'Not enough gold to capture');
      const oldOwner = town.ownerId;
      events.push({ type: 'town-capture', playerId, fromId: oldOwner, tileId, cost });
      return {
        state: {
          ...state,
          phase: 'end-turn',
          towns: { ...state.towns, [tileId]: { ...town, ownerId: playerId } },
          players: state.players.map((p) => {
            if (p.id === playerId) return { ...p, gold: p.gold - cost };
            if (p.id === oldOwner) return { ...p, gold: p.gold + cost };
            return p;
          }),
        },
        events,
      };
    }
    case 'endTurn': {
      if (phase !== 'end-turn') return fail(state, `Cannot end turn during phase ${phase}`);
      events.push({ type: 'end-turn', playerId });
      return { state: advanceTurn(state), events };
    }
    default:
      return fail(state, 'Unknown action');
  }
}

export function applyAction(state: GameState, playerId: string, action: Action): ApplyResult {
  if (state.phase === 'game-over') return fail(state, 'The game is over');
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return fail(state, 'Malformed action');
  }
  const current = state.players[state.turnIndex];
  if (!current || current.id !== playerId) return fail(state, `It is not ${playerId}'s turn`);
  try {
    return dispatch(state, playerId, action);
  } catch (e) {
    return fail(state, e instanceof Error ? e.message : String(e));
  }
}
