// Набор для процедурных спрайтов: шум, освещение карт высот, холсты, кэш.
// Всё рисуется один раз в отдельный холст и дальше только масштабируется.

/**
 * Холст для генерации. В фоновом потоке (Web Worker) нет document — там OffscreenCanvas;
 * для кода генераторов разницы нет, тип приводится к обычному холсту.
 */
export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof document === 'undefined') {
    const c = new OffscreenCanvas(cw, ch);
    return [c as unknown as HTMLCanvasElement, c.getContext('2d') as unknown as CanvasRenderingContext2D];
  }
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return [c, c.getContext('2d')!];
}

export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 17);
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

/** Генератор случайных чисел для одного спрайта (детерминированный по seed). */
export function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RGB = [number, number, number];

export function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Свет сверху-слева, как во всём арте проекта. */
export const LIGHT = (() => {
  const v = [-0.5, -0.6, 0.62];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l] as const;
})();

export interface LitPixel {
  /** Высота (произвольные единицы); 0 и меньше вне формы при alpha 0. */
  h: number;
  color: RGB;
  alpha: number;
  /** Блеск: 0 — матовый камень, 1 — полированный металл. */
  gloss?: number;
  /** Свечение — добавляется без освещения (лампы, лава, глаза). */
  emit?: RGB;
}

/**
 * Освещённый спрайт из карты высот: fn(u, v) для u, v ∈ [0, 1).
 * strength — насколько рельефно (множитель наклона нормали).
 */
export function litSprite(w: number, h: number, fn: (u: number, v: number) => LitPixel, strength = 4): HTMLCanvasElement {
  const [c, g] = makeCanvas(w, h);
  const px: LitPixel[] = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = fn((x + 0.5) / w, (y + 0.5) / h);
  const img = g.createImageData(w, h);
  const d = img.data;
  const H = (x: number, y: number) => px[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))].h;
  const [lx, ly, lz] = LIGHT;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = px[y * w + x];
      const i = (y * w + x) * 4;
      if (p.alpha <= 0) {
        d[i + 3] = 0;
        continue;
      }
      const nx = -(H(x + 1, y) - H(x - 1, y)) * strength;
      const ny = -(H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(nx, ny, 1);
      const ndl = (nx * lx + ny * ly + lz) / len;
      const diffuse = 0.32 + Math.max(0, ndl) * 0.9;
      // Блик: отражение света к зрителю (смотрим сверху).
      const rz = 2 * ndl * (1 / len) - lz;
      const spec = p.gloss ? Math.pow(Math.max(0, rz), 18) * p.gloss * 160 : 0;
      const e = p.emit ?? [0, 0, 0];
      d[i] = Math.min(255, p.color[0] * diffuse + spec + e[0]);
      d[i + 1] = Math.min(255, p.color[1] * diffuse + spec + e[1]);
      d[i + 2] = Math.min(255, p.color[2] * diffuse + spec + e[2]);
      d[i + 3] = Math.round(255 * Math.min(1, p.alpha));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Расстояние до края маски (в пикселях, внутри формы), двухпроходный chamfer —
 * для фасок и объёма корпуса.
 */
export function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) v = Math.min(v, d[i - w] + a);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + b);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + b);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = Math.min(v, 1);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) v = Math.min(v, d[i + w] + a);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + b);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + b);
      d[i] = v;
    }
  }
  return d;
}

/** Ограниченный кэш сгенерированных спрайтов. */
export class SpriteCache<T> {
  private map = new Map<string, T>();
  constructor(private limit = 200) {}
  get(key: string, make: () => T): T {
    let v = this.map.get(key);
    if (v === undefined) {
      v = make();
      this.map.set(key, v);
      if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value!);
    }
    return v;
  }
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Спрайт из векторной формы: маска рисуется обычным canvas, объём — фаска по расстоянию до края,
 * детали — pixel(u, v, edge, base) поверх.
 */
export function shapeSprite(
  size: number,
  drawMask: (g: CanvasRenderingContext2D, s: number) => void,
  pixel: (u: number, v: number, edge: number, base: number) => LitPixel,
  bevel = 0.08,
  strength = 4,
): HTMLCanvasElement {
  const [mc, mg] = makeCanvas(size, size);
  mg.fillStyle = '#fff';
  drawMask(mg, size);
  const data = mg.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size);
  const cover = new Float32Array(size * size);
  for (let i = 0; i < mask.length; i++) {
    cover[i] = data[i * 4 + 3] / 255;
    mask[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  }
  void mc;
  const dist = distanceInside(mask, size, size);
  const bevelPx = size * bevel;
  return litSprite(
    size,
    size,
    (u, v) => {
      const i = Math.min(size - 1, Math.floor(v * size)) * size + Math.min(size - 1, Math.floor(u * size));
      if (!mask[i]) return { h: -1, color: [0, 0, 0], alpha: 0 };
      const edge = dist[i] / size;
      const p = pixel(u, v, edge, smooth(dist[i] / bevelPx));
      return { ...p, alpha: cover[i] };
    },
    strength,
  );
}

