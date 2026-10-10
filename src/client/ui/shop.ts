import { ITEMS, shopStock, sellPrice, type Action, type Item, type Player } from '../../engine';

export function modText(item: Item): string {
  return Object.entries(item.mods)
    .map(([k, v]) => `${(v as number) > 0 ? '+' : ''}${v} ${k}`)
    .join(', ');
}

export function renderShop(me: Player, act: (a: Action) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'shop';
  const h = document.createElement('h3');
  h.textContent = 'Shop';
  root.append(h);
  const stock = shopStock(me.tileId).map((id) => ITEMS[id]).filter(Boolean);
  if (!stock.some((i) => i.price <= me.gold)) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'You cannot afford anything here.';
    root.append(p);
  }
  const ul = document.createElement('ul');
  for (const item of stock) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = `${item.name} - ${item.price}g ${modText(item)}`.trim();
    const buy = document.createElement('button');
    buy.textContent = 'Buy';
    buy.disabled = item.price > me.gold;
    buy.addEventListener('click', () => act({ type: 'buy', itemId: item.id }));
    li.append(span, buy);
    ul.append(li);
  }
  root.append(ul);
  if (me.inventory.length) {
    const h2 = document.createElement('h4');
    h2.textContent = 'Sell';
    const sl = document.createElement('ul');
    me.inventory.forEach((id) => {
      const item = ITEMS[id];
      if (!item) return;
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${item.name} - ${sellPrice(id)}g`;
      const sell = document.createElement('button');
      sell.textContent = 'Sell';
      sell.addEventListener('click', () => act({ type: 'sell', itemId: id }));
      li.append(span, sell);
      sl.append(li);
    });
    root.append(h2, sl);
  }
  const leave = document.createElement('button');
  leave.textContent = 'Leave';
  leave.addEventListener('click', () => act({ type: 'leaveShop' }));
  root.append(leave);
  return root;
}
