import type { Action, ClassId, GameEvent, GameState } from '../engine';
import { CLASSES } from '../engine';

/** GameState as sent to clients: RNG internals stay server-side. */
export type PublicGameState = Omit<GameState, 'seed' | 'rngState'>;

export function publicState(state: GameState): PublicGameState {
  const { seed: _seed, rngState: _rngState, ...pub } = state;
  return pub;
}

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_NAME_LENGTH = 16;
export const CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/;

const ACTION_TYPE_MAP: Record<Action['type'], true> = {
  roll: true,
  choosePath: true,
  battleAction: true,
  buy: true,
  sell: true,
  useItem: true,
  equip: true,
  leaveShop: true,
  upgradeTown: true,
  captureTown: true,
  leaveTown: true,
  endTurn: true,
};
export const ACTION_TYPES = Object.keys(ACTION_TYPE_MAP) as Action['type'][];

const BATTLE_ACTIONS = ['attack', 'defend', 'skill', 'item', 'flee'] as const;
const MAX_ID_LENGTH = 64;
const MAX_TOKEN_LENGTH = 64;

export interface LobbySeat {
  playerId: string;
  name: string;
  classId: ClassId;
  connected: boolean;
}

export type ClientMessage =
  | { t: 'create'; name: string; classId: ClassId }
  | { t: 'join'; code: string; name: string; classId: ClassId }
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'setClass'; classId: ClassId }
  | { t: 'start' }
  | { t: 'action'; action: Action }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'joined'; code: string; token: string; playerId: string }
  | { t: 'lobby'; code: string; hostId: string; seats: LobbySeat[] }
  | { t: 'state'; state: PublicGameState; events: GameEvent[] }
  | { t: 'error'; message: string }
  | { t: 'pong' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = v.trim();
  return n.length >= 1 && n.length <= MAX_NAME_LENGTH ? n : null;
}

function parseClassId(v: unknown): ClassId | null {
  if (typeof v !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(CLASSES, v) ? (v as ClassId) : null;
}

function parseCode(v: unknown): string | null {
  return typeof v === 'string' && CODE_PATTERN.test(v) ? v : null;
}

function parseBoundedString(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length >= 1 && v.length <= max ? v : null;
}

function parseAction(v: unknown): Action | null {
  if (!isRecord(v) || typeof v.type !== 'string') return null;
  if (!(ACTION_TYPES as readonly string[]).includes(v.type)) return null;
  switch (v.type) {
    case 'roll':
    case 'leaveShop':
    case 'upgradeTown':
    case 'captureTown':
    case 'leaveTown':
    case 'endTurn':
      return { type: v.type };
    case 'choosePath': {
      const tileId = parseBoundedString(v.tileId, MAX_ID_LENGTH);
      return tileId ? { type: 'choosePath', tileId } : null;
    }
    case 'battleAction': {
      if (typeof v.action !== 'string' || !(BATTLE_ACTIONS as readonly string[]).includes(v.action)) {
        return null;
      }
      const action = v.action as (typeof BATTLE_ACTIONS)[number];
      if (v.itemId === undefined) return { type: 'battleAction', action };
      const itemId = parseBoundedString(v.itemId, MAX_ID_LENGTH);
      return itemId ? { type: 'battleAction', action, itemId } : null;
    }
    case 'buy':
    case 'sell':
    case 'useItem':
    case 'equip': {
      const itemId = parseBoundedString(v.itemId, MAX_ID_LENGTH);
      return itemId ? { type: v.type, itemId } : null;
    }
    default: {
      const _exhaustive: never = v.type as never;
      return _exhaustive;
    }
  }
}

export function parseClientMessage(raw: string): ClientMessage | null {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.t !== 'string') return null;
  switch (data.t) {
    case 'create': {
      const name = parseName(data.name);
      const classId = parseClassId(data.classId);
      return name && classId ? { t: 'create', name, classId } : null;
    }
    case 'join': {
      const code = parseCode(data.code);
      const name = parseName(data.name);
      const classId = parseClassId(data.classId);
      return code && name && classId ? { t: 'join', code, name, classId } : null;
    }
    case 'rejoin': {
      const code = parseCode(data.code);
      const token = parseBoundedString(data.token, MAX_TOKEN_LENGTH);
      return code && token ? { t: 'rejoin', code, token } : null;
    }
    case 'setClass': {
      const classId = parseClassId(data.classId);
      return classId ? { t: 'setClass', classId } : null;
    }
    case 'start':
      return { t: 'start' };
    case 'ping':
      return { t: 'ping' };
    case 'action': {
      const action = parseAction(data.action);
      return action ? { t: 'action', action } : null;
    }
    default:
      return null;
  }
}
