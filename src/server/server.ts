import type { GameEvent } from '../engine';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { MAX_MESSAGE_BYTES, parseClientMessage, publicState } from '../shared/protocol';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { RoomManager } from './rooms';
import type { Room, Seat } from './rooms';

export const PING_INTERVAL_MS = 30_000;
export const SWEEP_INTERVAL_MS = 60_000;

export interface StartOptions {
  port: number;
  httpServer?: HttpServer;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

interface Session {
  code: string;
  playerId: string;
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const rooms = new RoomManager();
  const sessions = new Map<WebSocket, Session>();
  const roomSockets = new Map<string, Set<WebSocket>>();
  const alive = new WeakMap<WebSocket, boolean>();

  const wss = opts.httpServer
    ? new WebSocketServer({ server: opts.httpServer, maxPayload: MAX_MESSAGE_BYTES })
    : new WebSocketServer({ port: opts.port, maxPayload: MAX_MESSAGE_BYTES });

  await new Promise<void>((resolve, reject) => {
    if (opts.httpServer) {
      if (opts.httpServer.listening) resolve();
      else opts.httpServer.listen(opts.port, () => resolve());
      opts.httpServer.once('error', reject);
    } else {
      wss.once('listening', () => resolve());
    }
    wss.once('error', reject);
  });

  function send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket died mid-send; the close handler cleans up
    }
  }

  function socketsOf(code: string): WebSocket[] {
    return [...(roomSockets.get(code) ?? [])];
  }

  function broadcastLobby(code: string): void {
    const view = rooms.lobbyView(code);
    if (!view) return;
    for (const ws of socketsOf(code)) send(ws, view);
  }

  function broadcastState(room: Room, events: GameEvent[]): void {
    if (!room.state) return;
    const msg: ServerMessage = { t: 'state', state: publicState(room.state), events };
    for (const ws of socketsOf(room.code)) send(ws, msg);
  }

  function bind(ws: WebSocket, code: string, playerId: string): void {
    // Latest wins: close any other socket holding this seat.
    for (const other of socketsOf(code)) {
      const s = sessions.get(other);
      if (other !== ws && s && s.playerId === playerId) {
        unlink(other);
        try {
          other.close(4000, 'Replaced by a newer connection');
        } catch {
          // ignore
        }
      }
    }
    sessions.set(ws, { code, playerId });
    let set = roomSockets.get(code);
    if (!set) roomSockets.set(code, (set = new Set()));
    set.add(ws);
  }

  function unlink(ws: WebSocket): Session | undefined {
    const session = sessions.get(ws);
    if (!session) return undefined;
    sessions.delete(ws);
    const set = roomSockets.get(session.code);
    if (set) {
      set.delete(ws);
      if (set.size === 0) roomSockets.delete(session.code);
    }
    return session;
  }

  function seatAndAnnounce(ws: WebSocket, r: { room: Room; seat: Seat } | { error: string }): boolean {
    if ('error' in r) {
      send(ws, { t: 'error', message: r.error });
      return false;
    }
    bind(ws, r.room.code, r.seat.playerId);
    send(ws, { t: 'joined', code: r.room.code, token: r.seat.token, playerId: r.seat.playerId });
    broadcastLobby(r.room.code);
    return true;
  }

  function handle(ws: WebSocket, msg: ClientMessage): void {
    const session = sessions.get(ws);
    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong' });
        return;
      case 'create': {
        if (session) return send(ws, { t: 'error', message: 'Already in a room' });
        seatAndAnnounce(ws, rooms.create(msg.name, msg.classId));
        return;
      }
      case 'join': {
        if (session) return send(ws, { t: 'error', message: 'Already in a room' });
        seatAndAnnounce(ws, rooms.join(msg.code, msg.name, msg.classId));
        return;
      }
      case 'rejoin': {
        const r = rooms.rejoin(msg.code, msg.token);
        if ('error' in r) return send(ws, { t: 'error', message: r.error });
        if (session && (session.code !== r.room.code || session.playerId !== r.seat.playerId)) {
          detach(ws);
        }
        if (!seatAndAnnounce(ws, r)) return;
        if (r.room.state) send(ws, { t: 'state', state: publicState(r.room.state), events: [] });
        return;
      }
      case 'setClass': {
        if (!session) return send(ws, { t: 'error', message: 'Not in a room' });
        const r = rooms.setClass(session.code, session.playerId, msg.classId);
        if (r.error) return send(ws, { t: 'error', message: r.error });
        broadcastLobby(session.code);
        return;
      }
      case 'start': {
        if (!session) return send(ws, { t: 'error', message: 'Not in a room' });
        const r = rooms.start(session.code, session.playerId);
        if (r.error) return send(ws, { t: 'error', message: r.error });
        broadcastLobby(session.code);
        const room = rooms.get(session.code);
        if (room) broadcastState(room, []);
        return;
      }
      case 'action': {
        if (!session) return send(ws, { t: 'error', message: 'Not in a room' });
        const r = rooms.act(session.code, session.playerId, msg.action);
        if (r.error) return send(ws, { t: 'error', message: r.error });
        const room = rooms.get(session.code);
        if (room) broadcastState(room, r.events);
        return;
      }
    }
  }

  function detach(ws: WebSocket): void {
    const session = unlink(ws);
    if (!session) return;
    rooms.disconnect(session.code, session.playerId);
    broadcastLobby(session.code);
  }

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data: RawData, isBinary: boolean) => {
      alive.set(ws, true);
      try {
        if (isBinary) return send(ws, { t: 'error', message: 'Binary messages are not supported' });
        const msg = parseClientMessage(data.toString());
        if (!msg) return send(ws, { t: 'error', message: 'Invalid message' });
        handle(ws, msg);
      } catch (e) {
        console.error('Unhandled error while handling message', e);
        send(ws, { t: 'error', message: 'Internal error' });
      }
    });
    ws.on('error', () => {
      // 'close' follows; avoid unhandled error events (e.g. oversized payload)
    });
    ws.on('close', () => {
      try {
        detach(ws);
      } catch {
        // ignore
      }
    });
  });

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, PING_INTERVAL_MS);
  const sweepTimer = setInterval(() => rooms.sweep(), SWEEP_INTERVAL_MS);
  pingTimer.unref();
  sweepTimer.unref();

  const addr = wss.address();
  const port = opts.httpServer
    ? ((opts.httpServer.address() as { port: number } | null)?.port ?? opts.port)
    : typeof addr === 'object' && addr ? addr.port : opts.port;

  return {
    port,
    close: async () => {
      clearInterval(pingTimer);
      clearInterval(sweepTimer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      sessions.clear();
      roomSockets.clear();
    },
  };
}
