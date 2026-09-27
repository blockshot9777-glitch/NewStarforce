import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const staticDir = resolve(root, 'packages/client/dist');

const server = await startServer({
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  savePath: process.env.SAVE_PATH ?? resolve(root, 'data/world.json'),
  saveIntervalSec: Number(process.env.SAVE_INTERVAL ?? 30),
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  seed: process.env.SEED ? Number(process.env.SEED) : undefined,
});

if (existsSync(staticDir)) console.log(`[сервер] игра: http://localhost:${server.port}`);
else console.log('[сервер] клиент не собран — для разработки запустите `npm run dev` и откройте http://localhost:5173');

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    console.log('[сервер] сохраняю мир и выключаюсь…');
    await server.close();
    process.exit(0);
  });
}
