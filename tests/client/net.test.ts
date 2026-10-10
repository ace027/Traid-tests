// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, clearSession, defaultUrl } from '../../src/client/net';
import { createStore, type Store } from '../../src/client/store';

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

let socks: FakeSocket[];
let store: Store;
const factory = (u: string) => {
  const s = new FakeSocket(u);
  socks.push(s);
  return s as unknown as WebSocket;
};
const last = () => socks[socks.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  socks = [];
  store = createStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('net', () => {
  it('derives ws url from location', () => {
    expect(defaultUrl()).toBe(`ws://${location.host}/ws`);
  });

  it('marks connection open and sends nothing without a saved session', () => {
    connect(store, 'ws://x', factory);
    expect(store.get().connection).toBe('connecting');
    last().open();
    expect(store.get().connection).toBe('open');
    expect(last().sent).toEqual([]);
  });

  it('send is dropped while the socket is not open and serialised when open', () => {
    const c = connect(store, 'ws://x', factory);
    c.send({ t: 'ping' } as never);
    expect(last().sent).toEqual([]);
    last().open();
    c.send({ t: 'ping' } as never);
    expect(last().sent).toEqual([JSON.stringify({ t: 'ping' })]);
  });

  it('persists code and token on joined', () => {
    connect(store, 'ws://x', factory);
    last().open();
    last().recv({ t: 'joined', code: 'ABCD', token: 'tok', playerId: 'p1' });
    expect(sessionStorage.getItem('rr.code')).toBe('ABCD');
    expect(sessionStorage.getItem('rr.token')).toBe('tok');
    expect(store.get().playerId).toBe('p1');
  });

  it('ignores malformed messages', () => {
    connect(store, 'ws://x', factory);
    last().open();
    last().onmessage?.({ data: 'not json' });
    expect(store.get().error).toBeNull();
  });

  it('rejoins with the saved session on open and accepts', () => {
    sessionStorage.setItem('rr.code', 'ABCD');
    sessionStorage.setItem('rr.token', 'tok');
    connect(store, 'ws://x', factory);
    last().open();
    expect(JSON.parse(last().sent[0])).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok' });
    last().recv({ t: 'joined', code: 'ABCD', token: 'tok2', playerId: 'p1' });
    expect(sessionStorage.getItem('rr.token')).toBe('tok2');
    expect(store.get().error).toBeNull();
  });

  it('clears the session and reports error when rejoin is rejected', () => {
    sessionStorage.setItem('rr.code', 'ABCD');
    sessionStorage.setItem('rr.token', 'tok');
    connect(store, 'ws://x', factory);
    last().open();
    last().recv({ t: 'error', message: 'bad token' });
    expect(sessionStorage.getItem('rr.code')).toBeNull();
    expect(sessionStorage.getItem('rr.token')).toBeNull();
    expect(store.get()).toMatchObject({ code: null, token: null, playerId: null, state: null, error: 'bad token' });
  });

  it('later errors (not during rejoin) go through the reducer and keep the session', () => {
    connect(store, 'ws://x', factory);
    last().open();
    last().recv({ t: 'joined', code: 'ABCD', token: 'tok', playerId: 'p1' });
    last().recv({ t: 'error', message: 'nope' });
    expect(store.get().error).toBe('nope');
    expect(sessionStorage.getItem('rr.code')).toBe('ABCD');
  });

  it('reconnects with exponential backoff capped at 10s and resets after open', () => {
    connect(store, 'ws://x', factory);
    const delays = [1000, 2000, 4000, 8000, 10000, 10000];
    for (const d of delays) {
      const n = socks.length;
      last().drop();
      expect(store.get().connection).toBe('closed');
      vi.advanceTimersByTime(d - 1);
      expect(socks.length).toBe(n);
      vi.advanceTimersByTime(1);
      expect(socks.length).toBe(n + 1);
      expect(store.get().connection).toBe('connecting');
    }
    last().open();
    const n = socks.length;
    last().drop();
    vi.advanceTimersByTime(1000);
    expect(socks.length).toBe(n + 1);
  });

  it('does not reconnect on close code 4000', () => {
    connect(store, 'ws://x', factory);
    last().drop(4000);
    vi.advanceTimersByTime(60000);
    expect(socks.length).toBe(1);
    expect(store.get().connection).toBe('closed');
  });

  it('close() stops reconnecting and cancels a pending timer', () => {
    const c = connect(store, 'ws://x', factory);
    last().drop();
    c.close();
    vi.advanceTimersByTime(60000);
    expect(socks.length).toBe(1);
  });

  it('clearSession removes stored keys', () => {
    sessionStorage.setItem('rr.code', 'A');
    sessionStorage.setItem('rr.token', 'B');
    clearSession();
    expect(sessionStorage.length).toBe(0);
  });
});
