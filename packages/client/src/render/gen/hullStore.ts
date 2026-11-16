// Хранилище корпусов: генерация в фоновом потоке, пока она идёт — рисуется прежний корпус.
import { generateHull, type HullInput, type HullSprite } from './hull';

interface Entry {
  key: string;
  sprite: HullSprite;
  /** Когда корпус последний раз рисовали — давно не виденные корабли выбрасываются из кэша. */
  used: number;
}

const KEEP_MS = 60_000;
let lastSweep = 0;

/** Раз в ~10 с убрать корпуса кораблей, которых минуту не было в кадре (улетели, вышли из игры). */
function sweep(now: number): void {
  if (now - lastSweep < 10_000) return;
  lastSweep = now;
  for (const [slot, e] of current) {
    if (now - e.used < KEEP_MS) continue;
    const c = e.sprite.canvas as unknown as { close?: () => void };
    if (typeof c.close === 'function') c.close();
    current.delete(slot);
  }
}

const current = new Map<string, Entry>();
const pending = new Set<string>();
let worker: Worker | null | undefined;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof OffscreenCanvas !== 'undefined' ? new Worker(new URL('./hullWorker.ts', import.meta.url), { type: 'module' }) : null;
    worker?.addEventListener('message', (e: MessageEvent<{ key: string; sprite: HullSprite }>) => {
      const { key, sprite } = e.data;
      pending.delete(key);
      const slot = key.slice(0, key.indexOf('|'));
      // Корабль могли выбросить из кэша, пока корпус считался, — тогда результат не нужен.
      const had = current.get(slot);
      if (had) current.set(slot, { key, sprite, used: had.used });
    });
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Корпус для отрисовки. slot — «какой это корабль и вид», key — его точная версия.
 * Первый раз — синхронно (корабль не должен пропадать), дальше — в фоне.
 */
export function hullFor(slot: string, version: string, input: HullInput): HullSprite {
  const key = `${slot}|${version}`;
  const now = performance.now();
  sweep(now);
  const have = current.get(slot);
  if (have) have.used = now;
  if (have?.key === key) return have.sprite;
  const w = have ? getWorker() : null;
  if (!have || !w) {
    const sprite = generateHull(input);
    current.set(slot, { key, sprite, used: now });
    return sprite;
  }
  if (!pending.has(key)) {
    pending.add(key);
    w.postMessage({ key, input });
  }
  return have.sprite;
}
