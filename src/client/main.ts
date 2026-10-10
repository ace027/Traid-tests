import { connect, isReplaced, mountReplacedNotice } from './net';
import { createStore } from './store';
import { mountLobby } from './ui/lobby';
import { mountBoard, mountHud } from './views';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

const store = createStore();
const conn = connect(store);
const send = conn.send;

let inGame = false;
let unmountLobby: (() => void) | null = null;

function showLobby() {
  app!.textContent = '';
  const root = document.createElement('div');
  app!.append(root);
  unmountLobby = mountLobby(root, store, send);
  inGame = false;
}

function showGame() {
  unmountLobby?.();
  unmountLobby = null;
  app!.textContent = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  const hud = document.createElement('div');
  hud.className = 'hud';
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.textContent = 'Reconnecting to server...';
  banner.setAttribute('role', 'status');
  store.subscribe((s) => {
    banner.hidden = s.connection === 'open' || isReplaced(s);
  });
  banner.hidden = store.get().connection === 'open' || isReplaced(store.get());
  app!.append(canvas, hud, banner);
  mountBoard(canvas, store);
  mountHud(hud, store, send);
  inGame = true;
}

let replacedNotice: HTMLElement | null = null;
store.subscribe((s) => {
  if (isReplaced(s)) {
    if (!replacedNotice) replacedNotice = mountReplacedNotice(document.body, () => location.reload());
    return;
  }
  if (replacedNotice) {
    replacedNotice.remove();
    replacedNotice = null;
  }
});

store.subscribe((s) => {
  if (s.state && !inGame) showGame();
  else if (!s.state && inGame) location.reload();
});

showLobby();
