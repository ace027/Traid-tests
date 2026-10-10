// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../../src/client/store';
import { mountLobby } from '../../src/client/ui/lobby';

let root: HTMLElement;
let store: Store;
let send: ReturnType<typeof vi.fn>;

const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
const submit = (id: string) => q<HTMLFormElement>(id).dispatchEvent(new Event('submit', { cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  store = createStore();
  send = vi.fn();
  mountLobby(root, store, send);
});

function seat(i: number) {
  return { playerId: `p${i}`, name: `P${i}`, classId: 'knight' as const, connected: true };
}
function joinRoom(n: number, me: string) {
  store.set({
    playerId: me,
    lobby: { t: 'lobby', code: 'ABCD', hostId: 'p1', seats: Array.from({ length: n }, (_, i) => seat(i + 1)) },
  });
}

describe('lobby', () => {
  it('create sends trimmed name and class', () => {
    q<HTMLInputElement>('#create-name').value = '  Ann  ';
    q<HTMLSelectElement>('#create-class').value = 'mage';
    submit('#create-form');
    expect(send).toHaveBeenCalledWith({ t: 'create', name: 'Ann', classId: 'mage' });
  });

  it('blocks empty name', () => {
    q<HTMLInputElement>('#create-name').value = '   ';
    submit('#create-form');
    expect(send).not.toHaveBeenCalled();
  });

  it('join uppercases and trims code', () => {
    q<HTMLInputElement>('#join-code').value = ' abcd ';
    q<HTMLInputElement>('#join-name').value = 'Bob';
    submit('#join-form');
    expect(send).toHaveBeenCalledWith({ t: 'join', code: 'ABCD', name: 'Bob', classId: 'knight' });
  });

  it('start visible only to host and disabled below 2 seats', () => {
    joinRoom(1, 'p1');
    expect(q('#room-code').textContent).toBe('ABCD');
    expect(q<HTMLButtonElement>('#start-btn').hidden).toBe(false);
    expect(q<HTMLButtonElement>('#start-btn').disabled).toBe(true);
    joinRoom(2, 'p1');
    expect(q<HTMLButtonElement>('#start-btn').disabled).toBe(false);
    q<HTMLButtonElement>('#start-btn').click();
    expect(send).toHaveBeenCalledWith({ t: 'start' });
    joinRoom(2, 'p2');
    expect(q<HTMLButtonElement>('#start-btn').hidden).toBe(true);
  });

  it('renders error and reconnect banner', () => {
    store.set({ error: 'Room not found', connection: 'closed' });
    expect(root.textContent).toContain('Room not found');
    expect(q('.banner').hidden).toBe(false);
    store.set({ connection: 'open' });
    expect(q('.banner').hidden).toBe(true);
  });
});
