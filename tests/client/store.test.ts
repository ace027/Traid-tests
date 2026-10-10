// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, isReplaced, mountReplacedNotice } from '../../src/client/net';
import { createStore, initialState, reduceServerMessage } from '../../src/client/store';

describe('reduceServerMessage', () => {
  it('handles joined', () => {
    const s = reduceServerMessage(initialState(), { t: 'joined', code: 'ABCD', token: 'tok', playerId: 'p1' });
    expect(s).toMatchObject({ code: 'ABCD', token: 'tok', playerId: 'p1' });
  });
  it('handles lobby', () => {
    const msg = { t: 'lobby' as const, code: 'ABCD', hostId: 'p1', seats: [] };
    expect(reduceServerMessage(initialState(), msg).lobby).toEqual(msg);
  });
  it('handles state', () => {
    const state = { phase: 'roll' } as never;
    const s = reduceServerMessage(initialState(), { t: 'state', state, events: [{ type: 'x' }] });
    expect(s.state).toBe(state);
    expect(s.lastEvents).toEqual([{ type: 'x' }]);
  });
  it('handles error', () => {
    expect(reduceServerMessage(initialState(), { t: 'error', message: 'nope' }).error).toBe('nope');
  });
});

describe('store', () => {
  it('subscribe fires on set and unsubscribe stops it', () => {
    const store = createStore();
    const fn = vi.fn();
    const un = store.subscribe(fn);
    store.set({ error: 'a' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.get().error).toBe('a');
    un();
    store.set({ error: 'b' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

class FakeSocket {
  static last: FakeSocket;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
}
const factory = (u: string) => new FakeSocket(u) as unknown as WebSocket;

describe('net', () => {
  beforeEach(() => sessionStorage.clear());

  it('sends rejoin on open when session saved', () => {
    sessionStorage.setItem('rr.code', 'ABCD');
    sessionStorage.setItem('rr.token', 'tok');
    const store = createStore();
    connect(store, 'ws://x', factory);
    FakeSocket.last.onopen?.();
    expect(store.get().connection).toBe('open');
    expect(JSON.parse(FakeSocket.last.sent[0]!)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok' });
  });

  it('does not rejoin without session; saves joined; clears on rejected rejoin', () => {
    const store = createStore();
    connect(store, 'ws://x', factory);
    FakeSocket.last.onopen?.();
    expect(FakeSocket.last.sent).toEqual([]);
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: 'joined', code: 'ABCD', token: 't', playerId: 'p' }) });
    expect(sessionStorage.getItem('rr.token')).toBe('t');

    const store2 = createStore();
    connect(store2, 'ws://x', factory);
    FakeSocket.last.onopen?.();
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: 'error', message: 'bad' }) });
    expect(sessionStorage.getItem('rr.token')).toBeNull();
    expect(store2.get().code).toBeNull();
  });

  it('reconnects with backoff unless code 4000', () => {
    vi.useFakeTimers();
    const store = createStore();
    connect(store, 'ws://x', factory);
    const first = FakeSocket.last;
    first.onclose?.({ code: 1006 });
    expect(store.get().connection).toBe('closed');
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.last).not.toBe(first);
    const second = FakeSocket.last;
    second.onclose?.({ code: 4000 });
    vi.advanceTimersByTime(20000);
    expect(FakeSocket.last).toBe(second);
    vi.useRealTimers();
  });

  it('code 4000 flags the session as replaced and shows a Reconnect notice', () => {
    const store = createStore();
    connect(store, 'ws://x', factory);
    expect(isReplaced(store.get())).toBe(false);
    FakeSocket.last.onclose?.({ code: 4000 });
    expect(isReplaced(store.get())).toBe(true);
    const onReconnect = vi.fn();
    const box = mountReplacedNotice(document.body, onReconnect);
    expect(box.textContent).toContain('Session opened elsewhere');
    box.querySelector('button')!.click();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    box.remove();
  });

  it('replaced state survives send attempts', () => {
    const store = createStore();
    const c = connect(store, 'ws://x', factory);
    FakeSocket.last.onclose?.({ code: 4000 });
    expect(c.send({ t: 'ping' } as never)).toBe(false);
    expect(isReplaced(store.get())).toBe(true);
  });
});
