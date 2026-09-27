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
import { interp, store, worldToScreen, type ParsedLayout } from '../store';
import { NEBULA_SIZE, nebulaBlobs, tileOffset, wrappedCenters } from './nebula';
import { drawHull, drawInterior, drawLayoutSimple, moduleWorld } from './ship';

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

let nebula: HTMLCanvasElement | null = null;
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
          ctx.fillStyle = s.c;
          ctx.fillRect(x, y, s.r, s.r);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

function asteroidShape(id: number): number[] {
  const rnd = seeded(id);
  return Array.from({ length: 11 }, () => 0.75 + rnd() * 0.35);
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

export function drawSpace(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): SpaceRenderResult {
  const snap = store.snap!;
  const own = snap.ship;
  drawBackground(ctx, W, H, snap.systemId);
  const z = store.zoom;
  const S = (x: number, y: number) => worldToScreen(x, y, W, H);

  // Звезда в центре системы.
  const sun = S(0, 0);
  const starColor = STAR_SYSTEMS[snap.systemId]?.star ?? '#fff';
  const sunR = 260 * z;
  const sg = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sunR * 3);
  sg.addColorStop(0, '#ffffff');
  sg.addColorStop(0.15, starColor);
  sg.addColorStop(0.35, starColor + '55');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sunR * 3, 0, Math.PI * 2);
  ctx.fill();

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
      drawHull(ctx, l, { cx: p.x, cy: p.y, ts, heading, moving, own: false, shieldFrac: c.maxShield ? c.shield / c.maxShield : 0, engines: engineTiles(l) }, t);
      drawLayoutSimple(ctx, l, p.x, p.y, ts, heading, t);
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
      drawHull(ctx, l, { cx: p.x, cy: p.y, ts, heading, moving, own: true, shieldFrac: own.maxShield ? own.shield / own.maxShield : 0, engines: engineTiles(l) }, t);
      if (store.mode === 'ship') {
        const ox = p.x - (l.w / 2) * ts;
        const oy = p.y - (l.h / 2) * ts;
        const crewPos = crewInterp(own);
        drawInterior(ctx, own, l, { ox, oy, ts, t, crewPos });
        interior = { ox, oy, ts };
      } else {
        drawLayoutSimple(ctx, l, p.x, p.y, ts, heading, t);
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
      ctx.strokeStyle = 'rgba(255,171,64,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - c.vx * 0.08 * z, p.y - c.vy * 0.08 * z);
      ctx.stroke();
      ctx.fillStyle = '#ffe0b2';
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, 3 * z), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(174,234,0,${0.6 + 0.3 * Math.sin(t * 10)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, 5 * z), 0, Math.PI * 2);
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

function engineTiles(l: ParsedLayout): [number, number][] {
  return l.modules.filter(([type]) => type === 'engine').map(([, x, y]) => [x, y]);
}

type ToScreen = (x: number, y: number) => { x: number; y: number };

function drawPlanet(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'planet' }>, S: ToScreen, z: number): void {
  const p = S(c.x, c.y);
  const r = c.r * z;
  const b = BIOMES[c.biome];
  const atm = ctx.createRadialGradient(p.x, p.y, r * 0.9, p.x, p.y, r * 1.35);
  atm.addColorStop(0, b.glow + '66');
  atm.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = atm;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 1.35, 0, Math.PI * 2);
  ctx.fill();
  // Освещённая сторона — к звезде в центре системы.
  const toSun = Math.atan2(-c.y, -c.x);
  const lx = p.x + Math.cos(toSun) * r * 0.4;
  const ly = p.y + Math.sin(toSun) * r * 0.4;
  const g = ctx.createRadialGradient(lx, ly, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, b.glow);
  g.addColorStop(0.45, b.color);
  g.addColorStop(1, '#05070b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(t * 0.1);
  ctx.strokeStyle = '#90a4ae';
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, r * 0.08);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();
  }
  ctx.fillStyle = '#cfd8dc';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = i % 2 ? '#69f0ae' : '#ff5252';
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + i);
    ctx.fillRect(r - 2, -2, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  label(ctx, c.name, p.x, p.y + r + 18, '#69f0ae');
}

