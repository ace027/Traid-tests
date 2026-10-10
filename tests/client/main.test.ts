// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWS {
  static last: FakeWS;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.last = this;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  sessionStorage.clear();
  vi.stubGlobal('WebSocket', FakeWS);
});

describe('main', () => {
  it('mounts the lobby, then swaps to the game view when state arrives', async () => {
    await import('../../src/client/main');
    const app = document.getElementById('app')!;
    expect(app.querySelector('canvas')).toBeNull();
    expect(app.children.length).toBeGreaterThan(0);
    expect(FakeWS.last.url).toContain('/ws');

    const { createGame } = await import('../../src/engine');
    const { publicState } = await import('../../src/shared/protocol');
    const state = publicState(
      createGame({ seed: 1, players: [{ id: 'p1', name: 'Ann', classId: 'knight' }, { id: 'p2', name: 'Bob', classId: 'mage' }] }),
    );
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.onopen!();
    ws.onmessage!({ data: JSON.stringify({ t: 'joined', code: 'ABCD', token: 't', playerId: 'p1' }) });
    ws.onmessage!({ data: JSON.stringify({ t: 'state', state, events: [] }) });
    expect(app.querySelector('canvas')).not.toBeNull();
    expect(app.querySelector('.hud')).not.toBeNull();
    expect(app.querySelector('.banner')).not.toBeNull();
    expect((app.querySelector('.banner') as HTMLElement).hidden).toBe(true);
    ws.onmessage!({ data: JSON.stringify({ t: 'error', message: 'Not your turn' }) });
    expect(app.querySelector('[role="alert"]')!.textContent).toBe('Not your turn');
  });
});
