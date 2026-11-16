// Процедурные спрайты космоса: астероиды, планеты, станции, враги, контейнеры.
// Все освещены одинаково (сверху-слева), как корпус и арт интерьера.
import { BIOMES, type Biome, type NpcType, type Resource } from '@starforce/shared';
import { fbm, hash2, hex, litSprite, makeCanvas, mix, rand, shapeSprite, SpriteCache, type RGB } from './kit';

// ---------- Астероиды ----------

const VEIN: Partial<Record<Resource, { color: RGB; gloss: number; emit?: RGB }>> = {
  metal: { color: hex('#c6ccd3'), gloss: 0.9 },
  ice: { color: hex('#d6f3ff'), gloss: 0.8 },
  crystals: { color: hex('#b46ad8'), gloss: 0.6, emit: [25, 5, 40] },
};

const asteroids = new SpriteCache<HTMLCanvasElement>(150);

/** Каменная глыба с кратерами; прожилки показывают, что в ней есть (металл, лёд, кристаллы). */
export function asteroidSprite(id: number, kinds: Resource[]): HTMLCanvasElement {
  return asteroids.get(`${id}:${kinds.join(',')}`, () => {
    const R = rand(id * 13 + 5);
    const tint = mix(hex('#6b5d52'), hex('#5a5f66'), R());
    const craters = Array.from({ length: 5 }, () => ({ x: 0.3 + R() * 0.4, y: 0.3 + R() * 0.4, r: 0.04 + R() * 0.08 }));
    const veins = kinds.filter((k) => VEIN[k]);
    const S = 128;
    return litSprite(
      S,
      S,
      (u, v) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const rad = 0.33 + 0.1 * (fbm(Math.cos(a) * 1.4 + id, Math.sin(a) * 1.4 + id, id, 3) - 0.5) * 2 + 0.04 * Math.sin(a * 3 + id);
        if (d > rad) return { h: -1, color: [0, 0, 0], alpha: 0 };
        let h = Math.sqrt(Math.max(0, 1 - (d / rad) ** 2)) * 1.4 + fbm(u * 6, v * 6, id + 3, 4) * 0.5;
        for (const c of craters) {
          const cd = Math.hypot(u - c.x, v - c.y) / c.r;
          if (cd < 1) h -= (1 - cd * cd) * 0.35;
          else if (cd < 1.25) h += (1.25 - cd) * 0.25;
        }
        let color: RGB = [tint[0] * (0.8 + fbm(u * 10, v * 10, id, 3) * 0.4), tint[1] * (0.8 + fbm(u * 10, v * 10, id, 3) * 0.4), tint[2] * (0.85 + fbm(u * 9, v * 9, id + 1, 3) * 0.3)];
        let gloss = 0.05;
        let emit: RGB | undefined;
        veins.forEach((k, vi) => {
          const n = fbm(u * 4 + vi * 7, v * 4, id + 40 + vi * 9, 3);
          if (Math.abs(n - 0.5) < 0.016) {
            const vd = VEIN[k]!;
            color = vd.color;
            gloss = vd.gloss;
            emit = vd.emit;
          }
        });
        return { h, color, alpha: 1, gloss, emit };
      },
      5,
    );
  });
}

// ---------- Планеты ----------

interface PlanetPalette {
  low: RGB;
  mid: RGB;
  high: RGB;
  /** Уровень «моря»: ниже — low. */
  sea: number;
  clouds: number;
  emit?: RGB;
}

const PLANET: Record<Biome, PlanetPalette> = {
  terran: { low: hex('#173f73'), mid: hex('#3d6b38'), high: hex('#8a7a58'), sea: 0.5, clouds: 0.55 },
  jungle: { low: hex('#163a1f'), mid: hex('#2f6b2a'), high: hex('#5c8f34'), sea: 0.38, clouds: 0.6 },
  ice: { low: hex('#8fb3c8'), mid: hex('#c9e2ee'), high: hex('#f2fbff'), sea: 0.35, clouds: 0.3 },
  desert: { low: hex('#7a3d1e'), mid: hex('#b8693a'), high: hex('#e0a56a'), sea: 0.3, clouds: 0.15 },
  volcanic: { low: hex('#1b1210'), mid: hex('#3b2420'), high: hex('#5a3a30'), sea: 0.42, clouds: 0.2, emit: [255, 90, 20] },
  ruins: { low: hex('#2c3135'), mid: hex('#4a5258'), high: hex('#7a8389'), sea: 0.4, clouds: 0.25 },
  toxic: { low: hex('#4a4f12'), mid: hex('#7d8a1c'), high: hex('#c2cf3a'), sea: 0.45, clouds: 0.5 },
};

