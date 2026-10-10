import { CAPTURE_COST_PER_LEVEL, MAX_TOWN_LEVEL, UPGRADE_COST_PER_LEVEL, type Action, type Player, type Town } from '../../engine';

export function renderTown(me: Player, town: Town | undefined, act: (a: Action) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'town';
  const h = document.createElement('h3');
  h.textContent = 'Town';
  root.append(h);
  const add = (label: string, a: Action, disabled = false, reason = '') => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled = disabled;
    if (disabled && reason) btn.title = reason;
    btn.addEventListener('click', () => act(a));
    root.append(btn);
  };
  if (town && town.ownerId === me.id) {
    const cost = UPGRADE_COST_PER_LEVEL * town.level;
    if (town.level >= MAX_TOWN_LEVEL) {
      add('Upgrade (max level)', { type: 'upgradeTown' }, true, 'Town is at max level');
    } else {
      add(`Upgrade (${cost}g)`, { type: 'upgradeTown' }, me.gold < cost, `Need ${cost}g`);
    }
  } else if (town && town.ownerId !== null) {
    const cost = CAPTURE_COST_PER_LEVEL * town.level;
    add(`Capture (${cost}g)`, { type: 'captureTown' }, me.gold < cost, `Need ${cost}g`);
  }
  add('Leave', { type: 'leaveTown' });
  return root;
}
