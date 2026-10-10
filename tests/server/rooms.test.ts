import { describe, expect, it } from 'vitest';
import { RoomManager, EMPTY_ROOM_TTL_MS, FINISHED_ROOM_TTL_MS, MAX_ROOMS } from '../../src/server/rooms';
import { parseClientMessage } from '../../src/shared/protocol';

function ok<T extends object>(r: T | { error: string }): T {
  if ('error' in r) throw new Error((r as { error: string }).error);
  return r as T;
}

function setup(n = 2) {
  const rm = new RoomManager();
  const host = ok(rm.create('Host', 'knight'));
  const seats = [host.seat];
  for (let i = 1; i < n; i++) seats.push(ok(rm.join(host.room.code, `P${i}`, 'mage')).seat);
  return { rm, code: host.room.code, seats };
}

describe('RoomManager', () => {
  it('create gives a valid code and host', () => {
    const rm = new RoomManager();
    const { room, seat } = ok(rm.create('Ann', 'rogue'));
    expect(room.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(room.hostId).toBe(seat.playerId);
    expect(rm.lobbyView(room.code)?.seats).toHaveLength(1);
  });

  it('join fills up to 4 seats and rejects a 5th', () => {
    const { rm, code } = setup(4);
    expect(rm.join(code, 'Extra', 'cleric')).toEqual({ error: 'Room is full' });
  });

  it('bad code errors', () => {
    const rm = new RoomManager();
    expect('error' in rm.join('ZZZZ', 'A', 'knight')).toBe(true);
    expect('error' in rm.rejoin('ZZZZ', 'x')).toBe(true);
  });

  it('suffixes duplicate names', () => {
    const rm = new RoomManager();
    const { room } = ok(rm.create('Bob', 'knight'));
    const b = ok(rm.join(room.code, 'bob', 'mage'));
    const c = ok(rm.join(room.code, 'Bob', 'mage'));
    expect(b.seat.name).toBe('bob2');
    expect(c.seat.name).toBe('Bob3');
  });

  it('start needs host and 2+ players, then rejects joins', () => {
    const { rm, code, seats } = setup(1);
    expect(rm.start(code, seats[0].playerId).error).toBeTruthy();
    const p2 = ok(rm.join(code, 'Two', 'mage'));
    expect(rm.start(code, p2.seat.playerId).error).toBeTruthy();
    expect(rm.start(code, seats[0].playerId, 42).error).toBeUndefined();
    expect(rm.join(code, 'Late', 'rogue')).toEqual({ error: 'Game already started' });
  });

  it('act before start errors; wrong player errors; right player works', () => {
    const { rm, code, seats } = setup(2);
    expect(rm.act(code, seats[0].playerId, { type: 'roll' }).error).toBeTruthy();
    rm.start(code, seats[0].playerId, 7);
    const state = rm.get(code)!.state!;
    const cur = state.players[state.turnIndex].id;
    const other = seats.find((s) => s.playerId !== cur)!;
    expect(rm.act(code, other.playerId, { type: 'roll' }).error).toBeTruthy();
    expect(rm.act(code, cur, { type: 'roll' }).error).toBeUndefined();
  });

  it('rejoin restores the seat; wrong token fails', () => {
    const { rm, code, seats } = setup(2);
    rm.start(code, seats[0].playerId, 1);
    rm.disconnect(code, seats[1].playerId);
    expect(rm.get(code)!.seats[1].connected).toBe(false);
    const r = ok(rm.rejoin(code, seats[1].token));
    expect(r.seat.playerId).toBe(seats[1].playerId);
    expect(r.seat.connected).toBe(true);
    expect('error' in rm.rejoin(code, 'nope')).toBe(true);
  });

  it('host leaving the lobby passes host on', () => {
    const { rm, code, seats } = setup(3);
    rm.disconnect(code, seats[0].playerId);
    const view = rm.lobbyView(code)!;
    expect(view.hostId).toBe(seats[1].playerId);
    expect(view.seats).toHaveLength(2);
  });

  it('sweep removes idle rooms after 10 minutes', () => {
    const rm = new RoomManager(() => 1000);
    const { room, seat } = ok(rm.create('A', 'knight'));
    const b = ok(rm.join(room.code, 'B', 'knight'));
    expect(rm.start(room.code, seat.playerId, 1).error).toBeUndefined();
    rm.disconnect(room.code, seat.playerId);
    rm.disconnect(room.code, b.seat.playerId);
    expect(rm.sweep(1000 + EMPTY_ROOM_TTL_MS - 1)).toBe(0);
    expect(rm.sweep(1000 + EMPTY_ROOM_TTL_MS)).toBe(1);
    expect(rm.get(room.code)).toBeUndefined();
  });

  it('deletes a lobby room when the last seat leaves', () => {
    const rm = new RoomManager();
    const { room, seat } = ok(rm.create('A', 'knight'));
    rm.disconnect(room.code, seat.playerId);
    expect(rm.get(room.code)).toBeUndefined();
    expect('error' in rm.join(room.code, 'B', 'knight')).toBe(true);
  });

  it('caps live rooms', () => {
    const rm = new RoomManager();
    for (let i = 0; i < MAX_ROOMS; i++) ok(rm.create('A', 'knight'));
    expect('error' in rm.create('A', 'knight')).toBe(true);
  });
});

describe('parseClientMessage', () => {
  const p = (o: unknown) => parseClientMessage(JSON.stringify(o));

  it('accepts town actions and rejects unknown action types', () => {
    for (const type of ['upgradeTown', 'captureTown', 'leaveTown']) {
      expect(p({ t: 'action', action: { type } })).toEqual({ t: 'action', action: { type } });
    }
    expect(p({ t: 'action', action: { type: 'teleport' } })).toBeNull();
  });

  it('accepts each valid form', () => {
    expect(p({ t: 'create', name: ' Ann ', classId: 'knight' })).toEqual({ t: 'create', name: 'Ann', classId: 'knight' });
    expect(p({ t: 'join', code: 'ABCD', name: 'Bo', classId: 'mage' })).toEqual({ t: 'join', code: 'ABCD', name: 'Bo', classId: 'mage' });
    expect(p({ t: 'rejoin', code: 'ABCD', token: 'tok' })).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok' });
    expect(p({ t: 'setClass', classId: 'rogue' })).toEqual({ t: 'setClass', classId: 'rogue' });
    expect(p({ t: 'start' })).toEqual({ t: 'start' });
    expect(p({ t: 'ping' })).toEqual({ t: 'ping' });
    expect(p({ t: 'action', action: { type: 'roll' } })).toEqual({ t: 'action', action: { type: 'roll' } });
    expect(p({ t: 'action', action: { type: 'choosePath', tileId: 't1' } })).not.toBeNull();
    expect(p({ t: 'action', action: { type: 'battleAction', action: 'attack' } })).not.toBeNull();
    expect(p({ t: 'action', action: { type: 'buy', itemId: 'potion' } })).not.toBeNull();
  });

  it('rejects malformed, oversized and unknown messages', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('[]')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(p({ t: 'nope' })).toBeNull();
    expect(p({ name: 'x' })).toBeNull();
    expect(p({ t: 'create', name: '   ', classId: 'knight' })).toBeNull();
    expect(p({ t: 'create', name: 'x'.repeat(17), classId: 'knight' })).toBeNull();
    expect(p({ t: 'create', name: 'A', classId: 'wizard' })).toBeNull();
    expect(p({ t: 'create', name: 'A', classId: 'toString' })).toBeNull();
    expect(p({ t: 'join', code: 'ABCI', name: 'A', classId: 'mage' })).toBeNull();
    expect(p({ t: 'join', code: 'abcd', name: 'A', classId: 'mage' })).toBeNull();
    expect(p({ t: 'action', action: { type: 'hack' } })).toBeNull();
    expect(p({ t: 'action', action: { type: 'buy' } })).toBeNull();
    expect(p({ t: 'action', action: { type: 'battleAction', action: 'nuke' } })).toBeNull();
    expect(p({ t: 'action' })).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'rejoin', code: 'ABCD', token: 'x'.repeat(20000) }))).toBeNull();
  });
});