const planets = new SpriteCache<HTMLCanvasElement>(40);

/** Шар планеты без направленного света (терминатор накладывается при отрисовке — со стороны звезды). */
export function planetSprite(id: number, biome: Biome): HTMLCanvasElement {
  return planets.get(`${id}:${biome}`, () => {
    const pal = PLANET[biome];
    const S = 256;
    const [c, g] = makeCanvas(S, S);
    const img = g.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const nx = (x + 0.5) / S * 2 - 1;
        const ny = (y + 0.5) / S * 2 - 1;
        const r2 = nx * nx + ny * ny;
        const i = (y * S + x) * 4;
        if (r2 > 1) {
          d[i + 3] = 0;
          continue;
        }
        const nz = Math.sqrt(1 - r2);
        // Проекция на сферу — рисунок «обтекает» шар.
        const su = Math.atan2(nx, nz) * 1.6 + id;
        const sv = Math.asin(ny) * 1.6;
        const n = fbm(su * 1.3, sv * 1.3, id, 5);
        let col: RGB;
        let e: RGB = [0, 0, 0];
        if (biome === 'desert' || biome === 'toxic') {
          // Полосы дюн/облачных поясов.
          const band = 0.5 + 0.5 * Math.sin(sv * 7 + n * 6);
          col = mix(pal.low, pal.high, band * 0.7 + n * 0.3);
        } else {
          // Плавный берег вместо резкой границы «моря».
          const shore = Math.max(0, Math.min(1, (n - pal.sea) / 0.06 + 0.5));
          const sea = mix(pal.low, pal.mid, (n / pal.sea) * 0.4);
          const land = mix(pal.mid, pal.high, Math.max(0, Math.min(1, ((n - pal.sea) / (1 - pal.sea)) * 1.8)));
          col = mix(sea, land, shore);
        }
        if (pal.emit && Math.abs(fbm(su * 3, sv * 3, id + 7, 3) - 0.5) < 0.03) e = pal.emit;
        if (biome === 'ruins' && hash2(Math.floor(su * 30), Math.floor(sv * 30), id) > 0.985) e = [255, 140, 90];
        // Облака.
        const cl = fbm(su * 2 + 5, sv * 2.6, id + 21, 4);
        const cover = Math.max(0, (cl - (1 - pal.clouds)) * 3);
        col = mix(col, [235, 240, 245], Math.min(0.85, cover));
        // Затемнение к краю диска.
        const limb = 0.55 + 0.45 * nz;
        d[i] = Math.min(255, col[0] * limb + e[0]);
        d[i + 1] = Math.min(255, col[1] * limb + e[1]);
        d[i + 2] = Math.min(255, col[2] * limb + e[2]);
        d[i + 3] = Math.round(255 * Math.min(1, (1 - Math.sqrt(r2)) * S * 0.5));
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  });
}

/** Планета в кадре: шар, ночная сторона от звезды, атмосфера по краю. */
export function drawPlanetBody(ctx: CanvasRenderingContext2D, id: number, biome: Biome, x: number, y: number, r: number, toSun: number): void {
  const glow = BIOMES[biome].glow;
  const atm = ctx.createRadialGradient(x, y, r * 0.95, x, y, r * 1.22);
  atm.addColorStop(0, glow + '55');
  atm.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = atm;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(planetSprite(id, biome), x - r, y - r, r * 2, r * 2);
  // Терминатор: тень с противоположной от звезды стороны.
  const sx = Math.cos(toSun);
  const sy = Math.sin(toSun);
  const shade = ctx.createLinearGradient(x + sx * r, y + sy * r, x - sx * r, y - sy * r);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.35, 'rgba(2,3,8,0.05)');
  shade.addColorStop(0.55, 'rgba(2,3,8,0.42)');
  shade.addColorStop(0.75, 'rgba(2,3,8,0.85)');
  shade.addColorStop(1, 'rgba(2,3,8,0.96)');
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // Блик атмосферы на освещённом краю.
  const rim = ctx.createRadialGradient(x + sx * r * 0.2, y + sy * r * 0.2, r * 0.8, x, y, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, glow + '66');
  ctx.fillStyle = rim;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// ---------- Станция ----------

const stations = new SpriteCache<HTMLCanvasElement>(10);

