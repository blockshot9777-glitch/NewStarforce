// Рисованный рельеф поверхности: карта высот, освещение сверху-слева, тени скал, мягкие берега.
// Считается один раз на высадку в отдельный холст — дальше только масштабируется.
import { SURFACE_BIOMES, type Biome } from '@starforce/shared';
import { makeCanvas } from './gen/kit';

/** Полоса сглаживания берега: от LIQ_EDGE0 до LIQ_EDGE1 жидкость плавно переходит в грунт. */
const LIQ_EDGE0 = 0.485;
const LIQ_EDGE1 = 0.515;

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
  // Размытие масок по соседним клеткам — береговые линии и края скал без «ступенек» сетки.
  const blur = (m: Float32Array) => {
    const out = new Float32Array(w * h);
    const at = (x: number, y: number) => m[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        out[y * w + x] =
          at(x, y) * 0.25 +
          (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) * 0.125 +
          (at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)) * 0.0625;
    return out;
  };
  const blockAt = sampler(blur(block), w, h);
  // Жидкость размываем дважды: берег плавнее, а к центру водоёма растёт «глубина».
  const liquidAt = sampler(blur(blur(liquid)), w, h);
  const roughAt = sampler(blur(rough), w, h);

  // 1. Высота скал: форма по маске + рваная фактура.
  const height = new Float32Array(W * H);
  const isRock = new Uint8Array(W * H);
  const isLiquid = new Uint8Array(W * H);
  /** Поле жидкости по пикселям: >0.5 — жидкость, чуть меньше — мокрый берег. */
  const liqField = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tx = x / S;
      const ty = y / S;
      const jitter = (fbm(tx * 1.1, ty * 1.1, seed + 3) - 0.5) * 0.5;
      const b = blockAt(tx, ty) + jitter;
      // Берег слегка искривлён (до ~0.45 клетки), чтобы прямые края водоёмов из сетки стали природными.
      const wx = tx + (fbm(tx * 0.6, ty * 0.6, seed + 19, 2) - 0.5) * 0.9;
      const wy = ty + (fbm(tx * 0.6 + 7, ty * 0.6, seed + 29, 2) - 0.5) * 0.9;
      const l = liquidAt(wx, wy) + (fbm(tx * 0.9, ty * 0.9, seed + 13) - 0.5) * 0.4 + (fbm(tx * 2.6, ty * 2.6, seed + 17, 3) - 0.5) * 0.22;
      const i = y * W + x;
      liqField[i] = l;
      if (b > 0.5) {
        isRock[i] = 1;
        height[i] = (b - 0.5) * 2.2 + fbm(tx * 2.2, ty * 2.2, seed + 11, 5) * 1.4;
      } else if (l > LIQ_EDGE0) {
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
  // Как выглядит жидкость: вода (озеро, полынья, трясина), зыбучий песок, провал в руинах, раскалённая/кислотная.
  const liqStyle: 'water' | 'sand' | 'pit' | 'glow' = glowing ? 'glow' : biome === 'desert' ? 'sand' : biome === 'ruins' ? 'pit' : 'water';
  // makeCanvas — обычный холст в окне и OffscreenCanvas в фоновом потоке (terrainWorker.ts).
  const [canvas, g] = makeCanvas(W, H);
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
        // Мокрый берег вокруг водоёма — тёмная кайма.
        const wet = liqField[i];
        if (wet > 0.32 && liqStyle !== 'pit' && liqStyle !== 'glow') k *= 1 - Math.min(1, (wet - 0.32) / 0.18) * 0.35;
        r = base0 * k;
        gg = base1 * k;
        b = base2 * k;
        // Фактура грунта по биому: «гребни» шума дают тонкие извилистые линии (трещины, жилы).
        // Искажение координат (domain warp) убирает «квадратность» сетки шума у линий.
        const ridge = (sd: number, f: number, oct = 4) => {
          const wx = tx * f + (fbm(tx * f * 0.7, ty * f * 0.7, seed + sd + 1, 2) - 0.5) * 2.4;
          const wy = ty * f + (fbm(tx * f * 0.7 + 9, ty * f * 0.7, seed + sd + 2, 2) - 0.5) * 2.4;
          return 1 - Math.abs(fbm(wx, wy, seed + sd, oct) - 0.5) * 2;
        };
        if (biome === 'ice') {
          // Трещины во льду: тёмная щель со светлой кромкой сверху-слева.
          const c = ridge(81, 0.45, 3);
          if (c > 0.975) {
            const f = (c - 0.975) / 0.025;
            r *= 1 - f * 0.45;
            gg *= 1 - f * 0.4;
            b *= 1 - f * 0.3;
          } else if (c > 0.955) {
            const f = (c - 0.955) / 0.02;
            r += 30 * f;
            gg += 34 * f;
            b += 38 * f;
          }
        } else if (biome === 'desert') {
          // Барханы: косые волны ряби, искривлённые шумом.
          // Пологая сторона гребня освещена, крутая — в тени; сила ряби меняется пятнами.
          const ph = tx * 1.7 + ty * 0.9 + fbm(tx * 0.3, ty * 0.3, seed + 83, 3) * 10;
          const saw = ph / (Math.PI * 2) - Math.floor(ph / (Math.PI * 2));
          const amp = Math.max(0, fbm(tx * 0.25, ty * 0.25, seed + 84, 2) - 0.3) * 0.75;
          const f = (saw < 0.8 ? saw / 0.8 - 0.5 : (1 - saw) / 0.2 - 0.9) * amp;
          r *= 1 + f;
          gg *= 1 + f;
          b *= 1 + f;
        } else if (biome === 'volcanic') {
          // Застывшие жилы лавы: тёмный шов, местами ещё тлеет.
          const c = ridge(85, 0.6);
          if (c > 0.96) {
            const f = (c - 0.96) / 0.04;
            const ember = fbm(tx * 0.8, ty * 0.8, seed + 87, 2) > 0.55 ? f : 0;
            r = r * (1 - f * 0.5) + 200 * ember * 0.6;
            gg = gg * (1 - f * 0.5) + 60 * ember * 0.6;
            b *= 1 - f * 0.5;
          }
        } else if (biome === 'ruins') {
          // Остатки покрытия базы: плиты 2×2 клетки там, где их не съела эрозия.
          if (fbm(tx * 0.3, ty * 0.3, seed + 89, 3) > 0.52) {
            const u = tx / 2 - Math.floor(tx / 2);
            const v = ty / 2 - Math.floor(ty / 2);
            const seam = u < 0.03 || v < 0.03;
            const lit = u < 0.06 || v < 0.06;
            const tint = 0.95 + hash2(Math.floor(tx / 2), Math.floor(ty / 2), seed) * 0.15;
            const f = seam ? 0.6 : lit ? 1.18 : tint;
            r = r * f + 6;
            gg = gg * f + 7;
            b = b * f + 9;
          }
        }
        // Лава и кислота подсвечивают берег своим цветом.
        if (liqStyle === 'glow' && wet > 0.2) {
          const glow = Math.min(1, (wet - 0.2) / 0.3) ** 2 * 0.55;
          r += liq[0] * glow;
          gg += liq[1] * glow;
          b += liq[2] * glow * 0.6;
        }
              // Жидкость поверх грунта; на кромке — плавный переход (без «лесенки» пикселей).
        if (isLiquid[i]) {
          const g0 = r;
          const g1 = gg;
          const g2 = b;
          const depth = Math.max(0, Math.min(1, (liqField[i] - 0.5) * 2.5));
          // Тень берега: свет сверху-слева, значит берег затеняет воду у своей нижне-правой кромки.
          const bx = x - (shadowOff >> 1);
          const by = y - (shadowOff >> 1);
          const bankShadow = bx >= 0 && by >= 0 && !isLiquid[by * W + bx] ? 0.62 : 1;
          if (liqStyle === 'glow') {
            // Течение: светлые жилы горячего расплава, вытянутые вдоль потока.
            const flow = fbm(tx * 0.8 + fbm(tx * 0.5, ty * 0.5, seed + 71, 2) * 2, ty * 2.2, seed + 21, 3);
            const heat = 0.7 + flow * 0.7;
            r = Math.min(255, liq[0] * heat + 40 * flow);
            gg = Math.min(255, liq[1] * heat + 70 * flow * flow);
            b = liq[2] * heat;
            // Остывшая корка — крупные плиты, между ними раскалённые швы.
            const crust = fbm(tx * 1.3, ty * 1.3, seed + 51, 4) + (1 - depth) * 0.06;
            if (crust > 0.53) {
              const plate = Math.min(1, (crust - 0.53) * 9);
              const pg = 0.8 + hash2(x >> 2, y >> 2, seed + 9) * 0.25;
              // Лава — остывший базальт, кислота — оливковая пена-накипь.
              const [cr, cg, cb] = biome === 'toxic' ? [44, 48, 20] : [42, 30, 26];
              r = r * (1 - plate) + cr * pg * plate;
              gg = gg * (1 - plate) + cg * pg * plate;
              b = b * (1 - plate) + cb * pg * plate;
            } else if (crust > 0.5) {
              // Шов у края плиты — самый яркий.
              const f = 1 - Math.abs(crust - 0.515) / 0.015;
              r = Math.min(255, r + 90 * f);
              gg = Math.min(255, gg + 110 * f);
              b = Math.min(255, b + 40 * f);
            }
            // У берега расплав остывает и темнеет.
            const cool = Math.max(0, 1 - depth * 5);
            r *= 1 - cool * 0.45;
            gg *= 1 - cool * 0.6;
            b *= 1 - cool * 0.6;
          } else if (liqStyle === 'pit') {
            // Провал: стены уходят во тьму, верхняя (освещённая) кромка чуть светлее.
            // Внутренняя стенка, обращённая к свету (нижне-правая), чуть освещена.
            const k = Math.max(0.04, 0.55 * (1 - depth) ** 2) * (bankShadow < 1 ? 0.5 : 1.25);
            const base = ground[0] * 0.3 + ground[1] * 0.35 + ground[2] * 0.35;
            r = base * k + 4;
            gg = base * k + 5;
            b = base * k * 1.1 + 7;
          } else if (liqStyle === 'sand') {
            // Зыбучий песок: мелкая рябь-воронки, затягивающая к центру.
            const swirl = Math.sin((tx + ty) * 5 + fbm(tx * 1.5, ty * 1.5, seed + 61, 3) * 9) * 0.5 + 0.5;
            const k = (0.85 + swirl * 0.25 - depth * 0.25) * bankShadow;
            r = liq[0] * k * 1.3;
            gg = liq[1] * k * 1.3;
            b = liq[2] * k * 1.3;
          } else {
            // Вода: мелководье светлее и теплее (просвечивает дно), глубина темнее.
            const shallow = [liq[0] * 0.6 + ground[0] * 0.5, liq[1] * 0.6 + ground[1] * 0.5, liq[2] * 0.6 + ground[2] * 0.5];
            const deep = [liq[0] * 0.45, liq[1] * 0.5, liq[2] * 0.6];
            const dd = Math.sqrt(depth);
            r = shallow[0] + (deep[0] - shallow[0]) * dd;
            gg = shallow[1] + (deep[1] - shallow[1]) * dd;
            b = shallow[2] + (deep[2] - shallow[2]) * dd;
            // Рябь: широкие пологие волны (вытянуты по горизонтали), рассеянный свет и редкие блики (Блинн).
            const e = 0.08;
            const wv = (u: number, v: number) => fbm(u * 1.1, v * 2.4, seed + 23, 2);
            const n0 = wv(tx, ty);
            const nx = ((wv(tx + e, ty) - n0) / e) * 0.32;
            const ny = ((wv(tx, ty + e) - n0) / e) * 0.32;
            const len = Math.hypot(nx, ny, 1);
            const dot = (-nx * lx - ny * ly + lz) / len;
            const lightK = 0.85 + (dot - lz) * 1.2;
            r *= lightK;
            gg *= lightK;
            b *= lightK;
            // Половинный вектор между светом и взглядом сверху: (-0.304, -0.304, 0.902).
            const nh = (-nx * -0.304 - ny * -0.304 + 0.902) / len;
            const spec = Math.pow(Math.max(0, nh), 90) * (0.35 + dd * 0.65) * 0.9;
            r += 210 * spec;
            gg += 225 * spec;
            b += 235 * spec;
            // Трясина: островки ряски и тины на поверхности.
            if (biome === 'jungle') {
              const al = fbm(tx * 1.8, ty * 1.8, seed + 91, 4);
              if (al > 0.52) {
                const f = Math.min(1, (al - 0.52) * 14) * (0.75 + hash2(x >> 1, y >> 1, seed + 93) * 0.25);
                r = r * (1 - f) + 58 * f;
                gg = gg * (1 - f) + 92 * f;
                b = b * (1 - f) + 40 * f;
              }
            }
            r *= bankShadow;
            gg *= bankShadow;
            b *= bankShadow;
            // Светлая полоска прибоя у самой кромки.
            if (depth < 0.08) {
              const f = (1 - depth / 0.08) * 0.35;
              r += (190 - r) * f;
              gg += (205 - gg) * f;
              b += (210 - b) * f;
            }
          }
          const a = Math.min(1, (liqField[i] - LIQ_EDGE0) / (LIQ_EDGE1 - LIQ_EDGE0));
          r = g0 + (r - g0) * a;
          gg = g1 + (gg - g1) * a;
          b = g2 + (b - g2) * a;
        }
      }
      d[i * 4] = Math.max(0, Math.min(255, r));
      d[i * 4 + 1] = Math.max(0, Math.min(255, gg));
      d[i * 4 + 2] = Math.max(0, Math.min(255, b));
      d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  drawDecals(g, w, h, S, biome, seed, (px, py) => {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return false;
    const j = iy * W + ix;
    return !isRock[j] && !isLiquid[j] && liqField[j] < 0.4;
  });
  // Лёгкая виньетка, чтобы карта не обрывалась резко.
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  return canvas;
}

