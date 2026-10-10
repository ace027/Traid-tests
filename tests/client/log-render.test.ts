// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createGame, type GameEvent } from '../../src/engine';
import { publicState } from '../../src/shared/protocol';
import { renderLog } from '../../src/client/ui/log';

const base = () =>
  publicState(
    createGame({
      seed: 1,
      players: [
        { id: 'p1', name: 'Ann', classId: 'knight' },
        { id: 'p2', name: 'Bob', classId: 'mage' },
      ],
    }),
  );

describe('renderLog', () => {
  it('dedupes events already present in the log and caps at 50 lines', () => {
    const s = base();
    s.log = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    s.log.push('Ann defends');
    const events = [
      { type: 'defend', playerId: 'p1' },
      { type: 'defend', playerId: 'p2' },
    ] as unknown as GameEvent[];
    const ul = document.createElement('ul');
    renderLog(ul, s, events);
    const items = [...ul.children].map((l) => l.textContent);
    expect(items.length).toBe(50);
    expect(items.filter((t) => t === 'Ann defends').length).toBe(1);
    expect(items[items.length - 1]).toBe('Bob defends');
    expect(items[0]).toBe('line 12');
  });
});
