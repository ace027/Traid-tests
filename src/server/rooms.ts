import { randomInt, randomUUID } from 'node:crypto';
import { applyAction, chooseBotAction, createGame, CLASSES, MAX_PLAYERS, MIN_PLAYERS } from '../engine';
import type { Action, ClassId, GameEvent, GameState } from '../engine';
import { CODE_PATTERN, MAX_NAME_LENGTH } from '../shared/protocol';
import type { ServerMessage } from '../shared/protocol';

export const MAX_ROOMS = 200;
export const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
export const FINISHED_ROOM_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_OFFLINE_TURN_MS = 45_000;
const MAX_AUTO_ACTIONS = 200;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_ATTEMPTS = 50;

export interface Seat {
  playerId: string;
  token: string;
  name: string;
  classId: ClassId;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface Room {
  code: string;
  hostId: string;
  seats: Seat[];
  state: GameState | null;
  createdAt: number;
  emptySince: number | null;
  finishedAt: number | null;
}

export type LobbyView = Extract<ServerMessage, { t: 'lobby' }>;
type SeatResult = { room: Room; seat: Seat } | { error: string };

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private now: () => number = Date.now,
    private offlineTurnMs: number = DEFAULT_OFFLINE_TURN_MS,
  ) {}

  get size(): number {
    return this.rooms.size;
  }

  codes(): string[] {
    return [...this.rooms.keys()];
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
      finishedAt: null,
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
    seat.disconnectedAt = null;
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
    if (!result.error) {
      room.state = result.state;
      this.markFinished(room);
    }
    return result;
  }

  disconnect(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) return;
    if (room.state) {
      seat.connected = false;
      seat.disconnectedAt = this.now();
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

  /** Auto-plays the current player's turn when their seat has been offline long enough. */
  tickOffline(code: string, now: number = this.now()): GameEvent[] {
    const room = this.rooms.get(code);
    if (!room?.state || room.state.phase === 'game-over') return [];
    const current = room.state.players[room.state.turnIndex];
    if (!current) return [];
    const seat = room.seats.find((s) => s.playerId === current.id);
    if (!seat || seat.connected || seat.disconnectedAt === null) return [];
    if (now - seat.disconnectedAt < this.offlineTurnMs) return [];
    const events: GameEvent[] = [];
    for (let i = 0; i < MAX_AUTO_ACTIONS; i++) {
      const state = room.state;
      if (state.phase === 'game-over' || state.players[state.turnIndex]?.id !== current.id) break;
      let result;
      try {
        result = applyAction(state, current.id, chooseBotAction(state, current.id));
      } catch {
        break;
      }
      if (result.error) break;
      room.state = result.state;
      events.push(...result.events);
    }
    this.markFinished(room);
    return events;
  }

  private markFinished(room: Room): void {
    if (room.state?.phase === 'game-over' && room.finishedAt === null) {
      room.finishedAt = this.now();
    }
  }

  sweep(now: number = this.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      const emptyExpired =
        room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TTL_MS;
      const finishedExpired =
        room.finishedAt !== null && now - room.finishedAt >= FINISHED_ROOM_TTL_MS;
      if (emptyExpired || finishedExpired) {
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
      disconnectedAt: null,
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
