/** Сторона квадратного тайла туманности. Фон — это повторение одного тайла. */
export const NEBULA_SIZE = 1024;

export interface NebulaBlob {
  x: number;
  y: number;
  r: number;
  /** Цвет центра, #rrggbb. Прозрачность задаётся при рисовании. */
  color: string;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Пятна одной звёздной системы. Семя совпадает с прежней формулой systemId * 31 + 5. */
export function nebulaBlobs(systemId: number, starColor: string, size = NEBULA_SIZE): NebulaBlob[] {
  const rnd = seeded(systemId * 31 + 5);
  const tints = ['#3949ab', '#6a1b9a', '#00838f', starColor];
  const blobs: NebulaBlob[] = [];
  for (let i = 0; i < 28; i++) {
    blobs.push({
      x: rnd() * size,
      y: rnd() * size,
      r: 120 + rnd() * 320,
      color: tints[i % tints.length]!,
    });
  }
  return blobs;
}

/**
 * Центры копий пятна, пересекающих тайл.
 * Пятно у края рисуется ещё раз с противоположной стороны, поэтому соседние тайлы стыкуются без шва.
 * Радиус меньше половины стороны — копии одного пятна не накладываются друг на друга.
 */
export function wrappedCenters(x: number, y: number, r: number, size: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
      out.push({ x: px, y: py });
    }
  }
  return out;
}

/** Смещение повторяющегося тайла в пикселях экрана, в полуинтервале (-size, 0]. */
export function tileOffset(camera: number, factor: number, size: number): number {
  const wrapped = (((camera * factor) % size) + size) % size;
  return wrapped === 0 ? 0 : -wrapped;
}

// ---------- Рисованный слой туманности: клубы газа, нити и тёмные пылевые прожилки ----------

function hashP(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Шум значений с периодом period узлов решётки — тайл стыкуется сам с собой без шва. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = (v: number) => ((v % period) + period) % period;
  const x0 = m(ix);
  const x1 = m(ix + 1);
  const y0 = m(iy);
  const y1 = m(iy + 1);
  const a = hashP(x0, y0, seed);
  const b = hashP(x1, y0, seed);
  const c = hashP(x0, y1, seed);
  const d = hashP(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Фрактальный шум на торе: u, v в [0, 1), base — число узлов на тайл у первой октавы. */
export function periodicFbm(u: number, v: number, base: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let f = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u * f, v * f, f, seed + o * 31);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * RGBA тайла туманности размером res×res (повторяется без шва). Газ — искажённый фрактальный шум,
 * поверх — светлые нити (гребни шума) и тёмные пылевые прожилки, цвета — от двух оттенков системы
 * к цвету звезды в самых плотных местах. Альфа невысокая: фон не должен спорить с игрой.
 */
export function nebulaPixels(systemId: number, starColor: string, res: number): Uint8ClampedArray {
  const rnd = seeded(systemId * 131 + 17);
  const palettes: [string, string][] = [
    ['#3949ab', '#6a1b9a'],
    ['#00838f', '#283593'],
    ['#6a1b9a', '#ad1457'],
    ['#1565c0', '#00838f'],
  ];
  const [ca, cb] = palettes[Math.floor(rnd() * palettes.length)].map(hexRgb);
  const cs = hexRgb(starColor);
  const seed = Math.floor(rnd() * 100000);
  const out = new Uint8ClampedArray(res * res * 4);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const u = x / res;
      const v = y / res;
      // Искажение координат даёт закрученные, «рваные» клубы вместо ровных пятен.
      const wu = u + (periodicFbm(u, v, 3, seed + 1, 3) - 0.5) * 0.35;
      const wv = v + (periodicFbm(u, v, 3, seed + 2, 3) - 0.5) * 0.35;
      const gas = periodicFbm(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1, 4, seed + 3, 5);
      const dens = Math.max(0, Math.min(1, (gas - 0.42) / 0.3));
      const ridge = 1 - Math.abs(periodicFbm(u, v, 6, seed + 4, 4) - 0.5) * 2;
      const fil = Math.pow(Math.max(0, ridge), 10) * dens;
      const dust = Math.max(0, Math.min(1, (periodicFbm(u, v, 5, seed + 5, 4) - 0.55) / 0.15));
      const hue = periodicFbm(u, v, 2, seed + 6, 3);
      const k = dens * dens;
      let r = ca[0] + (cb[0] - ca[0]) * hue;
      let g = ca[1] + (cb[1] - ca[1]) * hue;
      let b = ca[2] + (cb[2] - ca[2]) * hue;
      // В самых плотных местах газ подсвечен звездой.
      const hot = Math.max(0, dens - 0.7) / 0.3;
      r += (cs[0] - r) * hot * 0.5;
      g += (cs[1] - g) * hot * 0.5;
      b += (cs[2] - b) * hot * 0.5;
      const alpha = Math.min(1, (k * 0.4 + fil * 0.32) * (1 - dust * 0.85));
      const i = (y * res + x) * 4;
      out[i] = r + fil * 80;
      out[i + 1] = g + fil * 80;
      out[i + 2] = b + fil * 100;
      out[i + 3] = alpha * 255;
    }
  }
  return out;
}
