// Спрайты поверхности планет: шаттл и местная жизнь. Голова/нос смотрят вверх (−y):
// при отрисовке спрайт поворачивается по направлению движения.
import type { CreatureType } from '@starforce/shared';
import { fbm, hash2, hex, litSprite, mix, shapeSprite, SpriteCache, type RGB } from './kit';

const cache = new SpriteCache<HTMLCanvasElement>(20);
const S = 128;

function line(g: CanvasRenderingContext2D, pts: [number, number][], width: number): void {
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#fff';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

/** Посадочный шаттл: фюзеляж носом вверх, треугольное крыло, рубка, сопла, опоры. */
export function shuttleSprite(): HTMLCanvasElement {
  return cache.get('shuttle', () =>
    shapeSprite(
      S,
      (g, s) => {
        g.beginPath();
        g.moveTo(s * 0.5, s * 0.06);
        g.quadraticCurveTo(s * 0.64, s * 0.2, s * 0.64, s * 0.45);
        g.lineTo(s * 0.92, s * 0.74);
        g.lineTo(s * 0.9, s * 0.82);
        g.lineTo(s * 0.62, s * 0.78);
        g.lineTo(s * 0.6, s * 0.9);
        g.lineTo(s * 0.4, s * 0.9);
        g.lineTo(s * 0.38, s * 0.78);
        g.lineTo(s * 0.1, s * 0.82);
        g.lineTo(s * 0.08, s * 0.74);
        g.lineTo(s * 0.36, s * 0.45);
        g.quadraticCurveTo(s * 0.36, s * 0.2, s * 0.5, s * 0.06);
        g.fill();
        // Опоры.
        for (const [x, y] of [
          [0.2, 0.9],
          [0.8, 0.9],
          [0.5, 0.97],
        ]) {
          g.beginPath();
          g.arc(s * x, s * y, s * 0.035, 0, Math.PI * 2);
          g.fill();
        }
        line(g, [[s * 0.3, s * 0.75], [s * 0.2, s * 0.9]], s * 0.025);
        line(g, [[s * 0.7, s * 0.75], [s * 0.8, s * 0.9]], s * 0.025);
      },
      (u, v, _e, base) => {
        const spine = Math.max(0, 1 - Math.abs(u - 0.5) / 0.13) * (v < 0.86 ? 1 : 0);
        const glass = Math.abs(u - 0.5) < 0.07 && v > 0.16 && v < 0.33;
        const stripe = Math.abs(v - 0.62) < 0.025 && Math.abs(u - 0.5) < 0.32;
        const nozzle = v > 0.84 && v < 0.9 && Math.abs(u - 0.5) < 0.09 && Math.abs(((u - 0.41) / 0.06) % 1) < 0.7;
        const plate = 0.88 + hash2(Math.floor(u * 9), Math.floor(v * 7), 5) * 0.16;
        let c: RGB = mix(hex('#c9ced4'), hex('#8a929b'), fbm(u * 6, v * 6, 2, 3) * 0.6);
        c = [c[0] * plate, c[1] * plate, c[2] * plate];
        return {
          h: base * 1.2 + spine * 1.4 - (glass ? 0.2 : 0),
          color: glass ? hex('#2a8fb8') : stripe ? hex('#8e2b2b') : nozzle ? hex('#2a2d31') : c,
          alpha: 1,
          gloss: glass ? 1 : 0.4,
          emit: nozzle ? [120, 40, 10] : glass ? [10, 40, 60] : undefined,
        };
      },
      0.05,
      6,
    ),
  );
}

export function creatureSprite(type: CreatureType): HTMLCanvasElement {
  return cache.get(type, () => {
    switch (type) {
      case 'vine': {
        // Хищный цветок: лепестки вокруг зубастой пасти, светящиеся прожилки,
        // шипастые щупальца-плети расходятся спиралью.
        const TEND = 6;
        return shapeSprite(
          S,
          (g, s) => {
            const c = s / 2;
            for (let k = 0; k < TEND; k++) {
              const a0 = (k / TEND) * Math.PI * 2 + 0.3;
              // Плеть сужается к концу: несколько отрезков всё тоньше, с изгибом.
              let px = c;
              let py = c;
              for (let j = 1; j <= 8; j++) {
                const t = j / 8;
                const a = a0 + t * 1.1;
                const r = s * (0.16 + t * 0.32);
                const nx = c + Math.cos(a) * r;
                const ny = c + Math.sin(a) * r;
                line(g, [[px, py], [nx, ny]], s * (0.07 - t * 0.05));
                // Шипы на внешней стороне.
                if (j % 2 === 0 && j < 8) {
                  const ox = Math.cos(a - 0.9) * s * 0.035;
                  const oy = Math.sin(a - 0.9) * s * 0.035;
                  g.beginPath();
                  g.moveTo(nx - oy * 0.3, ny + ox * 0.3);
                  g.lineTo(nx + ox * 1.4, ny + oy * 1.4);
                  g.lineTo(nx + oy * 0.3, ny - ox * 0.3);
                  g.fill();
                }
                px = nx;
                py = ny;
              }
            }
            // Пять лепестков.
            for (let k = 0; k < 5; k++) {
              const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
              g.beginPath();
              g.ellipse(c + Math.cos(a) * s * 0.11, c + Math.sin(a) * s * 0.11, s * 0.14, s * 0.075, a, 0, Math.PI * 2);
              g.fill();
            }
          },
          (u, v, edge, base) => {
            const dx = u - 0.5;
            const dy = v - 0.5;
            const d = Math.hypot(dx, dy);
            const a = Math.atan2(dy, dx);
            if (d < 0.075) {
              // Пасть: тёмная глотка, по краю — кольцо зубов.
              const teeth = d > 0.05 && Math.sin(a * 11) > 0.2;
              return {
                h: teeth ? 0.6 : -0.8 + d * 8,
                color: teeth ? hex('#e9dfc0') : mix(hex('#24060f'), hex('#8a1f3c'), d / 0.075),
                alpha: 1,
                gloss: teeth ? 0.8 : 0.6,
              };
            }
            if (d < 0.26) {
              // Лепесток: мясистый, от багрового у пасти к зелёному на кончике, светящаяся прожилка.
              const pa = ((a + Math.PI / 2) / ((Math.PI * 2) / 5)) % 1;
              const vein = Math.abs(((pa + 1) % 1) - 0.5) < 0.04 && d > 0.09;
              const k = Math.min(1, (d - 0.075) / 0.18);
              return {
                h: base * 1.6 + Math.sin(k * Math.PI) * 0.6,
                color: vein ? hex('#d8f05a') : mix(hex('#7a1d3e'), hex('#3f7a2a'), k),
                alpha: 1,
                gloss: 0.45,
                emit: vein ? [70, 90, 0] : undefined,
              };
            }
            // Плеть: тёмная кора с поперечными кольцами, светлее на свету.
            const ring = Math.sin(d * 140) > 0.75;
            return {
              h: base * 1.4 - (ring ? 0.15 : 0),
              color: mix(hex('#1b3a17'), hex('#4f8030'), Math.min(1, edge * 30)),
              alpha: 1,
              gloss: 0.2,
            };
          },
          0.03,
          5,
        );
      }
      case 'stalker':
        // Шестиногий охотник из коры и мха, светящиеся глаза.
        return shapeSprite(
          S,
          (g, s) => {
            for (const sgn of [-1, 1]) {
              for (const [y, dy] of [
                [0.38, -0.12],
                [0.52, 0.02],
                [0.66, 0.14],
              ]) {
                line(g, [[s * 0.5, s * y], [s * (0.5 + sgn * 0.26), s * (y + dy * 0.6)], [s * (0.5 + sgn * 0.4), s * (y + dy)]], s * 0.04);
              }
            }
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.52, s * 0.13, s * 0.27, 0, 0, Math.PI * 2);
            g.fill();
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.22, s * 0.09, s * 0.1, 0, 0, Math.PI * 2);
            g.fill();
          },
          (u, v, _e, base) => {
            const eye = (Math.hypot(u - 0.465, v - 0.18) < 0.022 || Math.hypot(u - 0.535, v - 0.18) < 0.022);
            const bark = fbm(u * 14, v * 5, 9, 3);
            return {
              h: base * 1.4 + bark * 0.4,
              color: eye ? hex('#ffe14d') : mix(hex('#2b3a1d'), hex('#5d7a35'), bark),
              alpha: 1,
              gloss: eye ? 1 : 0.15,
              emit: eye ? [200, 170, 20] : undefined,
            };
          },
          0.05,
          5,
        );
      case 'sporeling': {
        // Спорник: гроздь дождевиков разного размера на корнях, поры светятся, на макушке — споровые щели.
        const caps: [number, number, number][] = [
          [0.5, 0.46, 0.2],
          [0.33, 0.62, 0.13],
          [0.66, 0.64, 0.14],
          [0.48, 0.73, 0.1],
        ];
        return shapeSprite(
          S,
          (g, s) => {
            for (let k = 0; k < 7; k++) {
              const a = (k / 7) * Math.PI * 2 + 0.4;
              line(g, [[s * 0.5, s * 0.58], [s * (0.5 + Math.cos(a) * 0.3), s * (0.58 + Math.sin(a) * 0.3)], [s * (0.5 + Math.cos(a + 0.3) * 0.42), s * (0.58 + Math.sin(a + 0.3) * 0.42)]], s * 0.022);
            }
            for (const [x, y, r] of caps) {
              g.beginPath();
              g.arc(s * x, s * y, s * r, 0, Math.PI * 2);
              g.fill();
            }
          },
          (u, v, _edge, base) => {
            // Высота — самый высокий из куполов над точкой.
            let h = -1;
            let ci = -1;
            let dd = 1;
            caps.forEach(([x, y, r], k) => {
              const d = Math.hypot(u - x, v - y) / r;
              if (d < 1) {
                const hh = Math.sqrt(1 - d * d) * r * 9;
                if (hh > h) {
                  h = hh;
                  ci = k;
                  dd = d;
                }
              }
            });
            if (ci < 0) {
              // Корни.
              return { h: base * 0.8, color: hex('#3b3a1c'), alpha: 1, gloss: 0.1 };
            }
            const [cx, cy] = caps[ci];
            const pore = hash2(Math.floor(u * 50), Math.floor(v * 50), 31 + ci) > 0.9 && dd < 0.85;
            const slit = dd < 0.3 && Math.abs((u - cx) * 0.7 + (v - cy) * 0.7) < 0.008;
            const skin = fbm(u * 18, v * 18, 33 + ci, 3);
            return {
              h: h + skin * 0.25 - (slit ? 0.5 : 0),
              color: slit ? hex('#e8ff70') : pore ? hex('#c6e83a') : mix(hex('#4a4f17'), hex('#a3a845'), Math.min(1, (1 - dd) * 0.9 + skin * 0.3)),
              alpha: 1,
              gloss: 0.35,
              emit: slit ? [160, 200, 30] : pore ? [70, 90, 10] : undefined,
            };
          },
          0.03,
          5,
        );
      }
      case 'drone_scout':
        // Квадрокоптер Машин: крестовина, четыре винта, красный глаз.
        return shapeSprite(
          S,
          (g, s) => {
            line(g, [[s * 0.2, s * 0.2], [s * 0.8, s * 0.8]], s * 0.07);
            line(g, [[s * 0.8, s * 0.2], [s * 0.2, s * 0.8]], s * 0.07);
            for (const [x, y] of [
              [0.2, 0.2],
              [0.8, 0.2],
              [0.2, 0.8],
              [0.8, 0.8],
            ]) {
              g.beginPath();
              g.arc(s * x, s * y, s * 0.15, 0, Math.PI * 2);
              g.fill();
            }
            g.beginPath();
            g.roundRect(s * 0.36, s * 0.36, s * 0.28, s * 0.28, s * 0.06);
            g.fill();
          },
          (u, v, _e, base) => {
            const rotor = [
              [0.2, 0.2],
              [0.8, 0.2],
              [0.2, 0.8],
              [0.8, 0.8],
            ].some(([x, y]) => Math.hypot(u - x, v - y) < 0.15 && Math.hypot(u - x, v - y) > 0.03);
            const eye = Math.hypot(u - 0.5, v - 0.44) < 0.04;
            return {
              h: base * (rotor ? 0.3 : 1.3),
              color: eye ? hex('#ff2a3a') : rotor ? hex('#7d8792') : hex('#3c434b'),
              alpha: rotor ? 0.55 : 1,
              gloss: 0.6,
              emit: eye ? [220, 20, 30] : undefined,
            };
          },
          0.05,
          5,
        );
      case 'ice_crawler':
        // Сегментированный ледяной ползун с полупрозрачными пластинами.
        return shapeSprite(
          S,
          (g, s) => {
            for (let i = 0; i < 5; i++) {
              const y = s * (0.22 + i * 0.13);
              g.beginPath();
              g.ellipse(s * 0.5, y, s * (0.14 - i * 0.012), s * 0.08, 0, 0, Math.PI * 2);
              g.fill();
              for (const sgn of [-1, 1]) line(g, [[s * 0.5, y], [s * (0.5 + sgn * 0.3), y + s * 0.04]], s * 0.025);
            }
          },
          (_u, v, edge, base) => {
            const seg = Math.abs(((v - 0.155) / 0.13) % 1 - 0.5) > 0.42;
            return {
              h: base * 1.6 - (seg ? 0.3 : 0),
              color: mix(hex('#5f8fae'), hex('#e3f6ff'), Math.min(1, edge * 10)),
              alpha: 0.95,
              gloss: 0.9,
            };
          },
          0.05,
          5,
        );
      case 'magma_beetle':
        // Базальтовый жук с раскалёнными трещинами между пластинами панциря.
        return shapeSprite(
          S,
          (g, s) => {
            for (const sgn of [-1, 1]) for (const y of [0.4, 0.55, 0.7]) line(g, [[s * 0.5, s * y], [s * (0.5 + sgn * 0.36), s * (y + 0.05)]], s * 0.035);
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.56, s * 0.2, s * 0.27, 0, 0, Math.PI * 2);
            g.fill();
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.25, s * 0.1, s * 0.08, 0, 0, Math.PI * 2);
            g.fill();
          },
          (u, v, _e, base) => {
            const crack = Math.abs(u - 0.5) < 0.008 || Math.abs(fbm(u * 8, v * 8, 61, 3) - 0.5) < 0.02;
            const shell = v > 0.3;
            return {
              h: base * 1.6 - (crack && shell ? 0.4 : 0),
              color: crack && shell ? hex('#ff7a1a') : hex('#1f1a18'),
              alpha: 1,
              gloss: crack ? 0.2 : 0.7,
              emit: crack && shell ? [255, 110, 20] : undefined,
            };
          },
          0.05,
          5,
        );
      case 'beast': {
        // Панцирный травоядный: вытянутое тело с роговыми пластинами вдоль хребта,
        // голова с изогнутыми рогами (вверх), четыре лапы, хвост.
        return shapeSprite(
          S,
          (g, s) => {
            // Лапы — согнутые, чуть вперёд/назад.
            for (const [x0, y0, x1, y1] of [
              [0.4, 0.4, 0.24, 0.32],
              [0.6, 0.4, 0.76, 0.32],
              [0.4, 0.68, 0.25, 0.78],
              [0.6, 0.68, 0.75, 0.78],
            ]) {
              line(g, [[s * x0, s * y0], [s * (x0 + x1) / 2, s * ((y0 + y1) / 2 + 0.02)], [s * x1, s * y1]], s * 0.07);
            }
            // Хвост.
            line(g, [[s * 0.5, s * 0.8], [s * 0.53, s * 0.9], [s * 0.48, s * 0.97]], s * 0.045);
            // Тело и голова.
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.55, s * 0.16, s * 0.27, 0, 0, Math.PI * 2);
            g.fill();
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.22, s * 0.085, s * 0.1, 0, 0, Math.PI * 2);
            g.fill();
            // Рога загибаются назад.
            for (const sg of [-1, 1]) {
              g.beginPath();
              g.moveTo(s * (0.5 + sg * 0.04), s * 0.17);
              g.quadraticCurveTo(s * (0.5 + sg * 0.17), s * 0.08, s * (0.5 + sg * 0.15), s * 0.22);
              g.lineTo(s * (0.5 + sg * 0.12), s * 0.18);
              g.quadraticCurveTo(s * (0.5 + sg * 0.12), s * 0.13, s * (0.5 + sg * 0.03), s * 0.2);
              g.fill();
            }
          },
          (u, v, edge, base) => {
            const dx = u - 0.5;
            const horn = v < 0.24 && Math.abs(dx) > 0.075;
            if (horn) {
              const ring = Math.sin(v * 160) > 0.6;
              return { h: base * 1.3 + 0.3, color: ring ? hex('#a99d83') : hex('#ddd3bb'), alpha: 1, gloss: 0.6 };
            }
            const eye = Math.hypot(Math.abs(dx) - 0.05, v - 0.2) < 0.013;
            const fur = fbm(u * 26, v * 9, 13, 3);
            // Пластины панциря: поперечные ряды вдоль хребта, шире в середине тела.
            const inBody = Math.hypot(dx / 0.16, (v - 0.55) / 0.27) < 1;
            const plateW = 0.11 * Math.sqrt(Math.max(0, 1 - ((v - 0.55) / 0.26) ** 2));
            const onPlates = inBody && Math.abs(dx) < plateW;
            if (onPlates) {
              // Ряды изогнуты дугой назад — чешуя-шевроны, а не «лесенка».
              const row = (v - 0.3 - dx * dx * 6) / 0.09;
              const fr = row - Math.floor(row);
              const seam = fr < 0.07;
              const bulge = Math.sin(fr * Math.PI) * 0.5;
              return {
                h: base * 1.5 + 0.7 + bulge - (seam ? 0.4 : 0),
                color: seam ? hex('#3d352c') : mix(hex('#5e554a'), hex('#8d8270'), fur * 0.6 + bulge * 0.6),
                alpha: 1,
                gloss: 0.5,
              };
            }
            return {
              h: base * 1.5 + fur * 0.35,
              color: eye ? hex('#0d0d0d') : mix(hex('#4a3a2e'), hex('#9a8670'), fur * 0.8 + Math.min(1, edge * 10) * 0.2),
              alpha: 1,
              gloss: eye ? 1 : 0.1,
            };
          },
          0.04,
          5,
        );
      }
    }
  });
}

