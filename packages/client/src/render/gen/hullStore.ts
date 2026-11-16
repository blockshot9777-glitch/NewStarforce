// Хранилище корпусов: генерация в фоновом потоке, пока она идёт — рисуется прежний корпус.
import { generateHull, type HullInput, type HullSprite } from './hull';

interface Entry {
  key: string;
  sprite: HullSprite;
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
      current.set(slot, { key, sprite });
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
  const have = current.get(slot);
  if (have?.key === key) return have.sprite;
  const w = have ? getWorker() : null;
  if (!have || !w) {
    const sprite = generateHull(input);
    current.set(slot, { key, sprite });
    return sprite;
  }
  if (!pending.has(key)) {
    pending.add(key);
    w.postMessage({ key, input });
  }
  return have.sprite;
}
