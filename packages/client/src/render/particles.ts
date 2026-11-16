// Частицы боя: огненный шар, искры, раскалённые обломки, дым, ударная волна. Только визуал клиента —
// на игру не влияет. Частицы живут в мировых координатах, поэтому корректно летят при движении камеры.
// Мягкие клубы рисуются заранее заготовленными спрайтами-градиентами (дёшево даже при сотнях частиц).

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  /** Размер в мировых единицах. */
  size: number;
  grow: number;
  color: [number, number, number];
  kind: 'spark' | 'smoke' | 'debris' | 'flash' | 'ring' | 'fire';
  drag: number;
  spin: number;
  angle: number;
  /** Задержка появления, с — клубы огня и дыма вырастают не все сразу. */
  delay: number;
}

const particles: Particle[] = [];
const MAX = 1500;
let last = performance.now();

function add(p: Omit<Particle, 'max' | 'angle' | 'delay'> & { angle?: number; delay?: number }): void {
  if (particles.length >= MAX) particles.shift();
  particles.push({ ...p, max: p.life, angle: p.angle ?? Math.random() * Math.PI * 2, delay: p.delay ?? 0 });
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- Спрайты мягких клубов ----------

const blobs = new Map<string, HTMLCanvasElement>();
/** Круглый клуб с мягким краем заданного цвета (кэш по цвету, квантованному до 16 ступеней). */
function blob(r: number, g: number, b: number, soft: number): HTMLCanvasElement {
  const q = (v: number) => Math.round(v / 16) * 16;
  const key = `${q(r)},${q(g)},${q(b)},${soft}`;
  let c = blobs.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${q(r)},${q(g)},${q(b)},1)`);
    gr.addColorStop(soft, `rgba(${q(r)},${q(g)},${q(b)},0.55)`);
    gr.addColorStop(1, `rgba(${q(r)},${q(g)},${q(b)},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    blobs.set(key, c);
  }
  return c;
}

/** Цвет остывающего огня по доле прожитой жизни: бело-жёлтый → оранжевый → тёмно-красный. */
function fireColor(age: number): [number, number, number] {
  if (age < 0.15) return [255, 245, 210];
  if (age < 0.4) {
    const k = (age - 0.15) / 0.25;
    return [255, 245 - 105 * k, 210 - 170 * k];
  }
  const k = Math.min(1, (age - 0.4) / 0.6);
  return [255 - 135 * k, 140 - 100 * k, 40 - 20 * k];
}

// ---------- Эффекты ----------

/** Взрыв радиуса r (мировые единицы): вспышка, огненный шар, ударная волна, искры, обломки, дым. */
export function explosion(x: number, y: number, r: number): void {
  add({ x, y, vx: 0, vy: 0, life: 0.14, size: r * 2.2, grow: r * 4, color: [255, 240, 210], kind: 'flash', drag: 0, spin: 0 });
  add({ x, y, vx: 0, vy: 0, life: 0.45, size: r * 0.5, grow: r * 7, color: [255, 200, 150], kind: 'ring', drag: 0, spin: 0 });
  // Огненный шар — клубы, разлетающиеся от центра и остывающие.
  const fires = Math.min(18, 6 + Math.round(r * 0.5));
  for (let i = 0; i < fires; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(r * 0.8, r * 2.6);
    add({ x: x + Math.cos(a) * r * 0.2, y: y + Math.sin(a) * r * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.4, 0.85), size: r * rnd(0.2, 0.42), grow: r * 0.7, color: [255, 220, 150], kind: 'fire', drag: 2.4, spin: 0, delay: rnd(0, 0.08) });
  }
  // Искры — длинные тонкие штрихи.
  const n = Math.min(50, 10 + r * 1.2);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(r * 2, r * 7);
    add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.25, 0.7), size: rnd(0.4, 0.9), grow: 0, color: [255, rnd(170, 230), 110], kind: 'spark', drag: 2.2, spin: 0 });
  }
  // Обломки обшивки: тёмные, кувыркаются, раскалённый край остывает.
  for (let i = 0; i < Math.min(14, 3 + r * 0.3); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(r * 0.6, r * 2.8);
    add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.4, 2.8), size: rnd(1.8, 3.6), grow: 0, color: [84, 82, 80], kind: 'debris', drag: 0.35, spin: rnd(-7, 7) });
  }
  // Дым — появляется чуть позже огня и расползается.
  for (let i = 0; i < Math.min(16, 5 + r * 0.45); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(r * 0.15, r * 0.9);
    add({ x: x + rnd(-r, r) * 0.3, y: y + rnd(-r, r) * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.4, 2.6), size: r * rnd(0.4, 0.7), grow: r * 0.7, color: [52, 48, 46], kind: 'smoke', drag: 1.1, spin: 0, delay: rnd(0.12, 0.3) });
  }
}