function drawAsteroid(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'asteroid' }>, S: ToScreen, z: number): void {
  const p = S(c.x, c.y);
  const r = c.r * z;
  if (r < 0.8) return;
  const shape = asteroidShape(c.id);
  ctx.fillStyle = '#5d5048';
  ctx.strokeStyle = '#2d2622';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  shape.forEach((k, i) => {
    const a = (i / shape.length) * Math.PI * 2;
    const x = p.x + Math.cos(a) * r * k;
    const y = p.y + Math.sin(a) * r * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(p.x - r * 0.25, p.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  // Вкрапления ресурсов.
  const kinds = Object.keys(c.res) as Resource[];
  const rnd = seeded(c.id * 7);
  kinds.forEach((k) => {
    ctx.fillStyle = RES_COLORS[k] ?? '#fff';
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.6;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, Math.max(1, r * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawLoot(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'loot' }>, S: ToScreen, z: number): void {
  const pos = interp(c.id, c.x, c.y);
  const p = S(pos.x, pos.y);
  const s = Math.max(5, 7 * z);
  const [first] = Object.keys(c.res) as Resource[];
  ctx.fillStyle = RES_COLORS[first] ?? '#fff';
  ctx.strokeStyle = '#263238';
  ctx.lineWidth = 1;
  ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
  const total = Object.values(c.res).reduce((a, b) => a + (b ?? 0), 0);
  if (s > 6) {
    ctx.font = `bold ${Math.max(9, s * 0.8)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(String(Math.round(total)), p.x, p.y + s / 2);
    ctx.fillText(String(Math.round(total)), p.x, p.y + s / 2);
  }
}

function drawNpc(ctx: CanvasRenderingContext2D, c: Extract<Contact, { k: 'npc' }>, S: ToScreen, z: number, t: number): void {
  const def = NPCS[c.type];
  const pos = interp(c.id, c.x, c.y);
  const p = S(pos.x, pos.y);
  const r = Math.max(5, def.radius * z);
  ctx.save();
  ctx.translate(p.x, p.y);
  if (def.faction === 'machines') {
    ctx.rotate(c.heading);
    ctx.fillStyle = c.type === 'sentinel' ? '#37474f' : '#455a64';
    ctx.strokeStyle = '#ff1744';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    if (c.type === 'sentinel') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
    } else {
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.8, -r * 0.7);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r * 0.8, r * 0.7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const eye = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
    eye.addColorStop(0, '#ff8a80');
    eye.addColorStop(1, 'rgba(255,23,68,0)');
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Спорокаст — живое растение: пульсирующее ядро и щупальца.
    ctx.strokeStyle = '#558b2f';
    ctx.lineWidth = Math.max(1, r * 0.12);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.sin(t + i) * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a + 0.5) * r, Math.sin(a + 0.5) * r, Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, '#eeff41');
    g.addColorStop(0.5, '#7cb342');
    g.addColorStop(1, '#1b5e20');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.85 + 0.08 * Math.sin(t * 2)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (c.shield > 0) {
    ctx.strokeStyle = 'rgba(179,136,255,0.5)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  bar(ctx, p.x, p.y - r - 8, 34, c.hp / def.maxHp, c.hostile ? '#ff1744' : '#ffab40');
}

function drawFx(ctx: CanvasRenderingContext2D, S: ToScreen, z: number): void {
  const now = performance.now();
  store.fx = store.fx.filter((f) => now - f.born < 600);
  for (const { fx, born } of store.fx) {
    const age = (now - born) / 600;
    if (fx.k === 'laser') {
      if (age > 0.4) continue;
      const a = S(fx.x1, fx.y1);
      const b = S(fx.x2, fx.y2);
      ctx.strokeStyle = fx.hostile ? `rgba(255,23,68,${1 - age * 2.5})` : `rgba(64,196,255,${1 - age * 2.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.8 - age * 2})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (fx.k === 'hit') {
      const p = S(fx.x, fx.y);
      ctx.fillStyle = fx.shield ? `rgba(179,136,255,${1 - age})` : `rgba(255,171,64,${1 - age})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (4 + age * 12) * Math.max(0.5, z), 0, Math.PI * 2);
      ctx.fill();
    } else if (fx.k === 'boom') {
      const p = S(fx.x, fx.y);
      const r = fx.r * z * (0.5 + age);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(2, r));
      g.addColorStop(0, `rgba(255,245,200,${1 - age})`);
      g.addColorStop(0.4, `rgba(255,120,30,${0.8 * (1 - age)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, r), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function beam(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string, t: number): void {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 25);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
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
