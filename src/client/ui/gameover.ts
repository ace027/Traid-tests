import { computeScore } from '../../engine';
import type { PublicGameState } from '../../shared/protocol';

export function renderGameOver(state: PublicGameState): HTMLElement {
  const box = document.createElement('div');
  box.className = 'gameover';
  const winner = state.players.find((p) => p.id === state.winnerId);
  const h = document.createElement('h2');
  h.className = 'winner-banner';
  h.textContent = winner ? `${winner.name} wins!` : 'Game over';
  const ol = document.createElement('ol');
  ol.className = 'ranking';
  const ranked = state.players
    .map((p) => ({ p, score: computeScore(state as never, p.id) }))
    .sort((a, b) => b.score - a.score);
  for (const { p, score } of ranked) {
    const li = document.createElement('li');
    li.textContent = `${p.name}: ${score}`;
    ol.append(li);
  }
  box.append(h, ol);
  return box;
}