describe('offline turn takeover', () => {
  function started(offlineMs = 1000) {
    let t = 1_000_000;
    const rm = new RoomManager(() => t, offlineMs);
    const host = ok(rm.create('Host', 'knight'));
    const code = host.room.code;
    const seats = [host.seat, ok(rm.join(code, 'P1', 'mage')).seat];
    expect(rm.start(code, host.seat.playerId, 42).error).toBeUndefined();
    const room = rm.get(code)!;
    const current = () => room.state!.players[room.state!.turnIndex].id;
    const seatOf = (id: string) => seats.find((s) => s.playerId === id)!;
    return { rm, code, room, current, seatOf, advance: (ms: number) => (t += ms), now: () => t };
  }

  it('auto-plays an offline current player after the timeout and passes the turn', () => {
    const g = started();
    const first = g.current();
    g.rm.disconnect(g.code, first);
    expect(g.rm.tickOffline(g.code, g.now() + 999)).toEqual([]);
    expect(g.current()).toBe(first);
    g.advance(1000);
    const events = g.rm.tickOffline(g.code);
    expect(events.length).toBeGreaterThan(0);
    expect(g.current()).not.toBe(first);
  });

  it('never auto-plays a connected current player', () => {
    const g = started();
    const first = g.current();
    g.advance(10 * 60_000);
    expect(g.rm.tickOffline(g.code)).toEqual([]);
    expect(g.current()).toBe(first);
  });

  it('rejoining before the timeout cancels the takeover', () => {
    const g = started();
    const first = g.current();
    g.rm.disconnect(g.code, first);
    g.advance(500);
    g.rm.rejoin(g.code, g.seatOf(first).token);
    g.advance(5000);
    expect(g.rm.tickOffline(g.code)).toEqual([]);
    expect(g.current()).toBe(first);
  });

  it('sweeps finished rooms after 10 minutes', () => {
    const g = started();
    g.room.finishedAt = g.now();
    expect(g.rm.sweep(g.now() + FINISHED_ROOM_TTL_MS - 1)).toBe(0);
    expect(g.rm.sweep(g.now() + FINISHED_ROOM_TTL_MS)).toBe(1);
    expect(g.rm.get(g.code)).toBeUndefined();
  });

  it('keeps taking over turns of an all-offline room until the game ends or cap', () => {
    const g = started();
    for (const s of g.room.seats) g.rm.disconnect(g.code, s.playerId);
    g.advance(2000);
    for (let i = 0; i < 20; i++) g.rm.tickOffline(g.code);
    expect(g.room.state).not.toBeNull();
  });
});
