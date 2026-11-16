// Свет звезды на объектах в космосе: сторона к звезде подсвечена её цветом, дальняя — в тени.
// Спрайты нарисованы с общим светом «сверху-слева»; поверх него эта функция добавляет настоящее
// направление на звезду системы — корабль, облетающий звезду, поворачивается к ней то одним, то другим бортом.

let starRgb: [number, number, number] = [255, 244, 220];

/** Цвет звезды текущей системы (вызывается раз за кадр из render/space.ts). */
export function setStarColor(hex: string): void {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (Number.isFinite(n)) starRgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Угол на звезду (она в начале координат системы) из точки мира. */
export function toSunAngle(wx: number, wy: number): number {
  return Math.atan2(-wy, -wx);
}

/** Сколько ступеней угла: 32 → ~11°. Затенённая копия пересчитывается только при смене ступени. */
const STEPS = 32;
const shaded = new WeakMap<object, { step: number; rgb: string; canvas: HTMLCanvasElement }>();

function shade(img: HTMLCanvasElement | OffscreenCanvas | ImageBitmap, step: number, strength: number): HTMLCanvasElement {
  const key = img as object;
  const rgb = starRgb.join(',');
  const have = shaded.get(key);
  if (have && have.step === step && have.rgb === rgb) return have.canvas;
  const w = img.width;
  const h = img.height;
  const c = have?.canvas ?? document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  g.drawImage(img, 0, 0);
  const a = (step / STEPS) * Math.PI * 2;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.hypot(w, h) / 2;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Градиент вдоль направления на звезду: свет → нейтрально → тень.
  const gr = g.createLinearGradient(cx + ux * R, cy + uy * R, cx - ux * R, cy - uy * R);
  gr.addColorStop(0, `rgba(${rgb},${0.3 * strength})`);
  gr.addColorStop(0.42, `rgba(${rgb},0)`);
  gr.addColorStop(0.55, 'rgba(0,0,12,0)');
  gr.addColorStop(1, `rgba(0,2,14,${0.55 * strength})`);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  shaded.set(key, { step, rgb, canvas: c });
  return c;
}

/**
 * Нарисовать спрайт со светом звезды. localAngle — направление на звезду в системе координат,
 * в которой сейчас рисуем (то есть уже за вычетом поворота ctx). Затенённая копия спрайта кэшируется
 * в его собственном разрешении и пересчитывается только при заметной смене угла.
 */
export function drawSunlit(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement | OffscreenCanvas | ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  localAngle: number,
  strength = 1,
): void {
  const m = ctx.getTransform();
  // Совсем мелкие объекты — без затенения (не видно, а память на копию нужна).
  if (dw * Math.hypot(m.a, m.b) < 12 || strength <= 0) {
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }
  const step = ((Math.round((localAngle / (Math.PI * 2)) * STEPS) % STEPS) + STEPS) % STEPS;
  ctx.drawImage(shade(img, step, strength), dx, dy, dw, dh);
}
