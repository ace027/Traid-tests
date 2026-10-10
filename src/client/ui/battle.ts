import { CLASSES, ITEMS, getMonster, type Action, type GameEvent, type Player, type Stats } from '../../engine';
import type { PublicGameState } from '../../shared/protocol';
import { describeEvents } from './log';

function bar(label: string, hp: number, max: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'hpbar';
  const t = document.createElement('span');
  t.textContent = `${label} ${Math.max(0, hp)}/${max}`;
  const track = document.createElement('div');
  track.className = 'hpbar-track';
  const fill = document.createElement('div');
  fill.className = 'hpbar-fill';
  fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0}%`;
  track.append(fill);
  wrap.append(t, track);
  return wrap;
}

function portrait(seed: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'portrait';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  box.style.background = `hsl(${h} 45% 35%)`;
  return box;
}

function combatant(name: string, stats: Stats, seed: string): HTMLElement {
  const c = document.createElement('div');
  c.className = 'combatant';
  const n = document.createElement('strong');
  n.textContent = name;
  c.append(portrait(seed), n, bar('HP', stats.hp, stats.maxHp));
  return c;
}

export function renderBattle(
  state: PublicGameState,
  me: Player,
  events: GameEvent[],
  act: (a: Action) => void,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'battle';
  const b = state.battle;
  if (!b) return root;
  const attacker = state.players.find((p) => p.id === b.attackerId);
  if (!attacker) return root;
  const row = document.createElement('div');
  row.className = 'combatants';
  row.append(combatant(attacker.name, attacker.stats, attacker.classId));
  if (b.defender.kind === 'monster') {
    const m = getMonster(b.defender.id);
    const hp = b.monsterHp ?? m?.stats.hp ?? 0;
    row.append(combatant(m?.name ?? 'Monster', { ...(m?.stats as Stats), hp }, b.defender.id));
  } else {
    const d = state.players.find((p) => p.id === b.defender.id);
    if (d) row.append(combatant(d.name, d.stats, d.classId));
  }
  root.append(row);

  const lines = describeEvents(state, events);
  if (lines.length) {
    const ul = document.createElement('ul');
    ul.className = 'round-events';
    ul.setAttribute('role', 'log');
    ul.setAttribute('aria-live', 'polite');
    for (const l of lines) {
      const li = document.createElement('li');
      li.textContent = l;
      ul.append(li);
    }
    root.append(ul);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  if (attacker.id !== me.id) {
    const w = document.createElement('p');
    w.textContent = `Waiting for ${attacker.name} to act`;
    actions.append(w);
    root.append(actions);
    return root;
  }
  const add = (label: string, a: Action) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', () => act(a));
    actions.append(btn);
  };
  add('Attack', { type: 'battleAction', action: 'attack' });
  add('Defend', { type: 'battleAction', action: 'defend' });
  add(`Skill: ${CLASSES[me.classId].skill.name}`, { type: 'battleAction', action: 'skill' });
  for (const id of me.inventory) {
    if (ITEMS[id]?.kind === 'consumable') {
      add(`Item: ${ITEMS[id].name}`, { type: 'battleAction', action: 'item', itemId: id });
    }
  }
  add('Flee', { type: 'battleAction', action: 'flee' });
  root.append(actions);
  return root;
}