// ---------- Залежи ресурсов на поверхности ----------

const deposits = new SpriteCache<HTMLCanvasElement>(12);

/** Залежь ресурса: то, что команда добывает (не иконка предмета, а сам объект на грунте). */
export function depositSprite(resource: string, seed: number): HTMLCanvasElement {
  const variant = seed % 3;
  return deposits.get(`${resource}:${variant}`, () => {
    const R = (k: number) => hash2(variant, k, 71);
    switch (resource) {
      case 'metal':
        // Рудный выход: каменная глыба с блестящими металлическими прожилками.
        return litSpriteBlob(variant, hex('#4a4440'), (u, v) =>
          Math.abs(fbm(u * 6, v * 6, variant + 3, 3) - 0.5) < 0.018 ? { color: hex('#a9b3bd'), gloss: 1, h: 0.15 } : null,
        );
      case 'ice':
        // Ледяные торосы: несколько граней-осколков, полупрозрачные, с бликом.
        return shapeSprite(
          S,
          (g, s) => {
            for (let i = 0; i < 6; i++) {
              const a = R(i) * Math.PI * 2;
              const r = s * (0.08 + R(i + 10) * 0.18);
              const cx = s / 2 + Math.cos(a) * r;
              const cy = s / 2 + Math.sin(a) * r;
              const w = s * (0.08 + R(i + 20) * 0.08);
              const h = s * (0.18 + R(i + 30) * 0.16);
              g.save();
              g.translate(cx, cy);
              g.rotate(a);
              g.beginPath();
              g.moveTo(-w, 0);
              g.lineTo(0, -h);
              g.lineTo(w, 0);
              g.lineTo(0, h * 0.4);
              g.closePath();
              g.fill();
              g.restore();
            }
          },
          (_u, _v, edge, base) => ({ h: base * 1.8 + edge * 6, color: mix(hex('#7fb3cf'), hex('#f0fbff'), Math.min(1, edge * 14)), alpha: 0.92, gloss: 1 }),
          0.05,
          6,
        );
      case 'crystals':
        // Друза: толстые гранёные кристаллы веером из каменного основания, светятся изнутри.
        return shapeSprite(
          S,
          (g, s) => {
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.62, s * 0.22, s * 0.14, 0, 0, Math.PI * 2);
            g.fill();
            for (let i = 0; i < 6; i++) {
              const a = -Math.PI / 2 + (i - 2.5) * 0.38 + (R(i) - 0.5) * 0.2;
              const len = s * (0.24 + R(i + 5) * 0.16);
              const wid = s * (0.055 + R(i + 9) * 0.03);
              g.save();
              g.translate(s * (0.5 + (i - 2.5) * 0.04), s * 0.62);
              g.rotate(a + Math.PI / 2);
              g.beginPath();
              g.moveTo(-wid, 0);
              g.lineTo(-wid, -len * 0.75);
              g.lineTo(0, -len);
              g.lineTo(wid, -len * 0.75);
              g.lineTo(wid, 0);
              g.closePath();
              g.fill();
              g.restore();
            }
          },
          (u, v, edge, base) => {
            const rock = v > 0.58 && Math.hypot((u - 0.5) / 0.22, (v - 0.62) / 0.14) < 1;
            if (rock) return { h: base * 1.2, color: mix(hex('#3a3436'), hex('#5a5254'), fbm(u * 9, v * 9, 4, 3)), alpha: 1, gloss: 0.1 };
            const inner = Math.min(1, edge * 18);
            return { h: base * 1.6 + edge * 8, color: mix(hex('#4b2275'), hex('#e6b3ff'), inner), alpha: 1, gloss: 1, emit: [Math.round(60 * inner), 8, Math.round(100 * inner)] };
          },
          0.03,
          6,
        );
      case 'food':
        // Плодовый куст: крона листьев и оранжевые плоды.
        return litSpriteBlob(variant + 5, hex('#2f5a22'), (u, v) => {
          const fruit = hash2(Math.floor(u * 9), Math.floor(v * 9), variant + 9) > 0.86 && Math.hypot(((u * 9) % 1) - 0.5, ((v * 9) % 1) - 0.5) < 0.3;
          if (fruit) return { color: hex('#ff9a2e'), gloss: 0.7, h: 0.4 };
          return { color: mix(hex('#24481b'), hex('#5f9a35'), fbm(u * 10, v * 10, variant, 3)), gloss: 0.15, h: fbm(u * 12, v * 12, variant + 1, 3) * 0.6 };
        });
      case 'biomass':
        // Живая древесина: узел, из которого во все стороны расходятся изогнутые корни.
        return shapeSprite(
          S,
          (g, s) => {
            for (let i = 0; i < 7; i++) {
              const a = (i / 7) * Math.PI * 2 + R(i) * 0.5;
              const bend = (R(i + 3) - 0.5) * 1.2;
              const len = s * (0.3 + R(i + 6) * 0.12);
              g.lineWidth = s * (0.05 + R(i + 9) * 0.03);
              g.lineCap = 'round';
              g.strokeStyle = '#fff';
              g.beginPath();
              g.moveTo(s / 2, s / 2);
              g.quadraticCurveTo(s / 2 + Math.cos(a + bend) * len * 0.6, s / 2 + Math.sin(a + bend) * len * 0.6, s / 2 + Math.cos(a) * len, s / 2 + Math.sin(a) * len);
              g.stroke();
            }
            g.beginPath();
            g.arc(s / 2, s / 2, s * 0.12, 0, Math.PI * 2);
            g.fill();
          },
          (u, v, edge, base) => {
            const glow = hash2(Math.floor(u * 24), Math.floor(v * 24), 4) > 0.965;
            const bark = fbm(u * 14, v * 14, 5, 3);
            return { h: base * 1.4 + edge * 5 + bark * 0.3, color: glow ? hex('#b8ff5a') : mix(hex('#3a2c1c'), hex('#6a8a36'), bark), alpha: 1, gloss: 0.25, emit: glow ? [70, 120, 10] : undefined };
          },
          0.04,
          5,
        );
      case 'water':
        // Родник: чаша воды в каменном кольце.
        return litSprite(S, S, (u, v) => {
          const d = Math.hypot(u - 0.5, v - 0.5);
          const rim = 0.3 + 0.03 * Math.sin(Math.atan2(v - 0.5, u - 0.5) * 7 + variant);
          if (d > rim + 0.08) return { h: -1, color: [0, 0, 0], alpha: 0 };
          if (d > rim) return { h: (rim + 0.08 - d) * 12, color: mix(hex('#4d4a45'), hex('#7a756c'), fbm(u * 9, v * 9, 2, 3)), alpha: 1, gloss: 0.1 };
          const ripple = Math.sin(d * 70) * 0.05;
          return { h: -0.3 + ripple, color: mix(hex('#0f3a5c'), hex('#3fa1d8'), d / rim), alpha: 1, gloss: 1 };
        }, 4);
      default:
        // Тайник Машин: металлический контейнер с жёлтыми полосами и огоньком.
        return shapeSprite(
          S,
          (g, s) => {
            g.beginPath();
            g.roundRect(s * 0.2, s * 0.26, s * 0.6, s * 0.48, s * 0.06);
            g.fill();
          },
          (u, v, _e, base) => {
            const stripe = Math.abs(((u + v) * 8) % 1) < 0.5 && (v < 0.33 || v > 0.67);
            const lamp = Math.hypot(u - 0.72, v - 0.5) < 0.035;
            return { h: base * 1.6, color: lamp ? hex('#ff3b30') : stripe ? hex('#f2b400') : hex('#4b525a'), alpha: 1, gloss: 0.5, emit: lamp ? [200, 30, 20] : undefined };
          },
          0.08,
          5,
        );
    }
  });
}

