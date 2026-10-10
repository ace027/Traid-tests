import { CLASSES, MAX_PLAYERS, MIN_PLAYERS, type ClassId } from '../../engine';
import { MAX_NAME_LENGTH, type ClientMessage } from '../../shared/protocol';
import type { Store } from '../store';

type Send = (m: ClientMessage) => void;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function classSelect(id: string): HTMLSelectElement {
  const s = el('select');
  s.id = id;
  for (const [key, def] of Object.entries(CLASSES)) {
    const o = el('option', undefined, def.name);
    o.value = key;
    s.append(o);
  }
  return s;
}

function field(labelText: string, input: HTMLElement): HTMLElement {
  const wrap = el('div');
  const label = el('label', undefined, labelText);
  label.htmlFor = input.id;
  wrap.append(label, input);
  return wrap;
}

function nameInput(id: string): HTMLInputElement {
  const i = el('input');
  i.id = id;
  i.type = 'text';
  i.maxLength = MAX_NAME_LENGTH;
  i.autocomplete = 'off';
  return i;
}

export function mountLobby(root: HTMLElement, store: Store, send: Send): () => void {
  root.textContent = '';
  const wrap = el('div', 'lobby');
  wrap.append(el('h1', undefined, 'Realm Rush'));

  const banner = el('div', 'banner', 'Reconnecting to server...');
  banner.setAttribute('role', 'status');
  banner.hidden = true;

  const errorEl = el('div', 'error');
  errorEl.setAttribute('role', 'alert');

  // Entry screen: create + join forms
  const entry = el('div');
  entry.style.display = 'contents';

  const createForm = el('form', 'panel');
  createForm.id = 'create-form';
  createForm.append(el('h2', undefined, 'Create a game'));
  const cName = nameInput('create-name');
  const cClass = classSelect('create-class');
  const cBtn = el('button', undefined, 'Create');
  cBtn.type = 'submit';
  createForm.append(field('Name', cName), field('Class', cClass), cBtn);

  const joinForm = el('form', 'panel');
  joinForm.id = 'join-form';
  joinForm.append(el('h2', undefined, 'Join a game'));
  const jCode = el('input');
  jCode.id = 'join-code';
  jCode.type = 'text';
  jCode.maxLength = 8;
  jCode.autocomplete = 'off';
  const jName = nameInput('join-name');
  const jClass = classSelect('join-class');
  const jBtn = el('button', undefined, 'Join');
  jBtn.type = 'submit';
  joinForm.append(field('Room code', jCode), field('Name', jName), field('Class', jClass), jBtn);
  entry.append(createForm, joinForm);

  // Room view
  const room = el('div', 'panel');
  room.id = 'room';
  const codeEl = el('div', 'room-code');
  codeEl.id = 'room-code';
  const seatsEl = el('ul', 'seats');
  seatsEl.setAttribute('aria-label', 'Players');
  const roomClass = classSelect('room-class');
  const startBtn = el('button', undefined, 'Start game');
  startBtn.id = 'start-btn';
  startBtn.type = 'button';
  room.append(codeEl, seatsEl, field('Your class', roomClass), startBtn);

  wrap.append(banner, errorEl, entry, room);
  root.append(wrap);

  createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cName.value.trim();
    if (!name) {
      errorEl.textContent = 'Please enter a name.';
      return;
    }
    errorEl.textContent = '';
    send({ t: 'create', name, classId: cClass.value as ClassId });
  });
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = jName.value.trim();
    const code = jCode.value.trim().toUpperCase();
    if (!name) {
      errorEl.textContent = 'Please enter a name.';
      return;
    }
    if (!code) {
      errorEl.textContent = 'Please enter a room code.';
      return;
    }
    errorEl.textContent = '';
    send({ t: 'join', code, name, classId: jClass.value as ClassId });
  });
  roomClass.addEventListener('change', () => send({ t: 'setClass', classId: roomClass.value as ClassId }));
  startBtn.addEventListener('click', () => send({ t: 'start' }));

  const render = () => {
    const s = store.get();
    banner.hidden = s.connection === 'open';
    if (s.error) errorEl.textContent = s.error;
    else if (errorEl.dataset.fromStore === '1') errorEl.textContent = '';
    errorEl.dataset.fromStore = s.error ? '1' : '0';
    const inRoom = !!(s.lobby && s.playerId);
    entry.hidden = inRoom;
    entry.style.display = inRoom ? 'none' : 'contents';
    room.hidden = !inRoom;
    if (!inRoom || !s.lobby) return;
    const lobby = s.lobby;
    codeEl.textContent = lobby.code;
    seatsEl.textContent = '';
    for (const seat of lobby.seats) {
      const li = el('li');
      const label = `${seat.name} (${CLASSES[seat.classId]?.name ?? seat.classId})${seat.playerId === lobby.hostId ? ' - host' : ''}${seat.playerId === s.playerId ? ' - you' : ''}`;
      li.append(el('span', undefined, label));
      li.append(el('span', seat.connected ? 'seat-on' : 'seat-off', seat.connected ? 'connected' : 'disconnected'));
      seatsEl.append(li);
    }
    const me = lobby.seats.find((x) => x.playerId === s.playerId);
    if (me && roomClass.value !== me.classId) roomClass.value = me.classId;
    const isHost = lobby.hostId === s.playerId;
    startBtn.hidden = !isHost;
    startBtn.disabled = lobby.seats.length < MIN_PLAYERS || lobby.seats.length > MAX_PLAYERS;
  };

  const unsub = store.subscribe(render);
  render();
  return () => {
    unsub();
    root.textContent = '';
  };
}
