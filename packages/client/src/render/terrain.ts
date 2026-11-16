// Рисованный рельеф поверхности: карта высот, освещение сверху-слева, тени скал, мягкие берега.
// Считается один раз на высадку в отдельный холст — дальше только масштабируется.
import { SURFACE_BIOMES, type Biome } from '@starforce/shared';

/** Пикселей на клетку в текстуре рельефа. */
export const TERRAIN_PX = 24;

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
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

function fbm(x: number, y: number, seed: number, octaves = 4): number {
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

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Доля клеток класса вокруг точки (билинейно по центрам клеток) — даёт скруглённые, «природные» края. */
function sampler(mask: Float32Array, w: number, h: number) {
  return (px: number, py: number) => {
    const fx = px - 0.5;
    const fy = py - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const v = (x: number, y: number) => mask[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx;
    const b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

export function renderTerrain(terrain: string, w: number, h: number, biome: Biome, seed: number): HTMLCanvasElement {
  const def = SURFACE_BIOMES[biome];
  const S = TERRAIN_PX;
  const W = w * S;
  const H = h * S;
  const block = new Float32Array(w * h);
  const liquid = new Float32Array(w * h);
  const rough = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    block[i] = terrain[i] === '#' ? 1 : 0;
    liquid[i] = terrain[i] === '~' ? 1 : 0;
    rough[i] = terrain[i] === ',' ? 1 : 0;
  }
  const blockAt = sampler(block, w, h);
  const liquidAt = sampler(liquid, w, h);
  const roughAt = sampler(rough, w, h);

  // 1. Высота скал: форма по маске + рваная фактура.
  const height = new Float32Array(W * H);
  const isRock = new Uint8Array(W * H);
  const isLiquid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tx = x / S;
      const ty = y / S;
      const jitter = (fbm(tx * 1.3, ty * 1.3, seed + 3) - 0.5) * 0.35;
      const b = blockAt(tx, ty) + jitter;
      const l = liquidAt(tx, ty) + jitter * 0.6;
      const i = y * W + x;
      if (b > 0.5) {
        isRock[i] = 1;
        height[i] = (b - 0.5) * 2.2 + fbm(tx * 2.2, ty * 2.2, seed + 11, 5) * 1.4;
      } else if (l > 0.5) {
        isLiquid[i] = 1;
        height[i] = -(l - 0.5);
      }
    }
  }

  const ground = rgb(def.ground);
  const roughC = rgb(def.rough);
  const rock = rgb(def.block);
  const liq = rgb(def.liquid);
  const glowing = biome === 'volcanic' || biome === 'toxic';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(W, H);
  const d = img.data;
  // Свет сверху-слева.
  const lx = -0.55;
  const ly = -0.55;
  const lz = 0.63;
  const shadowOff = Math.round(S * 0.35);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const tx = x / S;
      const ty = y / S;
      let r: number;
      let gg: number;
      let b: number;
      if (isRock[i]) {
        const hx = height[i + (x < W - 1 ? 1 : 0)] - height[i - (x > 0 ? 1 : 0)];
        const hy = height[i + (y < H - 1 ? W : 0)] - height[i - (y > 0 ? W : 0)];
        const nx = -hx * 6;
        const ny = -hy * 6;
        const len = Math.hypot(nx, ny, 1);
        const lambert = Math.max(0, (nx * lx + ny * ly + lz) / len);
        const k = 0.35 + lambert * 0.95 + height[i] * 0.08;
        const grain = 0.9 + hash2(x, y, seed + 5) * 0.2;
        r = rock[0] * k * grain;
        gg = rock[1] * k * grain;
        b = rock[2] * k * grain;
        // Тёмный контур подножия скалы.
        if ((x > 0 && !isRock[i - 1]) || (y > 0 && !isRock[i - W]) || (x < W - 1 && !isRock[i + 1]) || (y < H - 1 && !isRock[i + W])) {
          r *= 0.55;
          gg *= 0.55;
          b *= 0.55;
        }
      } else if (isLiquid[i]) {
        const depth = Math.min(1, -height[i] * 3);
        const wave = fbm(tx * 3 + 0.3, ty * 1.2, seed + 21, 3);
        const k = glowing ? 0.75 + wave * 0.6 : 0.55 + (1 - depth) * 0.35 + (wave - 0.5) * 0.25;
        r = liq[0] * k;
        gg = liq[1] * k;
        b = liq[2] * k;
        // Светлая кромка у берега.
        if (depth < 0.15) {
          r = r * 0.7 + 255 * 0.12;
          gg = gg * 0.7 + 255 * 0.12;
          b = b * 0.7 + 255 * 0.12;
        }
      } else {
        const rw = Math.min(1, roughAt(tx, ty) * 1.5);
        const base0 = ground[0] + (roughC[0] - ground[0]) * rw;
        const base1 = ground[1] + (roughC[1] - ground[1]) * rw;
        const base2 = ground[2] + (roughC[2] - ground[2]) * rw;
        const large = fbm(tx * 0.35, ty * 0.35, seed + 31, 3);
        const detail = fbm(tx * 2.5, ty * 2.5, seed + 41, 3);
        const grain = hash2(x, y, seed + 7);
        let k = 0.72 + large * 0.45 + (detail - 0.5) * 0.25 + (grain - 0.5) * 0.12;
        // Тень от скалы: свет сверху-слева, значит скала затеняет землю снизу-справа от себя.
        const sx = x - shadowOff;
        const sy = y - shadowOff;
        if (sx >= 0 && sy >= 0 && isRock[sy * W + sx]) k *= 0.55;
        // Мелкие камешки.
        if (grain > 0.985) k *= 0.6;
        r = base0 * k;
        gg = base1 * k;
        b = base2 * k;
      }
      d[i * 4] = Math.max(0, Math.min(255, r));
      d[i * 4 + 1] = Math.max(0, Math.min(255, gg));
      d[i * 4 + 2] = Math.max(0, Math.min(255, b));
      d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Лёгкая виньетка, чтобы карта не обрывалась резко.
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  return canvas;
}
