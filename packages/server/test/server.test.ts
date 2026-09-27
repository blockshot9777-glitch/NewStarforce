import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage, type Snapshot } from '@starforce/shared';
import { startServer, type RunningServer } from '../src/server';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function connect(port: number, name: string, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(String(d))));
  const opened = new Promise<void>((ok) => ws.on('open', () => ok()));
  const join = async () => {
    await opened;
    ws.send(JSON.stringify({ t: 'join', name, token, version: PROTOCOL_VERSION }));
  };
  const waitFor = async <T extends ServerMessage>(pred: (m: ServerMessage) => m is T, ms = 3000): Promise<T> => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const found = messages.find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout');
  };
  return { ws, messages, join, waitFor };
}

const isSnap = (m: ServerMessage): m is Snapshot => m.t === 'snap';

describe('сервер', () => {
  it('два игрока входят, получают снимки и видят корабли друг друга', async () => {
    server = await startServer({ port: 0, log: () => {} });
    const a = connect(server.port, 'Алиса', 'token-alice-1');
    const b = connect(server.port, 'Боб', 'token-bob-12');
    await a.join();
    await b.join();
    const welcome = await a.waitFor((m): m is Extract<ServerMessage, { t: 'welcome' }> => m.t === 'welcome');
    expect(welcome.token).toBe('token-alice-1');
    a.messages.length = 0;
    const snap = await a.waitFor((m): m is Snapshot => isSnap(m) && m.contacts.some((c) => c.k === 'ship'));
    expect(snap.ship).not.toBeNull();
    const other = snap.contacts.find((c) => c.k === 'ship');
    expect(other && other.k === 'ship' && other.owner).toBe('Боб');
    expect(snap.layouts[other!.id]).toBeDefined();

    // Команда проходит, ошибка возвращается сообщением.
    a.ws.send(JSON.stringify({ t: 'cmd', cmd: { c: 'jump', systemId: 3 } }));
    const err = await a.waitFor((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
    expect(err.msg).toMatch(/далеко/);

    // Чат доходит до другого игрока.
    a.ws.send(JSON.stringify({ t: 'cmd', cmd: { c: 'chat', text: 'Привет, сосед!' } }));
    const chat = await b.waitFor((m): m is Snapshot => isSnap(m) && m.chat.length > 0);
    expect(chat.chat[0]).toMatchObject({ from: 'Алиса', text: 'Привет, сосед!' });

    a.ws.close();
    b.ws.close();
  });

  it('мусор в сокете не роняет сервер', async () => {
    server = await startServer({ port: 0, log: () => {} });
    const a = connect(server.port, 'X', 'token-x-12345');
    await a.join();
    a.ws.send('не json');
    a.ws.send(JSON.stringify({ t: 'cmd', cmd: { c: 'build', x: 'ы', y: null, kind: 'reactor' } }));
    a.ws.send(JSON.stringify({ t: 'cmd', cmd: null }));
    const before = server.world.state.tick;
    await new Promise((r) => setTimeout(r, 300));
    expect(server.world.state.tick).toBeGreaterThan(before);
    a.ws.close();
  });

  it('мир сохраняется на диск и восстанавливается с тем же игроком', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'starforce-'));
    const savePath = join(dir, 'world.json');
    server = await startServer({ port: 0, savePath, log: () => {} });
    const a = connect(server.port, 'Сохранёнка', 'token-save-123');
    await a.join();
    const first = await a.waitFor(isSnap);
    a.ws.close();
    await server.close();
    server = null;
    expect(existsSync(savePath)).toBe(true);
    expect(JSON.parse(readFileSync(savePath, 'utf8')).players[0].name).toBe('Сохранёнка');

    server = await startServer({ port: 0, savePath, log: () => {} });
    const again = connect(server.port, 'кто угодно', 'token-save-123');
    await again.join();
    const snap = await again.waitFor(isSnap);
    expect(snap.me.id).toBe(first.me.id);
    expect(snap.ship!.id).toBe(first.ship!.id);
    again.ws.close();
  });
});
