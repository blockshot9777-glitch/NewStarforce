// Космос: многослойный фон с параллаксом, звезда, планеты, станции, астероиды, корабли, враги, эффекты.
import {
  BIOMES,
  NPCS,
  SAFE_ZONE_RADIUS,
  STAR_SYSTEMS,
  TILE_WORLD,
  RESOURCE_NAMES,
  type Contact,
  type OwnShipView,
  type Resource,
} from '@starforce/shared';
import { interp, store, worldToScreen } from '../store';
import { NEBULA_SIZE, nebulaBlobs, nebulaPixels, tileOffset, wrappedCenters } from './nebula';
import { drawHull, drawInterior, moduleWorld } from './ship';
import { drawParticles, explosion, impact, trail } from './particles';
import { drawSunlit, setStarColor, toSunAngle } from './sunlight';
import { asteroidSprite, crateSprite, drawPlanetBody, drawStar, npcSprite, stationSprite } from './gen/space';

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  c: string;
}

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const LAYERS: { factor: number; stars: Star[]; size: number }[] = [0.05, 0.15, 0.35].map((factor, li) => {
  const rnd = seeded(li * 999 + 7);
  const size = 2048;
  const count = [500, 250, 120][li];
  const colors = ['#ffffff', '#cfe8ff', '#ffe6c7', '#ffd1d1'];
  return {
    factor,
    size,
    stars: Array.from({ length: count }, () => ({
      x: rnd() * size,
      y: rnd() * size,
      r: (0.4 + rnd() * (li + 1) * 0.6) * (li === 2 ? 1.3 : 1),
      a: 0.25 + rnd() * 0.75,
      c: colors[Math.floor(rnd() * colors.length)],
    })),
  };
});

const starDots = new Map<string, HTMLCanvasElement>();
/** Звезда фона: яркое ядро и мягкий ореол; самые крупные — с тонкими лучами дифракции. */
function starDot(color: string): HTMLCanvasElement {
  let c = starDots.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.12, color);
  gr.addColorStop(0.3, `${color}55`);
  gr.addColorStop(1, `${color}00`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = `${color}66`;
  g.fillRect(15.5, 2, 1, 28);
  g.fillRect(2, 15.5, 28, 1);
  starDots.set(color, c);
  return c;
}

let nebula: HTMLCanvasElement | null = null;
let nebulaWorker: Worker | null | undefined;

/** Наложить пиксели рисованного слоя на тайл: считаются в половинном разрешении и растягиваются.
 * Копии вокруг тайла нужны, чтобы сглаживание у краёв брало соседей «с той стороны» — без шва. */
function applyNebulaLayer(target: HTMLCanvasElement, px: Uint8ClampedArray, res: number): void {
  const half = document.createElement('canvas');
  half.width = half.height = res;
  const hg = half.getContext('2d')!;
  const id = hg.createImageData(res, res);
  id.data.set(px);
  hg.putImageData(id, 0, 0);
  const g = target.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) g.drawImage(half, dx * NEBULA_SIZE, dy * NEBULA_SIZE, NEBULA_SIZE, NEBULA_SIZE);
}

