import { ITEMS, type Action, type Player, type Slot } from '../../engine';
import { modText } from './shop';

const SLOTS: Slot[] = ['weapon', 'armor', 'charm'];

export function renderInventory(me: Player, act: (a: Action) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inventory';
  const h = document.createElement('h3');
  h.textContent = 'Inventory';
  root.append(h);
  const eq = document.createElement('ul');
  eq.className = 'equipped';
  for (const s of SLOTS) {
    const li = document.createElement('li');
    const id = me.equipment[s];
    li.textContent = `${s}: ${id ? (ITEMS[id]?.name ?? id) : '-'}`;
    eq.append(li);
  }
  root.append(eq);
  const ul = document.createElement('ul');
  ul.className = 'items';
  if (!me.inventory.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Empty';
    ul.append(li);
  }
  for (const id of me.inventory) {
    const item = ITEMS[id];
    if (!item) continue;
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = `${item.name} ${modText(item)}`.trim();
    const btn = document.createElement('button');
    btn.textContent = item.kind === 'equipment' ? 'Equip' : 'Use';
    btn.addEventListener('click', () =>
      act({ type: item.kind === 'equipment' ? 'equip' : 'useItem', itemId: id }),
    );
    li.append(span, btn);
    ul.append(li);
  }
  root.append(ul);
  return root;
}