/** Округлая «куча» (глыба, крона) с цветом по умолчанию и точечными деталями поверх. */
function litSpriteBlob(seed: number, color: RGB, detail: (u: number, v: number) => { color: RGB; gloss: number; h?: number } | null): HTMLCanvasElement {
  return litSprite(
    S,
    S,
    (u, v) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const rad = 0.3 + 0.07 * (fbm(Math.cos(a) * 1.5 + seed, Math.sin(a) * 1.5, seed, 3) - 0.5) * 2;
      if (d > rad) return { h: -1, color: [0, 0, 0], alpha: 0 };
      const dome = Math.sqrt(Math.max(0, 1 - (d / rad) ** 2)) * 1.5 + fbm(u * 7, v * 7, seed + 1, 4) * 0.5;
      const det = detail(u, v);
      const c = det?.color ?? [color[0] * (0.8 + fbm(u * 9, v * 9, seed, 3) * 0.4), color[1] * (0.8 + fbm(u * 9, v * 9, seed, 3) * 0.4), color[2] * (0.8 + fbm(u * 9, v * 9, seed, 3) * 0.4)];
      return { h: dome + (det?.h ?? 0), color: c as RGB, alpha: 1, gloss: det?.gloss ?? 0.1 };
    },
    5,
  );
}