/** Станция-кольцо: тор с жилыми модулями, спицы, ступица со шлюзами, причальные фермы, солнечные крылья. */
export function stationSprite(id: number): HTMLCanvasElement {
  return stations.get(String(id), () => {
    const S = 360;
    const R0 = 0.3;
    const W0 = 0.045;
    const PODS = 8;
    return litSprite(
      S,
      S,
      (u, v) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const metal: RGB = hex('#a7afb8');
        // Жилые модули на кольце: прямоугольные блоки поперёк тора.
        const pa = Math.round((a / (Math.PI * 2)) * PODS) * ((Math.PI * 2) / PODS);
        const along = dx * Math.cos(pa) + dy * Math.sin(pa);
        const across = -dx * Math.sin(pa) + dy * Math.cos(pa);
        if (Math.abs(along - R0) < W0 * 1.6 && Math.abs(across) < 0.035) {
          const win = Math.abs(along - R0) < W0 * 1.2 && Math.abs(((across + 0.035) / 0.0175) % 1 - 0.5) < 0.18 && Math.abs(along - R0 - W0 * 0.6) < 0.008;
          return { h: 2.4 - Math.abs(across) * 8, color: win ? hex('#ffd98a') : hex('#c4cad1'), alpha: 1, gloss: 0.5, emit: win ? [120, 90, 30] : undefined };
        }
        // Тор.
        const t = (d - R0) / W0;
        if (Math.abs(t) < 1) {
          const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 32);
          const k = 0.82 + hash2(seg, 0, id) * 0.25;
          const seam = Math.abs(((((a + Math.PI) / (Math.PI * 2)) * 32) % 1) - 0.5) > 0.46;
          return { h: Math.sqrt(1 - t * t) * 2 - (seam ? 0.3 : 0), color: [metal[0] * k, metal[1] * k, metal[2] * k], alpha: 1, gloss: 0.4 };
        }
        // Спицы-трубы.
        for (let s = 0; s < 4; s++) {
          const sa = (s * Math.PI) / 2 + Math.PI / 4;
          const al = dx * Math.cos(sa) + dy * Math.sin(sa);
          const ac = -dx * Math.sin(sa) + dy * Math.cos(sa);
          if (al > 0.08 && al < R0 && Math.abs(ac) < 0.014) return { h: 1 - Math.abs(ac) * 40, color: hex('#7d858e'), alpha: 1, gloss: 0.4 };
        }
        // Причальные фермы с огнём на конце (по вертикали).
        if (Math.abs(dx) < 0.012 && Math.abs(dy) > R0 + W0 && Math.abs(dy) < 0.47) return { h: 0.6, color: hex('#8a929b'), alpha: 1 };
        if (Math.abs(dx) < 0.03 && Math.abs(Math.abs(dy) - 0.46) < 0.02) return { h: 1, color: hex('#5e666f'), alpha: 1, gloss: 0.5 };
        // Солнечные крылья на штангах (по горизонтали).
        if (Math.abs(dy) < 0.006 && Math.abs(dx) > R0 && Math.abs(dx) < 0.49) return { h: 0.4, color: hex('#8a929b'), alpha: 1 };
        for (const off of [-0.045, 0.045]) {
          if (Math.abs(dy - off) < 0.035 && Math.abs(dx) > R0 + W0 + 0.02 && Math.abs(dx) < 0.49) {
            const cell = Math.abs(((Math.abs(dx) * 70) % 1) - 0.5) > 0.42 || Math.abs((((dy - off) / 0.07 + 0.5) * 4) % 1 - 0.5) > 0.44;
            return { h: 0.3, color: cell ? hex('#59616c') : hex('#1b2d5e'), alpha: 1, gloss: 0.9 };
          }
        }
        // Ступица.
        if (d < 0.095) {
          const h = Math.sqrt(1 - (d / 0.095) ** 2) * 2.4;
          const ring = Math.abs(d - 0.062) < 0.006;
          const port = d < 0.025;
          return { h: h - (ring ? 0.25 : 0), color: port ? hex('#2a3038') : ring ? hex('#4a5058') : hex('#d1d6dc'), alpha: 1, gloss: 0.5, emit: port ? [20, 60, 70] : undefined };
        }
        return { h: -1, color: [0, 0, 0], alpha: 0 };
      },
      4,
    );
  });
}

// ---------- Враги ----------

const npcs = new SpriteCache<HTMLCanvasElement>(10);

