import { computeScore } from '../../engine';
import { clearSession } from '../net';
import type { PublicGameState } from '../../shared/protocol';

export function renderGameOver(state: PublicGameState): HTMLElement {
  const box = document.createElement('div');
  box.className = 'gameover';
  const winner = state.players.find((p) => p.id === state.winnerId);
  const h = document.createElement('h2');
  h.className = 'winner-banner';
  h.tabIndex = -1;
  const ol = document.createElement('ol');
  ol.className = 'ranking';
  const ranked = state.players
    .map((p) => ({ p, score: computeScore(state as never, p.id) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked.length ? ranked[0].score : 0;
  const tied = ranked.filter((r) => r.score === top).map((r) => r.p.name);
  if (winner && tied.length > 1) h.textContent = `${tied.join(' and ')} share the win!`;
  else h.textContent = winner ? `${winner.name} wins!` : 'Game over';
  for (const { p, score } of ranked) {
    const li = document.createElement('li');
    li.textContent = `${p.name}: ${score}`;
    ol.append(li);
  }
  const back = document.createElement('button');
  back.className = 'back-to-lobby';
  back.textContent = 'Back to lobby';
  back.addEventListener('click', () => {
    clearSession();
    location.reload();
  });
  box.append(h, ol, back);
  // Focus once the panel is attached; a toast showing at the time does not matter.
  setTimeout(() => {
    if (h.isConnected) h.focus();
  }, 0);
  return box;
}
