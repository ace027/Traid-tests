import type { GameEvent } from '../engine';
import type { LobbySeat, PublicGameState, ServerMessage } from '../shared/protocol';

export type LobbyMessage = Extract<ServerMessage, { t: 'lobby' }>;
export type { LobbySeat };

export type ClientState = {
  connection: 'connecting' | 'open' | 'closed';
  code: string | null;
  playerId: string | null;
  token: string | null;
  lobby: LobbyMessage | null;
  state: PublicGameState | null;
  lastEvents: GameEvent[];
  error: string | null;
};

export interface Store {
  get(): ClientState;
  set(partial: Partial<ClientState>): void;
  subscribe(fn: (s: ClientState) => void): () => void;
}

export function initialState(): ClientState {
  return {
    connection: 'connecting',
    code: null,
    playerId: null,
    token: null,
    lobby: null,
    state: null,
    lastEvents: [],
    error: null,
  };
}

export function createStore(): Store {
  let current = initialState();
  const subs = new Set<(s: ClientState) => void>();
  return {
    get: () => current,
    set(partial) {
      current = { ...current, ...partial };
      for (const fn of [...subs]) fn(current);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export function reduceServerMessage(state: ClientState, msg: ServerMessage): ClientState {
  switch (msg.t) {
    case 'joined':
      return { ...state, code: msg.code, token: msg.token, playerId: msg.playerId, error: null };
    case 'lobby':
      return { ...state, lobby: msg, code: msg.code, error: null };
    case 'state':
      return { ...state, state: msg.state, lastEvents: msg.events, error: null };
    case 'error':
      return { ...state, error: msg.message };
    case 'pong':
      return state;
  }
}
