import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { chooseBotAction } from '../../src/engine/bot';
import type { GameState } from '../../src/engine';
import type { PublicGameState, ServerMessage } from '../../src/shared/protocol';
import { startServer } from '../../src/server/server';
import type { RunningServer } from '../../src/server/server';

/** Test-side stand-in: clients never receive seed/rngState; the bot only needs some local entropy. */
function withRng(s: PublicGameState): GameState {
  return { ...s, seed: 0, rngState: s.log.length } as GameState;
}

class Client {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  playerId = '';
  token = '';
  code = '';
  lastState: PublicGameState | null = null;
  private waiters: Array<() => void> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.t === 'joined') {
        this.playerId = m.playerId;
        this.token = m.token;
        this.code = m.code;
      }
      if (m.t === 'state') this.lastState = m.state;
      this.inbox.push(m);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  async next(t: ServerMessage['t'], pred: (m: any) => boolean = () => true, timeout = 5000): Promise<any> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t && pred(m));
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${t}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  closed(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
    });
  }
}

let server: RunningServer;
let clients: Client[] = [];

async function connect(): Promise<Client> {
  const c = new Client(`ws://127.0.0.1:${server.port}`);
  clients.push(c);
  await c.opened();
  return c;
}

async function setupRoom(): Promise<[Client, Client, Client]> {
  const a = await connect();
  a.send({ t: 'create', name: 'Ann', classId: 'knight' });
  await a.next('joined');
  const b = await connect();
  b.send({ t: 'join', code: a.code, name: 'Bob', classId: 'mage' });
  await b.next('joined');
  const c = await connect();
  c.send({ t: 'join', code: a.code, name: 'Cy', classId: 'cleric' });
  await c.next('joined');
  return [a, b, c];
}

beforeEach(async () => {
  server = await startServer({ port: 0 });
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  await server.close();
});

