import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { reduceServerMessage, type Store } from './store';

export interface Connection {
  send(m: ClientMessage): void;
  close(): void;
}

export type SocketFactory = (url: string) => WebSocket;

const SS_CODE = 'rr.code';
const SS_TOKEN = 'rr.token';

export function defaultUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SS_CODE);
    sessionStorage.removeItem(SS_TOKEN);
  } catch {
    /* storage unavailable */
  }
}

export function connect(store: Store, url?: string, factory?: SocketFactory): Connection {
  const target = url ?? defaultUrl();
  const make: SocketFactory = factory ?? ((u) => new WebSocket(u));
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejoinPending = false;

  const rawSend = (m: ClientMessage) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  };

  const open = () => {
    store.set({ connection: 'connecting' });
    const sock = make(target);
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      store.set({ connection: 'open' });
      let code: string | null = null;
      let token: string | null = null;
      try {
        code = sessionStorage.getItem(SS_CODE);
        token = sessionStorage.getItem(SS_TOKEN);
      } catch {
        /* ignore */
      }
      if (code && token) {
        rejoinPending = true;
        rawSend({ t: 'rejoin', code, token });
      }
    };
    sock.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'joined') {
        rejoinPending = false;
        try {
          sessionStorage.setItem(SS_CODE, msg.code);
          sessionStorage.setItem(SS_TOKEN, msg.token);
        } catch {
          /* ignore */
        }
      } else if (msg.t === 'error' && rejoinPending) {
        // Rejoin rejected: forget the session and go back to create/join.
        rejoinPending = false;
        clearSession();
        store.set({ code: null, token: null, playerId: null, lobby: null, state: null, error: msg.message });
        return;
      }
      store.set(reduceServerMessage(store.get(), msg));
    };
    sock.onclose = (ev: CloseEvent) => {
      if (ws === sock) ws = null;
      store.set({ connection: 'closed' });
      if (closedByUser || ev.code === 4000) return;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      attempt++;
      timer = setTimeout(open, delay);
    };
    sock.onerror = () => {
      /* onclose follows */
    };
  };

  open();

  return {
    send: rawSend,
    close() {
      closedByUser = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}