/** Мелкие детали поверх грунта: пучки травы, папоротник, грибные шляпки, камешки. Рисуются один раз. */
function drawDecals(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  S: number,
  biome: Biome,
  seed: number,
  free: (px: number, py: number) => boolean,
): void {
  const n = w * h;
  for (let k = 0; k < n * 1.6; k++) {
    const px = hash2(k, 1, seed + 101) * w * S;
    const py = hash2(k, 2, seed + 101) * h * S;
    if (!free(px, py)) continue;
    // Детали кучкуются по шуму — поляны и проплешины, а не ровная россыпь.
    if (fbm(px / S / 3, py / S / 3, seed + 107, 2) < (biome === 'jungle' ? 0.4 : 0.47)) continue;
    const kind = hash2(k, 3, seed + 101);
    const sz = S * (0.25 + hash2(k, 4, seed + 101) * 0.35);
    if (biome === 'terran' || biome === 'jungle') {
      // Пучок травы: несколько изогнутых травинок от одной точки, тень снизу-справа.
      const dark = biome === 'jungle' ? 'rgba(6,18,8,0.45)' : 'rgba(14,28,12,0.4)';
      const lite = biome === 'jungle' ? 'rgba(62,108,52,0.45)' : 'rgba(104,138,70,0.4)';
      const blades = biome === 'jungle' && kind > 0.7 ? 7 : 4;
      g.lineCap = 'round';
      for (const [col, off] of [[dark, 1.2], [lite, 0]] as const) {
        g.strokeStyle = col;
        g.lineWidth = biome === 'jungle' && kind > 0.7 ? 2 : 1.2;
        for (let b = 0; b < blades; b++) {
          const a = -Math.PI / 2 + (b / (blades - 1) - 0.5) * 2.2 + (hash2(k, 10 + b, seed) - 0.5) * 0.5;
          const len = sz * (0.6 + hash2(k, 20 + b, seed) * 0.5);
          g.beginPath();
          g.moveTo(px + off, py + off);
          g.quadraticCurveTo(px + off + Math.cos(a) * len * 0.5, py + off + Math.sin(a) * len * 0.6, px + off + Math.cos(a) * len, py + off + Math.sin(a) * len * 0.7 + len * 0.15);
          g.stroke();
        }
      }
    } else if (biome === 'toxic') {
      if (kind > 0.22) continue;
      // Грибная шляпка: тень, купол со светом сверху-слева, светящиеся пятнышки.
      // Кучка из 1–3 шляпок разного размера.
      const caps = 1 + Math.floor(hash2(k, 6, seed) * 3);
      for (let c = 0; c < caps; c++) {
        const r = sz * (0.3 + hash2(k, 30 + c, seed) * 0.35) * (c === 0 ? 1.3 : 1);
        const cx = px + (c === 0 ? 0 : (hash2(k, 40 + c, seed) - 0.5) * sz * 1.6);
        const cy = py + (c === 0 ? 0 : (hash2(k, 50 + c, seed) - 0.5) * sz * 1.6);
        if (!free(cx, cy)) continue;
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.beginPath();
        g.ellipse(cx + r * 0.4, cy + r * 0.4, r, r * 0.9, 0, 0, Math.PI * 2);
        g.fill();
        const gr = g.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
        gr.addColorStop(0, '#8c8846');
        gr.addColorStop(0.6, '#55542a');
        gr.addColorStop(1, '#2a2b14');
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI * 2);
        g.fill();
        // Светящиеся споровые пятна.
        g.fillStyle = 'rgba(200,235,80,0.75)';
        for (let sp = 0; sp < 3; sp++) {
          const a = hash2(k, 60 + sp + c * 3, seed) * Math.PI * 2;
          const rr = r * 0.55 * hash2(k, 70 + sp + c * 3, seed);
          g.beginPath();
          g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9, Math.max(0.7, r * 0.1), 0, Math.PI * 2);
          g.fill();
        }
      }
    } else {
      if (kind > (biome === 'ice' ? 0.12 : 0.35)) continue;
      // Камешек: тень и освещённый сверху-слева бок.
      const r = sz * 0.18;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(px + r * 0.5, py + r * 0.5, r, r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = biome === 'ice' ? 'rgba(220,235,245,0.55)' : 'rgba(150,140,130,0.4)';
      g.beginPath();
      g.ellipse(px, py, r, r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}
