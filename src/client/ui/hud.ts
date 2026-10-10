import type { ClientMessage } from '../../shared/protocol';
import type { Store } from '../store';

/** Placeholder: replaced by plan 03-03. Shows phase and a Roll button. */
export function mountHud(root: HTMLElement, store: Store, send: (m: ClientMessage) => void): void {
  const phase = document.createElement('div');
  phase.className = 'panel';
  const roll = document.createElement('button');
  roll.textContent = 'Roll';
  roll.addEventListener('click', () => send({ t: 'action', action: { type: 'roll' } }));
  root.append(phase, roll);
  const render = () => {
    phase.textContent = `Phase: ${store.get().state?.phase ?? '-'}`;
  };
  store.subscribe(render);
  render();
}