describe('websocket protocol', () => {
  it('lobby then state reach all three clients after start', async () => {
    const [a, b, c] = await setupRoom();
    const lobby = await c.next('lobby', (m) => m.seats.length === 3);
    expect(lobby.hostId).toBe(a.playerId);
    a.send({ t: 'start' });
    for (const cl of [a, b, c]) {
      await cl.next('lobby', (m) => m.seats.length === 3);
      const st = await cl.next('state');
      expect(st.state.players).toHaveLength(3);
      expect(st.state).not.toHaveProperty('seed');
      expect(st.state).not.toHaveProperty('rngState');
    }
  });

  it('three clients play a full game to game-over', async () => {
    const [a, b, c] = await setupRoom();
    const all = [a, b, c];
    let done: () => void = () => {};
    const finished = new Promise<void>((r) => (done = r));
    let actions = 0;
    let failure: Error | null = null;
    for (const cl of all) {
      cl.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        if (m.t === 'error') {
          failure = new Error(`server error: ${m.message}`);
          done();
          return;
        }
        if (m.t !== 'state') return;
        const s = m.state;
        if (s.phase === 'game-over') return done();
        if (s.players[s.turnIndex].id !== cl.playerId) return;
        if (++actions > 20000) {
          failure = new Error('action cap exceeded');
          return done();
        }
        try {
          cl.send({ t: 'action', action: chooseBotAction(withRng(s), cl.playerId) });
        } catch (e) {
          failure = e as Error;
          done();
        }
      });
    }
    a.send({ t: 'start' });
    await finished;
    if (failure) throw failure;
    expect(a.lastState?.phase).toBe('game-over');
    expect(a.lastState?.winnerId).toBeTruthy();
  }, 60_000);

  it('disconnect marks seat offline and rejoin restores it', async () => {
    const [a, b, c] = await setupRoom();
    a.send({ t: 'start' });
    for (const cl of [a, b, c]) await cl.next('state');
    const state = a.lastState!;
    const actor = [a, b, c].find((cl) => cl.playerId === state.players[state.turnIndex].id)!;
    const other = [a, b, c].find((cl) => cl !== actor && cl !== a) ?? b;
    const watcher = [a, b, c].find((cl) => cl !== actor && cl !== other)!;

    const { token, code, playerId } = actor;
    actor.ws.close();
    await actor.closed();
    const lobby = await watcher.next('lobby', (m) => m.seats.some((s: any) => s.playerId === playerId && !s.connected));
    expect(lobby.seats.find((s: any) => s.playerId === playerId).connected).toBe(false);

    const again = await connect();
    again.send({ t: 'rejoin', code, token });
    const joined = await again.next('joined');
    expect(joined.playerId).toBe(playerId);
    const st = await again.next('state');
    expect(st.state.players[st.state.turnIndex].id).toBe(playerId);
    again.send({ t: 'action', action: chooseBotAction(withRng(st.state), playerId) });
    const after = await watcher.next('state', (m) => m.events.length > 0);
    expect(after.events.length).toBeGreaterThan(0);
  });

  it('latest connection wins when two sockets rejoin the same seat', async () => {
    const [a, b] = await setupRoom();
    a.send({ t: 'start' });
    await a.next('state');
    const first = await connect();
    first.send({ t: 'rejoin', code: b.code, token: b.token });
    await first.next('joined');
    const second = await connect();
    second.send({ t: 'rejoin', code: b.code, token: b.token });
    await second.next('joined');
    await first.closed();
    await second.next('state');
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('survives garbage and oversized messages', async () => {
    const c = await connect();
    c.send('{not json');
    expect((await c.next('error')).t).toBe('error');
    c.send({ t: 'nope' });
    await c.next('error');
    c.send('x'.repeat(40_000));
    await c.closed();
    const d = await connect();
    d.send({ t: 'ping' });
    await d.next('pong');
  });

  it('out-of-turn action errors only the sender', async () => {
    const [a, b, c] = await setupRoom();
    a.send({ t: 'start' });
    for (const cl of [a, b, c]) await cl.next('state');
    const s = a.lastState!;
    const offender = [a, b, c].find((cl) => cl.playerId !== s.players[s.turnIndex].id)!;
    const others = [a, b, c].filter((cl) => cl !== offender);
    offender.send({ t: 'action', action: { type: 'roll' } });
    await offender.next('error');
    offender.send({ t: 'ping' });
    await offender.next('pong');
    for (const o of others) {
      expect(o.inbox.some((m) => m.t === 'error')).toBe(false);
      expect(o.inbox.some((m) => m.t === 'state')).toBe(false);
    }
  });

  it('non-host start returns an error and does not start the game', async () => {
    const [, b] = await setupRoom();
    b.send({ t: 'start' });
    const e = await b.next('error');
    expect(e.message).toMatch(/host/i);
  });

  it('join after start returns Game already started', async () => {
    const [a, b, c] = await setupRoom();
    a.send({ t: 'start' });
    for (const cl of [a, b, c]) await cl.next('state');
    const late = await connect();
    late.send({ t: 'join', code: a.code, name: 'Late', classId: 'knight' });
    const e = await late.next('error');
    expect(e.message).toBe('Game already started');
  });

  it('setClass broadcasts an updated lobby to everyone', async () => {
    const [a, b, c] = await setupRoom();
    b.send({ t: 'setClass', classId: 'cleric' });
    for (const cl of [a, b, c]) {
      const lobby = await cl.next(
        'lobby',
        (m) => m.seats.find((s: any) => s.playerId === b.playerId)?.classId === 'cleric',
      );
      expect(lobby.seats).toHaveLength(3);
    }
  });

  it('setClass and town actions without a room or in the wrong phase error cleanly', async () => {
    const lone = await connect();
    lone.send({ t: 'setClass', classId: 'mage' });
    expect((await lone.next('error')).message).toBe('Not in a room');
    const [a, b, c] = await setupRoom();
    a.send({ t: 'start' });
    for (const cl of [a, b, c]) await cl.next('state');
    const s = a.lastState!;
    const actor = [a, b, c].find((cl) => cl.playerId === s.players[s.turnIndex].id)!;
    actor.send({ t: 'action', action: { type: 'captureTown' } });
    const e = await actor.next('error');
    expect(typeof e.message).toBe('string');
    actor.send({ t: 'ping' });
    await actor.next('pong');
  });
});
