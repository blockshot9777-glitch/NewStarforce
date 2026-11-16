// Спрайты поверхности планет: шаттл и местная жизнь. Голова/нос смотрят вверх (−y):
// при отрисовке спрайт поворачивается по направлению движения.
import type { CreatureType } from '@starforce/shared';
import { fbm, hash2, hex, mix, shapeSprite, SpriteCache, type RGB } from './kit';

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
      case 'vine':
        // Колючий стебель, свёрнутый вокруг пасти-ловушки.
        return shapeSprite(
          S,
          (g, s) => {
            const pts: [number, number][] = [];
            for (let a = 0; a < Math.PI * 5; a += 0.08) {
              const r = s * (0.08 + a * 0.024);
              pts.push([s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r]);
            }
            line(g, pts, s * 0.08);
            g.beginPath();
            g.arc(s / 2, s / 2, s * 0.13, 0, Math.PI * 2);
            g.fill();
          },
          (u, v, edge, base) => {
            const d = Math.hypot(u - 0.5, v - 0.5);
            const mouth = d < 0.13;
            const teeth = mouth && d > 0.09 && Math.sin(Math.atan2(v - 0.5, u - 0.5) * 12) > 0.4;
            const spot = !mouth && hash2(Math.floor(u * 40), Math.floor(v * 40), 7) > 0.93;
            return {
              h: base * 1.5 + (mouth ? -0.6 + d * 4 : 0),
              color: teeth ? hex('#efe6c8') : mouth ? mix(hex('#5a1546'), hex('#b0306f'), d / 0.13) : spot ? hex('#d8e84a') : mix(hex('#1f4a1d'), hex('#4f8a2e'), edge * 12),
              alpha: 1,
              gloss: mouth ? 0.7 : 0.2,
              emit: spot ? [80, 90, 0] : undefined,
            };
          },
          0.04,
          5,
        );
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
      case 'sporeling':
        // Гриб-спорник: шляпка в пятнах, по краю — отростки.
        return shapeSprite(
          S,
          (g, s) => {
            g.beginPath();
            for (let i = 0; i <= 40; i++) {
              const a = (i / 40) * Math.PI * 2;
              const r = s * (0.3 + 0.04 * Math.sin(a * 9));
              g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
            }
            g.fill();
          },
          (u, v, edge, base) => {
            const d = Math.hypot(u - 0.5, v - 0.5);
            const spot = fbm(u * 9, v * 9, 31, 2) > 0.62;
            return {
              h: base + Math.sqrt(Math.max(0, 1 - (d / 0.32) ** 2)) * 1.6,
              color: spot ? hex('#f1f7a8') : mix(hex('#6d7a16'), hex('#b8c936'), Math.min(1, edge * 8)),
              alpha: 1,
              gloss: 0.3,
              emit: spot ? [50, 60, 0] : undefined,
            };
          },
          0.05,
          4,
        );
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
      case 'beast':
        // Четвероногий травоядный зверь с рожками.
        return shapeSprite(
          S,
          (g, s) => {
            for (const [x, y] of [
              [0.32, 0.38],
              [0.68, 0.38],
              [0.32, 0.72],
              [0.68, 0.72],
            ]) {
              g.beginPath();
              g.ellipse(s * x, s * y, s * 0.06, s * 0.08, 0, 0, Math.PI * 2);
              g.fill();
            }
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.56, s * 0.17, s * 0.25, 0, 0, Math.PI * 2);
            g.fill();
            g.beginPath();
            g.ellipse(s * 0.5, s * 0.24, s * 0.09, s * 0.11, 0, 0, Math.PI * 2);
            g.fill();
            line(g, [[s * 0.45, s * 0.17], [s * 0.38, s * 0.08]], s * 0.025);
            line(g, [[s * 0.55, s * 0.17], [s * 0.62, s * 0.08]], s * 0.025);
          },
          (u, v, _e, base) => {
            const fur = fbm(u * 20, v * 6, 13, 3);
            const horn = v < 0.16;
            const eye = Math.hypot(u - 0.46, v - 0.22) < 0.014 || Math.hypot(u - 0.54, v - 0.22) < 0.014;
            return {
              h: base * 1.5 + fur * 0.3,
              color: eye ? hex('#1a1a1a') : horn ? hex('#d9cfb8') : mix(hex('#5b4a3c'), hex('#a08d76'), fur),
              alpha: 1,
              gloss: horn ? 0.6 : 0.1,
            };
          },
          0.05,
          5,
        );
    }
  });
}
