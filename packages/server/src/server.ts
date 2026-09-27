// Авторитарный игровой сервер: клиенты шлют команды, сервер считает мир и рассылает снимки.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  TICK_RATE,
  World,
  newClientCache,
  type ClientCache,
  type ClientMessage,
  type ServerMessage,
} from '@starforce/shared';

export interface ServerOptions {
  port: number;
  host?: string;
  /** Куда сохранять мир. Без пути мир живёт только в памяти. */
  savePath?: string;
  saveIntervalSec?: number;
  /** Папка собранного клиента (vite build) — сервер раздаёт её по HTTP. */
  staticDir?: string;
  seed?: number;
  log?: (msg: string) => void;
}

export interface RunningServer {
  port: number;
  world: World;
  save: () => void;
  close: () => Promise<void>;
}

interface Client {
  ws: WebSocket;
  playerId: number | null;
  cache: ClientCache;
  /** Простой ограничитель частоты команд (token bucket). */
  budget: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const MAX_COMMANDS_PER_SEC = 40;

export function loadWorld(savePath: string | undefined, seed: number | undefined, log: (m: string) => void): World {
  if (savePath && existsSync(savePath)) {
    try {
      const world = World.fromJSON(readFileSync(savePath, 'utf8'));
      for (const p of world.state.players) p.online = false;
      log(`Мир загружен из ${savePath} (тик ${world.state.tick}, игроков ${world.state.players.length})`);
      return world;
    } catch (e) {
      log(`Не удалось прочитать сохранение (${(e as Error).message}) — создаю новый мир`);
    }
  }
  return World.create(seed);
}

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(resolve(root))) {
    res.writeHead(403).end();
    return;
  }
  const target = existsSync(file) ? file : join(root, 'index.html');
  if (!existsSync(target)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Клиент не собран: выполните npm run build');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
  res.end(readFileSync(target));
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(`[сервер] ${m}`));
  const world = loadWorld(opts.savePath, opts.seed, log);
  const clients = new Set<Client>();
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, tick: world.state.tick, online: clients.size }));
      return;
    }
    if (staticRoot) serveStatic(staticRoot, req, res);
    else res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

  const send = (c: Client, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };

  wss.on('connection', (ws) => {
    const client: Client = { ws, playerId: null, cache: newClientCache(), budget: MAX_COMMANDS_PER_SEC };
    clients.add(client);
    const joinTimeout = setTimeout(() => {
      if (client.playerId === null) ws.close(4000, 'join timeout');
    }, 10_000);

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return send(client, { t: 'error', msg: 'Некорректный JSON' });
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'join') {
        if (client.playerId !== null) return;
        if (msg.version !== PROTOCOL_VERSION) {
          send(client, { t: 'error', msg: 'Версия клиента устарела — обновите страницу' });
          return ws.close(4001, 'version');
        }
        const token = typeof msg.token === 'string' && /^[\w-]{8,64}$/.test(msg.token) ? msg.token : randomUUID();
        const name = typeof msg.name === 'string' ? msg.name : 'Капитан';
        const player = world.join(name, token);
        // Один игрок — одно соединение: старую вкладку отключаем.
        for (const other of clients) {
          if (other !== client && other.playerId === player.id) {
            other.playerId = null;
            other.ws.close(4002, 'replaced');
          }
        }
        client.playerId = player.id;
        clearTimeout(joinTimeout);
        send(client, { t: 'welcome', playerId: player.id, token, tickRate: TICK_RATE });
        log(`вошёл «${player.name}» (id ${player.id}), онлайн: ${[...clients].filter((c) => c.playerId !== null).length}`);
        return;
      }
      if (msg.t === 'cmd' && client.playerId !== null) {
        if (client.budget <= 0) return;
        client.budget--;
        let err: string | null;
        try {
          err = world.command(client.playerId, msg.cmd);
        } catch (e) {
          // Команда не должна уметь уронить мир для всех остальных.
          log(`ошибка команды ${JSON.stringify(msg.cmd)}: ${(e as Error).stack}`);
          err = 'Внутренняя ошибка сервера';
        }
        if (err) send(client, { t: 'error', msg: err });
      }
    });

    ws.on('close', () => {
      clearTimeout(joinTimeout);
      clients.delete(client);
      if (client.playerId !== null) {
        const stillConnected = [...clients].some((c) => c.playerId === client.playerId);
        if (!stillConnected) world.leave(client.playerId);
      }
    });
  });

  const save = () => {
    if (!opts.savePath) return;
    mkdirSync(dirname(opts.savePath), { recursive: true });
    const tmp = `${opts.savePath}.tmp`;
    writeFileSync(tmp, world.toJSON());
    renameSync(tmp, opts.savePath);
  };

  let ticks = 0;
  const loop = setInterval(() => {
    try {
      world.step();
    } catch (e) {
      log(`ошибка симуляции: ${(e as Error).stack}`);
    }
    ticks++;
    for (const c of clients) {
      if (ticks % TICK_RATE === 0) c.budget = MAX_COMMANDS_PER_SEC;
      if (c.playerId === null) continue;
      send(c, world.snapshotFor(c.playerId, c.cache));
    }
  }, 1000 / TICK_RATE);

  const saveTimer = opts.savePath ? setInterval(save, (opts.saveIntervalSec ?? 30) * 1000) : null;

  await new Promise<void>((ok) => http.listen(opts.port, opts.host ?? '0.0.0.0', ok));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  log(`слушаю http://localhost:${port} (WebSocket: /ws)`);

  return {
    port,
    world,
    save,
    close: async () => {
      clearInterval(loop);
      if (saveTimer) clearInterval(saveTimer);
      save();
      for (const c of clients) c.ws.close(1001, 'server shutdown');
      await new Promise<void>((ok) => wss.close(() => ok()));
      await new Promise<void>((ok) => http.close(() => ok()));
    },
  };
}