/** Попадание: в щит — голубая рябь, в корпус — искры, вспышка и клочок дыма. */
export function impact(x: number, y: number, shield: boolean): void {
  if (shield) {
    add({ x, y, vx: 0, vy: 0, life: 0.35, size: 2, grow: 40, color: [120, 220, 255], kind: 'ring', drag: 0, spin: 0 });
    add({ x, y, vx: 0, vy: 0, life: 0.18, size: 6, grow: 10, color: [140, 220, 255], kind: 'flash', drag: 0, spin: 0 });
    return;
  }
  add({ x, y, vx: 0, vy: 0, life: 0.1, size: 5, grow: 8, color: [255, 230, 180], kind: 'flash', drag: 0, spin: 0 });
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(40, 140);
    add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.15, 0.45), size: rnd(0.4, 0.8), grow: 0, color: [255, 200, 120], kind: 'spark', drag: 3, spin: 0 });
  }
  add({ x, y, vx: rnd(-8, 8), vy: rnd(-8, 8), life: 1.0, size: 3, grow: 9, color: [70, 66, 62], kind: 'smoke', drag: 1, spin: 0 });
}

/** Дымный след ракеты (вызывать каждый кадр для каждой ракеты). */
export function trail(x: number, y: number, vx: number, vy: number, color: [number, number, number]): void {
  // Несколько клубов вдоль пройденного за кадр отрезка — след сплошной, а не «бусами».
  for (let i = 0; i < 3; i++) {
    const k = i / 3;
    add({ x: x - vx * 0.016 * k + rnd(-1, 1), y: y - vy * 0.016 * k + rnd(-1, 1), vx: -vx * 0.04 + rnd(-3, 3), vy: -vy * 0.04 + rnd(-3, 3), life: rnd(0.6, 1.0), size: 1.4, grow: 7, color, kind: 'smoke', drag: 1.5, spin: 0 });
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => { x: number; y: number }, zoom: number): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.delay > 0) {
      p.delay -= dt;
      continue;
    }
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    const k = Math.max(0, 1 - p.drag * dt);
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.size += p.grow * dt;
    p.angle += p.spin * dt;
  }
  ctx.save();
  // Сначала дым и обломки (поглощают свет), затем огонь и искры поверх — сложением.
  for (const pass of ['dark', 'light'] as const) {
    ctx.globalCompositeOperation = pass === 'light' ? 'lighter' : 'source-over';
    for (const p of particles) {
      if (p.delay > 0) continue;
      const isLight = p.kind === 'spark' || p.kind === 'flash' || p.kind === 'ring' || p.kind === 'fire';
      if ((pass === 'light') !== isLight) continue;
      const s = toScreen(p.x, p.y);
      const t = p.life / p.max;
      const age = 1 - t;
      const size = Math.max(0.6, p.size * zoom);
      const [r, g, b] = p.color;
      switch (p.kind) {
        case 'flash':
          ctx.globalAlpha = t;
          ctx.drawImage(blob(r, g, b, 0.25), s.x - size, s.y - size, size * 2, size * 2);
          break;
        case 'fire': {
          const [fr, fg, fb] = fireColor(age);
          ctx.globalAlpha = Math.min(1, t * 1.6) * 0.6;
          ctx.drawImage(blob(fr, fg, fb, 0.45), s.x - size, s.y - size, size * 2, size * 2);
          break;
        }
        case 'ring':
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `rgba(${r},${g},${b},${t * t * 0.55})`;
          ctx.lineWidth = Math.max(1, size * 0.05 * t + 0.8);
          ctx.beginPath();
          ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'spark': {
          // Искра — тонкий штрих по направлению полёта, длина от скорости.
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `rgba(${r},${g},${b},${t})`;
          ctx.lineWidth = Math.max(0.8, size * zoom * 0.8);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - p.vx * 0.05 * zoom, s.y - p.vy * 0.05 * zoom);
          ctx.stroke();
          break;
        }
        case 'debris': {
          ctx.globalAlpha = Math.min(1, t * 1.5);
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.beginPath();
          ctx.moveTo(-size * 0.5, -size * 0.3);
          ctx.lineTo(size * 0.5, -size * 0.15);
          ctx.lineTo(size * 0.3, size * 0.35);
          ctx.lineTo(-size * 0.4, size * 0.25);
          ctx.closePath();
          ctx.fill();
          // Раскалённая кромка остывает за первую секунду.
          const hot = Math.max(0, 1 - (p.max - p.life) / 1.0);
          if (hot > 0) {
            ctx.fillStyle = `rgba(255,${140 + 80 * hot},60,${hot})`;
            ctx.fillRect(-size * 0.5, -size * 0.3, size * 0.35, size * 0.3);
          }
          ctx.restore();
          break;
        }
        case 'smoke':
          // Клуб плавно проявляется и тает.
          ctx.globalAlpha = Math.min(1, age * 5) * t * 0.5;
          ctx.drawImage(blob(r, g, b, 0.5), s.x - size, s.y - size, size * 2, size * 2);
          break;
      }
    }
  }
  ctx.restore();
}
