import { randomInt, randomUUID } from 'node:crypto';
import { applyAction, createGame, CLASSES, MAX_PLAYERS, MIN_PLAYERS } from '../engine';
import type { Action, ClassId, GameEvent, GameState } from '../engine';
import { CODE_PATTERN, MAX_NAME_LENGTH } from '../shared/protocol';
import type { ServerMessage } from '../shared/protocol';

export const MAX_ROOMS = 200;
export const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_ATTEMPTS = 50;

export interface Seat {
  playerId: string;
  token: string;
  name: string;
  classId: ClassId;
  connected: boolean;
}

export interface Room {
  code: string;
  hostId: string;
  seats: Seat[];
  state: GameState | null;
  createdAt: number;
  emptySince: number | null;
}

export type LobbyView = Extract<ServerMessage, { t: 'lobby' }>;
type SeatResult = { room: Room; seat: Seat } | { error: string };

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private now: () => number = Date.now) {}

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  create(name: string, classId: ClassId): SeatResult {
    if (this.rooms.size >= MAX_ROOMS) return { error: 'Server is full, try again later' };
    if (!CLASSES[classId]) return { error: 'Unknown class' };
    const code = this.newCode();
    if (!code) return { error: 'Could not allocate a room code' };
    const seat = this.makeSeat(name, classId, []);
    const room: Room = {
      code,
      hostId: seat.playerId,
      seats: [seat],
      state: null,
      createdAt: this.now(),
      emptySince: null,
    };
    this.rooms.set(code, room);
    return { room, seat };
  }

  join(code: string, name: string, classId: ClassId): SeatResult {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.state) return { error: 'Game already started' };
    if (room.seats.length >= MAX_PLAYERS) return { error: 'Room is full' };
    if (!CLASSES[classId]) return { error: 'Unknown class' };
    const seat = this.makeSeat(name, classId, room.seats);
    room.seats.push(seat);
    room.emptySince = null;
    return { room, seat };
  }

  rejoin(code: string, token: string): SeatResult {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    const seat = room.seats.find((s) => s.token === token);
    if (!seat) return { error: 'Invalid session token' };
    seat.connected = true;
    room.emptySince = null;
    return { room, seat };
  }

  setClass(code: string, playerId: string, classId: ClassId): { error?: string } {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.state) return { error: 'Game already started' };
    if (!CLASSES[classId]) return { error: 'Unknown class' };
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) return { error: 'Not seated in this room' };
    seat.classId = classId;
    return {};
  }

  start(code: string, playerId: string, seed?: number): { error?: string } {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.state) return { error: 'Game already started' };
    if (room.hostId !== playerId) return { error: 'Only the host can start the game' };
    if (room.seats.length < MIN_PLAYERS) {
      return { error: `Need at least ${MIN_PLAYERS} players to start` };
    }
    try {
      room.state = createGame({
        seed: seed ?? randomInt(2 ** 31),
        players: room.seats.map((s) => ({ id: s.playerId, name: s.name, classId: s.classId })),
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    return {};
  }

  act(
    code: string,
    playerId: string,
    action: Action,
  ): { state: GameState | null; events: GameEvent[]; error?: string } {
    const room = this.rooms.get(code);
    if (!room) return { state: null, events: [], error: 'Room not found' };
    if (!room.state) return { state: null, events: [], error: 'Game has not started' };
    if (!room.seats.some((s) => s.playerId === playerId)) {
      return { state: room.state, events: [], error: 'Not seated in this room' };
    }
    const result = applyAction(room.state, playerId, action);
    if (!result.error) room.state = result.state;
    return result;
  }

  disconnect(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) return;
    if (room.state) {
      seat.connected = false;
    } else {
      // Lobby: free the seat and hand the host role on.
      room.seats = room.seats.filter((s) => s !== seat);
      if (room.seats.length === 0) {
        this.rooms.delete(code);
        return;
      }
      if (room.hostId === playerId) {
        const next = room.seats.find((s) => s.connected) ?? room.seats[0];
        room.hostId = next.playerId;
      }
    }
    if (!room.seats.some((s) => s.connected) && room.emptySince === null) {
      room.emptySince = this.now();
    }
  }

  sweep(now: number = this.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  lobbyView(code: string): LobbyView | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    return {
      t: 'lobby',
      code: room.code,
      hostId: room.hostId,
      seats: room.seats.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        classId: s.classId,
        connected: s.connected,
      })),
    };
  }

  private newCode(): string | null {
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
      if (CODE_PATTERN.test(code) && !this.rooms.has(code)) return code;
    }
    return null;
  }

  private makeSeat(name: string, classId: ClassId, existing: Seat[]): Seat {
    return {
      playerId: randomUUID(),
      token: randomUUID(),
      name: uniqueName(name.trim(), existing),
      classId,
      connected: true,
    };
  }
}

function uniqueName(base: string, existing: Seat[]): string {
  const taken = new Set(existing.map((s) => s.name.toLowerCase()));
  const root = base.slice(0, MAX_NAME_LENGTH) || 'Player';
  let name = root;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = String(n);
    name = root.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
  }
  return name;
}