function requestNebulaLayer(systemId: number, star: string, target: HTMLCanvasElement): void {
  const res = NEBULA_SIZE / 2;
  if (nebulaWorker === undefined) {
    try {
      nebulaWorker = new Worker(new URL('./nebulaWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      nebulaWorker = null;
    }
  }
  if (!nebulaWorker) {
    applyNebulaLayer(target, nebulaPixels(systemId, star, res), res);
    return;
  }
  const w = nebulaWorker;
  const onMsg = (e: MessageEvent<{ systemId: number; res: number; px: Uint8ClampedArray }>) => {
    if (e.data.systemId !== systemId) return;
    w.removeEventListener('message', onMsg);
    // Пока считали, игрок мог улететь в другую систему — тогда этот тайл уже не нужен.
    if (nebula === target) applyNebulaLayer(target, e.data.px, e.data.res);
  };
  w.addEventListener('message', onMsg);
  w.postMessage({ systemId, star, res });
}
let nebulaSystem = -1;

function makeNebula(systemId: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = NEBULA_SIZE;
  const g = c.getContext('2d')!;
  const base = STAR_SYSTEMS[systemId]?.star ?? '#ffffff';
  for (const blob of nebulaBlobs(systemId, base)) {
    for (const p of wrappedCenters(blob.x, blob.y, blob.r, NEBULA_SIZE)) {
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, blob.r);
      grad.addColorStop(0, `${blob.color}22`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, NEBULA_SIZE, NEBULA_SIZE);
    }
  }
  // Рисованный слой (клубы, нити, пыль) — в фоновом потоке; пока считается, видны только пятна.
  requestNebulaLayer(systemId, base, c);
  return c;
}

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, systemId: number): void {
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, W, H);
  if (!nebula || nebulaSystem !== systemId) {
    nebula = makeNebula(systemId);
    nebulaSystem = systemId;
  }
  // Дробный сдвиг и сглаживание смешивают край тайла с пустотой и оставляют линию.
  // Туманность кладётся целыми пикселями, без фильтрации.
  const nx = Math.round(tileOffset(store.cam.x, 0.02, NEBULA_SIZE));
  const ny = Math.round(tileOffset(store.cam.y, 0.02, NEBULA_SIZE));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let x = nx - NEBULA_SIZE; x < W; x += NEBULA_SIZE) {
    for (let y = ny - NEBULA_SIZE; y < H; y += NEBULA_SIZE) ctx.drawImage(nebula, x, y);
  }
  ctx.restore();
  for (const layer of LAYERS) {
    const ox = -((((store.cam.x * layer.factor) % layer.size) + layer.size) % layer.size);
    const oy = -((((store.cam.y * layer.factor) % layer.size) + layer.size) % layer.size);
    for (const s of layer.stars) {
      for (let x = s.x + ox; x < W; x += layer.size) {
        if (x < -2) continue;
        for (let y = s.y + oy; y < H; y += layer.size) {
          if (y < -2) continue;
          ctx.globalAlpha = s.a;
          if (s.r > 1.1) ctx.drawImage(starDot(s.c), x - s.r * 2, y - s.r * 2, s.r * 4, s.r * 4);
          else {
            ctx.fillStyle = s.c;
            ctx.fillRect(x, y, s.r, s.r);
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

const RES_COLORS: Partial<Record<Resource, string>> = {
  metal: '#b0bec5',
  ice: '#b3e5fc',
  crystals: '#ea80fc',
  water: '#4fc3f7',
  biomass: '#9ccc65',
  food: '#ffcc80',
  credits: '#ffd740',
};

const headings = new Map<number, number>();

function headingFor(id: number, vx: number, vy: number): number {
  const prev = headings.get(id) ?? 0;
  if (Math.hypot(vx, vy) < 4) return prev;
  const h = Math.atan2(vy, vx);
  headings.set(id, h);
  return h;
}

export interface SpaceRenderResult {
  /** Экранные координаты клетки (0,0) своего корабля и размер клетки — для ввода мышью. */
  interior: { ox: number; oy: number; ts: number } | null;
}

/** Фон экрана входа: туманность и звёзды медленно дрейфуют (до подключения снимка мира ещё нет). */
export function drawBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  store.cam.x = t * 14;
  store.cam.y = t * 5;
  drawBackground(ctx, W, H, 0);
}

export function drawSpace(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): SpaceRenderResult {
  const snap = store.snap!;
  const own = snap.ship;
  drawBackground(ctx, W, H, snap.systemId);
  const z = store.zoom;
  const S = (x: number, y: number) => worldToScreen(x, y, W, H);

  // Звезда в центре системы.
  const sun = S(0, 0);
  const starColor = STAR_SYSTEMS[snap.systemId]?.star ?? '#fff';
  drawStar(ctx, sun.x, sun.y, 160 * z, starColor, t);
  setStarColor(starColor);

  for (const c of snap.contacts) {
    if (c.k === 'planet') drawPlanet(ctx, c, S, z);
    if (c.k === 'station') drawStation(ctx, c, S, z, t);
  }
  for (const c of snap.contacts) {
    if (c.k === 'asteroid') drawAsteroid(ctx, c, S, z);
    if (c.k === 'loot') drawLoot(ctx, c, S, z);
  }

  // Чужие корабли.
  for (const c of snap.contacts) {
    if (c.k !== 'ship') continue;
    const l = store.layouts.get(c.id);
    const pos = interp(c.id, c.x, c.y);
    const p = S(pos.x, pos.y);
    const moving = Math.hypot(c.vx, c.vy) > 5;
    const heading = store.mode === 'system' ? headingFor(c.id, c.vx, c.vy) : 0;
    if (l) {
      const ts = TILE_WORLD * z;
      // Чужой корабль виден только снаружи — без комнат.
      drawHull(ctx, l, { id: c.id, cx: p.x, cy: p.y, ts, heading, moving, own: false, shieldFrac: c.maxShield ? c.shield / c.maxShield : 0, variant: 'closed', sunAngle: toSunAngle(pos.x, pos.y) }, t);
      if (c.miningId !== null) {
        const a = snap.contacts.find((o) => o.id === c.miningId);
        if (a) beam(ctx, p, S(a.x, a.y), '#ffee58', t);
      }
    }
    label(ctx, `${c.owner}`, p.x, p.y - c.r * z - 14, '#ffcc80');
    bar(ctx, p.x, p.y - c.r * z - 6, 50, c.hp / c.maxHp, '#ff7043');
  }

  // Свой корабль.
  let interior: SpaceRenderResult['interior'] = null;
  if (own) {
    const l = store.layouts.get(own.id);
    const pos = interp(own.id, own.x, own.y);
    const p = S(pos.x, pos.y);
    const ts = TILE_WORLD * z;
    const moving = Math.hypot(own.vx, own.vy) > 5;
    if (l) {
      const heading = store.mode === 'system' ? headingFor(own.id, own.vx, own.vy) : 0;
      const variant = store.mode === 'ship' ? 'open' : 'closed';
      drawHull(ctx, l, { id: own.id, cx: p.x, cy: p.y, ts, heading, moving, own: true, shieldFrac: own.maxShield ? own.shield / own.maxShield : 0, variant, sunAngle: toSunAngle(pos.x, pos.y) }, t);
      if (store.mode === 'ship') {
        const ox = p.x - (l.w / 2) * ts;
        const oy = p.y - (l.h / 2) * ts;
        const crewPos = crewInterp(own);
        drawInterior(ctx, own, l, { ox, oy, ts, t, crewPos });
        interior = { ox, oy, ts };
      }
      // Лучи бура.
      const target = own.targetId !== null ? snap.contacts.find((o) => o.id === own.targetId) : undefined;
      for (const m of own.modules) {
        if (m.type !== 'mining_laser' || !m.active || !target) continue;
        const from = moduleWorld(pos, l, m.x, m.y);
        beam(ctx, S(from.x, from.y), S(target.x, target.y), '#ffee58', t);
      }
    }
    if (own.moveTarget) {
      const m = S(own.moveTarget.x, own.moveTarget.y);
      ctx.strokeStyle = 'rgba(105,240,174,0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (store.mode === 'system') {
      const r = own.sensorRange * z;
      ctx.strokeStyle = 'rgba(79,195,247,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Враги.
  for (const c of snap.contacts) if (c.k === 'npc') drawNpc(ctx, c, S, z, t);
  for (const c of snap.contacts) {
    if (c.k !== 'projectile') continue;
    const pos = interp(c.id, c.x, c.y);
    const p = S(pos.x, pos.y);
    if (c.kind === 'missile') {
      trail(pos.x, pos.y, c.vx, c.vy, [150, 140, 130]);
      // Ракета: корпус по курсу и раскалённое сопло.
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(c.vy, c.vx));
      const L = Math.max(5, 7 * z);
      ctx.fillStyle = '#c9ced4';
      ctx.beginPath();
      ctx.moveTo(L, 0);
      ctx.lineTo(-L * 0.6, -L * 0.25);
      ctx.lineTo(-L * 0.6, L * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(-L * 0.7, 0, 0, -L * 0.7, 0, L);
      g.addColorStop(0, 'rgba(255,220,150,0.95)');
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(-L * 0.7, 0, L, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      trail(pos.x, pos.y, c.vx, c.vy, [120, 160, 30]);
      const r = Math.max(3, 5 * z);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.8);
      g.addColorStop(0, `rgba(230,255,120,${0.8 + 0.2 * Math.sin(t * 10)})`);
      g.addColorStop(0.5, 'rgba(140,200,30,0.6)');
      g.addColorStop(1, 'rgba(60,100,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawFx(ctx, S, z);

  // Выбранная цель.
  const sel = store.selectedId !== null ? snap.contacts.find((c) => c.id === store.selectedId) : undefined;
  if (sel) {
    const pos = interp(sel.id, sel.x, sel.y);
    const p = S(pos.x, pos.y);
    const r = Math.max(14, ('r' in sel ? sel.r : sel.k === 'npc' ? NPCS[sel.type].radius : 8) * z + 8);
    const isTarget = own?.targetId === sel.id;
    ctx.strokeStyle = isTarget ? '#ff5252' : '#ffffff';
    ctx.lineWidth = 2;
    const k = r * 0.35;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(p.x + sx * r, p.y + sy * (r - k));
      ctx.lineTo(p.x + sx * r, p.y + sy * r);
      ctx.lineTo(p.x + sx * (r - k), p.y + sy * r);
      ctx.stroke();
    }
  }
  return { interior };
}

function crewInterp(own: OwnShipView): Map<number, { x: number; y: number }> {
  const out = new Map<number, { x: number; y: number }>();
  const prev = store.prev?.ship;
  const a = Math.min(1, (performance.now() - store.snapAt) / store.tickMs);
  for (const c of own.crew) {
    const pc = prev?.id === own.id ? prev.crew.find((o) => o.id === c.id) : undefined;
    if (pc && Math.hypot(pc.x - c.x, pc.y - c.y) < 2) out.set(c.id, { x: pc.x + (c.x - pc.x) * a, y: pc.y + (c.y - pc.y) * a });
    else out.set(c.id, { x: c.x, y: c.y });
  }
  return out;
}

type ToScreen = (x: number, y: number) => { x: number; y: number };

function drawPlanet(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'planet' }>, S: ToScreen, z: number): void {
  const p = S(c.x, c.y);
  const r = c.r * z;
  // Освещённая сторона — к звезде в центре системы.
  drawPlanetBody(ctx, c.id, c.biome, p.x, p.y, r, Math.atan2(-c.y, -c.x));
  if (c.colony) {
    ctx.strokeStyle = 'rgba(105,240,174,0.35)';
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, (c.r + SAFE_ZONE_RADIUS * 0.5) * z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  label(ctx, c.colony ? `${c.name} · колония` : c.name, p.x, p.y + r + 16, c.colony ? '#69f0ae' : '#b0bec5');
}

function drawStation(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'station' }>, S: ToScreen, z: number, t: number): void {
  const p = S(c.x, c.y);
  const r = c.r * z;
  ctx.strokeStyle = 'rgba(105,240,174,0.3)';
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, SAFE_ZONE_RADIUS * z, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Спрайт крупнее радиуса столкновений: солнечные фермы торчат за кольцо.
  const size = r * 2.8;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(t * 0.03);
  drawSunlit(ctx, stationSprite(c.id), -size / 2, -size / 2, size, size, toSunAngle(c.x, c.y) - t * 0.03);
  // Огни на кольце и шлюзах.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const on = Math.sin(t * 2.5 + i * 0.8) > 0;
    const lr = size * (on ? 0.025 : 0.012);
    const lx = Math.cos(a) * size * 0.36;
    const ly = Math.sin(a) * size * 0.36;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr * 2);
    g.addColorStop(0, i % 2 ? '#69f0ae' : '#ff5252');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly, lr * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  label(ctx, c.name, p.x, p.y + size * 0.5 + 10, '#69f0ae');
}

function drawAsteroid(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'asteroid' }>, S: ToScreen, z: number): void {
  const p = S(c.x, c.y);
  const r = c.r * z;
  if (r < 0.8) return;
  // Спрайт нарисован с полями: глыба занимает ~0.8 его ширины.
  const size = r * 2.6;
  const spin = (c.id % 628) / 100;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(spin);
  drawSunlit(ctx, asteroidSprite(c.id, Object.keys(c.res) as Resource[]), -size / 2, -size / 2, size, size, toSunAngle(c.x, c.y) - spin);
  ctx.restore();
}

function drawLoot(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'loot' }>, S: ToScreen, z: number): void {
  const pos = interp(c.id, c.x, c.y);
  const p = S(pos.x, pos.y);
  const s = Math.max(10, 16 * z);
  const [first] = Object.keys(c.res) as Resource[];
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(((c.id * 37) % 360) * (Math.PI / 180) + performance.now() / 4000);
  ctx.drawImage(crateSprite(RES_COLORS[first] ?? '#ffffff'), -s / 2, -s / 2, s, s);
  ctx.restore();
  const total = Object.values(c.res).reduce((a, b) => a + (b ?? 0), 0);
  if (s > 12) {
    ctx.font = `bold ${Math.max(10, s * 0.45)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(String(Math.round(total)), p.x, p.y + s * 0.4);
    ctx.fillText(String(Math.round(total)), p.x, p.y + s * 0.4);
  }
}

function drawNpc(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'npc' }>, S: ToScreen, z: number, t: number): void {
  const def = NPCS[c.type];
  const pos = interp(c.id, c.x, c.y);
  const p = S(pos.x, pos.y);
  const r = Math.max(6, def.radius * z);
  ctx.save();
  ctx.translate(p.x, p.y);
  if (def.faction === 'flora') {
    // Щупальца шевелятся под телом.
    ctx.strokeStyle = '#3e6b25';
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.sin(t * 0.8 + i) * 0.25;
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a + 0.6) * r * 1.2, Math.sin(a + 0.6) * r * 1.2, Math.cos(a) * r * 1.9, Math.sin(a) * r * 1.9);
      ctx.stroke();
    }
    const pulse = 1 + 0.05 * Math.sin(t * 2 + c.id);
    ctx.drawImage(npcSprite(c.type), -r * 1.6 * pulse, -r * 1.6 * pulse, r * 3.2 * pulse, r * 3.2 * pulse);
  } else {
    ctx.rotate(c.heading);
    // Выхлоп.
    if (Math.hypot(c.vx, c.vy) > 5) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-r, 0, -r * 2.4, 0);
      g.addColorStop(0, 'rgba(255,80,60,0.8)');
      g.addColorStop(1, 'rgba(255,40,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(-r * 1.6, 0, r * 0.9, r * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const size = r * (c.type === 'sentinel' ? 2.4 : 2.8);
    drawSunlit(ctx, npcSprite(c.type), -size / 2, -size / 2, size, size, toSunAngle(pos.x, pos.y) - c.heading);
  }
  ctx.restore();
  if (c.shield > 0) {
    ctx.strokeStyle = 'rgba(79,195,247,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
  }
  bar(ctx, p.x, p.y - r * 1.6 - 6, 34, c.hp / def.maxHp, c.hostile ? '#ff1744' : '#ffab40');
}

function drawFx(ctx: CanvasRenderingContext2D, S: ToScreen, z: number): void {
  const now = performance.now();
  store.fx = store.fx.filter((f) => now - f.born < 600);
  for (const f of store.fx) {
    // Новые взрывы и попадания порождают частицы один раз.
    if (!f.spawned) {
      f.spawned = true;
      if (f.fx.k === 'boom') explosion(f.fx.x, f.fx.y, f.fx.r);
      else if (f.fx.k === 'hit') impact(f.fx.x, f.fx.y, f.fx.shield);
    }
    const { fx } = f;
    const age = (now - f.born) / 600;
    if (fx.k !== 'laser' || age > 0.4) continue;
    const a = S(fx.x1, fx.y1);
    const b = S(fx.x2, fx.y2);
    const fade = 1 - age * 2.5;
    const col = fx.hostile ? '255,40,70' : '64,196,255';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // Ореол, луч и раскалённая сердцевина.
    for (const [w, al] of [
      [9, 0.12],
      [4, 0.45],
    ] as const) {
      ctx.strokeStyle = `rgba(${col},${al * fade})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * fade})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 10);
    g.addColorStop(0, `rgba(${col},${0.8 * fade})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawParticles(ctx, S, z);
}

/** Луч добывающего лазера: ореол, яркая сердцевина, бегущие к цели сгустки энергии и вспышка в точке касания. */
function beam(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string, t: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  const flick = 0.85 + 0.15 * Math.sin(t * 31) * Math.sin(t * 7);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [w, al] of [
    [10, 0.1],
    [5, 0.3],
    [2.4, 0.7],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = al * flick;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.9 * flick;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  // Сгустки энергии бегут от корабля к цели.
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  ctx.fillStyle = '#ffffff';
  for (let d = (t * 260) % 40; d < len; d += 40) {
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(a.x + ux * d, a.y + uy * d, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Вспышка в точке касания.
  const r = 9 + 3 * Math.sin(t * 23);
  const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 4);
}

/** Мини-карта системы в углу экрана. */
export function drawMinimap(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const snap = store.snap!;
  const scale = size / 8000;
  ctx.fillStyle = 'rgba(4,10,18,0.85)';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = 'rgba(0,229,255,0.5)';
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  const M = (wx: number, wy: number) => ({ x: x + size / 2 + wx * scale, y: y + size / 2 + wy * scale });
  const sun = M(0, 0);
  ctx.fillStyle = STAR_SYSTEMS[snap.systemId]?.star ?? '#fff';
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, 4, 0, Math.PI * 2);
  ctx.fill();
  for (const c of snap.contacts) {
    const p = M(c.x, c.y);
    if (c.k === 'planet') {
      ctx.fillStyle = BIOMES[c.biome].color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (c.k === 'station') {
      ctx.fillStyle = '#69f0ae';
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    } else if (c.k === 'asteroid') {
      ctx.fillStyle = '#6d5f55';
      ctx.fillRect(p.x, p.y, 1.5, 1.5);
    } else if (c.k === 'npc') {
      ctx.fillStyle = NPCS[c.type].faction === 'flora' ? '#aeea00' : '#ff1744';
      ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
    } else if (c.k === 'ship') {
      ctx.fillStyle = '#ffab40';
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
  }
  if (snap.ship) {
    const p = M(snap.ship.x, snap.ship.y);
    ctx.fillStyle = '#40c4ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(64,196,255,0.4)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, snap.ship.sensorRange * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#80deea';
  ctx.fillText(STAR_SYSTEMS[snap.systemId]?.name ?? '', x + 6, y + 12);
}

export function resourceName(r: Resource): string {
  return RESOURCE_NAMES[r];
}
