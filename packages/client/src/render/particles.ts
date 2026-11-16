// Частицы боя: искры, обломки, дым, ударные волны. Только визуал клиента — на игру не влияет.
// Частицы живут в мировых координатах, поэтому корректно летят при движении камеры и масштабе.

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
  kind: 'spark' | 'smoke' | 'debris' | 'flash' | 'ring';
  drag: number;
  spin: number;
  angle: number;
}

const particles: Particle[] = [];
const MAX = 1500;
let last = performance.now();

function add(p: Omit<Particle, 'max' | 'angle'> & { angle?: number }): void {
  if (particles.length >= MAX) particles.shift();
  particles.push({ ...p, max: p.life, angle: p.angle ?? Math.random() * Math.PI * 2 });
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Взрыв радиуса r (мировые единицы): вспышка, ударная волна, искры, обломки, дым. */
export function explosion(x: number, y: number, r: number): void {
  add({ x, y, vx: 0, vy: 0, life: 0.25, size: r * 1.6, grow: 0, color: [255, 240, 200], kind: 'flash', drag: 0, spin: 0 });
  add({ x, y, vx: 0, vy: 0, life: 0.6, size: r * 0.3, grow: r * 4, color: [255, 180, 110], kind: 'ring', drag: 0, spin: 0 });
  const n = Math.min(60, 12 + r * 1.5);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(r * 1.5, r * 6);
    add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.3, 0.9), size: rnd(0.8, 2.2), grow: 0, color: [255, rnd(150, 230), 80], kind: 'spark', drag: 1.8, spin: 0 });
  }
  for (let i = 0; i < n * 0.35; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(r * 0.5, r * 2.5);
    add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.2, 2.6), size: rnd(1.2, 3.2), grow: 0, color: [110, 105, 100], kind: 'debris', drag: 0.4, spin: rnd(-6, 6) });
  }
  for (let i = 0; i < n * 0.4; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(r * 0.2, r * 1.2);
    add({ x: x + rnd(-r, r) * 0.3, y: y + rnd(-r, r) * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.2, 2.4), size: r * rnd(0.3, 0.6), grow: r * 0.8, color: [70, 64, 60], kind: 'smoke', drag: 1.2, spin: 0 });
  }
}

/** Попадание: в щит — голубая рябь, в корпус — искры и клочок дыма. */
export function impact(x: number, y: number, shield: boolean): void {
  if (shield) {
    add({ x, y, vx: 0, vy: 0, life: 0.35, size: 2, grow: 40, color: [120, 220, 255], kind: 'ring', drag: 0, spin: 0 });
    return;
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(30, 120);
    add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.15, 0.45), size: rnd(0.6, 1.4), grow: 0, color: [255, 200, 120], kind: 'spark', drag: 3, spin: 0 });
  }
  add({ x, y, vx: rnd(-8, 8), vy: rnd(-8, 8), life: 0.9, size: 3, grow: 10, color: [80, 76, 72], kind: 'smoke', drag: 1, spin: 0 });
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
  for (const pass of ['smoke', 'light'] as const) {
    ctx.globalCompositeOperation = pass === 'light' ? 'lighter' : 'source-over';
    for (const p of particles) {
      const isLight = p.kind === 'spark' || p.kind === 'flash' || p.kind === 'ring';
      if ((pass === 'light') !== isLight) continue;
      const s = toScreen(p.x, p.y);
      const t = p.life / p.max;
      const size = Math.max(0.6, p.size * zoom);
      const [r, g, b] = p.color;
      switch (p.kind) {
        case 'flash': {
          const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, size);
          gr.addColorStop(0, `rgba(${r},${g},${b},${t})`);
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'ring':
          ctx.strokeStyle = `rgba(${r},${g},${b},${t * 0.8})`;
          ctx.lineWidth = Math.max(1, size * 0.12 * t + 1);
          ctx.beginPath();
          ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'spark': {
          // Искра — короткий штрих по направлению полёта.
          ctx.strokeStyle = `rgba(${r},${g},${b},${t})`;
          ctx.lineWidth = Math.max(1, size);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - p.vx * 0.03 * zoom, s.y - p.vy * 0.03 * zoom);
          ctx.stroke();
          break;
        }
        case 'debris':
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, t * 1.5)})`;
          ctx.fillRect(-size / 2, -size / 3, size, size * 0.66);
          ctx.restore();
          break;
        case 'smoke':
          ctx.fillStyle = `rgba(${r},${g},${b},${t * t * 0.22})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
    }
  }
  ctx.restore();
}
