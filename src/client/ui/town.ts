import type { Action, Player, Town } from '../../engine';

export function renderTown(me: Player, town: Town | undefined, act: (a: Action) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'town';
  const h = document.createElement('h3');
  h.textContent = 'Town';
  root.append(h);
  const add = (label: string, a: Action, disabled = false) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', () => act(a));
    root.append(btn);
  };
  if (town && town.ownerId === me.id) {
    const cost = 80 * town.level;
    add(`Upgrade (${cost}g)`, { type: 'upgradeTown' }, town.level >= 3 || me.gold < cost);
  } else if (town && town.ownerId !== null) {
    const cost = 150 * town.level;
    add(`Capture (${cost}g)`, { type: 'captureTown' }, me.gold < cost);
  }
  add('Leave', { type: 'leaveTown' });
  return root;
}