/** Спрайты врагов, носом вправо (поворачиваются по курсу). */
export function npcSprite(type: NpcType): HTMLCanvasElement {
  return npcs.get(type, () => {
    const S = 128;
    if (type === 'drone') {
      return shapeSprite(
        S,
        (g, s) => {
          g.beginPath();
          g.moveTo(s * 0.92, s * 0.5);
          g.lineTo(s * 0.3, s * 0.2);
          g.lineTo(s * 0.18, s * 0.32);
          g.lineTo(s * 0.32, s * 0.5);
          g.lineTo(s * 0.18, s * 0.68);
          g.lineTo(s * 0.3, s * 0.8);
          g.closePath();
          g.fill();
          for (const y of [0.24, 0.76]) {
            g.beginPath();
            g.roundRect(s * 0.1, s * (y - 0.07), s * 0.36, s * 0.14, s * 0.05);
            g.fill();
          }
        },
        (u, v, _edge, base) => {
          const spine = Math.max(0, 1 - Math.abs(v - 0.5) / 0.06) * (u > 0.35 ? 1 : 0);
          const eye = Math.hypot(u - 0.62, v - 0.5) < 0.05;
          const plate = 0.85 + hash2(Math.floor(u * 8), Math.floor(v * 6), 3) * 0.2;
          const c = hex('#454c55');
          return {
            h: base * 1.2 + spine * 0.8,
            color: eye ? hex('#ff2a3a') : [c[0] * plate, c[1] * plate, c[2] * plate],
            alpha: 1,
            gloss: 0.5,
            emit: eye ? [200, 20, 30] : undefined,
          };
        },
        0.06,
        5,
      );
    }
    if (type === 'sentinel') {
      return shapeSprite(
        S,
        (g, s) => {
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            g.lineTo(s / 2 + Math.cos(a) * s * 0.44, s / 2 + Math.sin(a) * s * 0.44);
          }
          g.closePath();
          g.fill();
        },
        (u, v, _edge, base) => {
          const dx = u - 0.5;
          const dy = v - 0.5;
          const d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const ring = Math.abs(d - 0.26) < 0.015;
          const core = d < 0.1;
          const plate = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6);
          const k = 0.8 + hash2(plate, d > 0.26 ? 1 : 0, 9) * 0.3;
          const c = hex('#3a4048');
          return {
            h: base * 1.4 + (d < 0.26 ? 0.6 : 0) + (core ? (0.1 - d) * 10 : 0) - (ring ? 0.4 : 0),
            color: core ? hex('#ff3b30') : ring ? hex('#8a1f1f') : [c[0] * k, c[1] * k, c[2] * k],
            alpha: 1,
            gloss: core ? 0.9 : 0.45,
            emit: core ? [230, 40, 30] : ring ? [120, 10, 10] : undefined,
          };
        },
        0.07,
        5,
      );
    }
    // Спорокаст: мясистое тело-луковица с прожилками и светящимися спорангиями.
    return litSprite(
      S,
      S,
      (u, v) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const rad = 0.3 + 0.06 * Math.sin(a * 5) + 0.03 * Math.sin(a * 11 + 1);
        if (d > rad) return { h: -1, color: [0, 0, 0], alpha: 0 };
        const lobe = Math.cos(a * 5) * 0.5 + 0.5;
        const vein = Math.abs(fbm(u * 7, v * 7, 77, 3) - 0.5) < 0.03;
        // Спорангии — по одному в каждой из пяти долей.
        const la = Math.round((a / (Math.PI * 2)) * 5) * ((Math.PI * 2) / 5);
        const sac = Math.hypot(dx - Math.cos(la) * 0.2, dy - Math.sin(la) * 0.2) < 0.04;
        const body = mix(hex('#2f5d1f'), hex('#7aa83a'), lobe * 0.6 + (1 - d / rad) * 0.4);
        return {
          h: Math.sqrt(Math.max(0, 1 - (d / rad) ** 2)) * 1.6 + lobe * 0.3,
          color: sac ? hex('#e6ff5a') : vein ? hex('#1e3a14') : body,
          alpha: 1,
          gloss: 0.35,
          emit: sac ? [120, 140, 10] : undefined,
        };
      },
      4,
    );
  });
}

// ---------- Контейнеры с грузом ----------

const crates = new SpriteCache<HTMLCanvasElement>(20);

export function crateSprite(color: string): HTMLCanvasElement {
  return crates.get(color, () => {
    const stripe = hex(color);
    return shapeSprite(
      48,
      (g, s) => {
        g.beginPath();
        g.roundRect(s * 0.14, s * 0.2, s * 0.72, s * 0.6, s * 0.08);
        g.fill();
      },
      (u, _v, _edge, base) => {
        const band = Math.abs(u - 0.5) < 0.08;
        const ribs = Math.abs(((u * 6) % 1) - 0.5) > 0.42;
        return { h: base * 1.5 - (ribs ? 0.15 : 0), color: band ? stripe : hex('#5a616a'), alpha: 1, gloss: 0.4 };
      },
      0.12,
      4,
    );
  });
}

