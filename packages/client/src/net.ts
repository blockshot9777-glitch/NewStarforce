import { PROTOCOL_VERSION, type Command, type ServerMessage } from '@starforce/shared';
import { applySnapshot, store, toast } from './store';

const TOKEN_KEY = 'starforce.token';
const NAME_KEY = 'starforce.name';

let ws: WebSocket | null = null;
let onStatus: (s: 'connecting' | 'online' | 'offline') => void = () => {};

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}

export function savedName(): string {
  return storageGet(NAME_KEY) ?? '';
}

function makeToken(): string {
  const saved = storageGet(TOKEN_KEY);
  if (saved) return saved;
  const token = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');
  storageSet(TOKEN_KEY, token);
  return token;
}

export function connect(name: string, status: typeof onStatus): void {
  onStatus = status;
  storageSet(NAME_KEY, name);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = new URLSearchParams(location.search).get('server') ?? `${proto}://${location.host}/ws`;
  onStatus('connecting');
  ws = new WebSocket(url);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ t: 'join', name, token: makeToken(), version: PROTOCOL_VERSION }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage;
    if (msg.t === 'welcome') {
      store.playerId = msg.playerId;
      storageSet(TOKEN_KEY, msg.token);
      onStatus('online');
    } else if (msg.t === 'snap') {
      applySnapshot(msg);
    } else if (msg.t === 'error') {
      toast(msg.msg);
    }
  };
  ws.onclose = (ev) => {
    onStatus('offline');
    if (ev.code === 4002) {
      toast('Игра открыта в другой вкладке');
      return;
    }
    setTimeout(() => connect(name, onStatus), 2000);
  };
}

export function send(cmd: Command): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'cmd', cmd }));
}
