// Поверхность планеты: рельеф биома, ресурсные точки, шаттл, команда и местная жизнь.
import { CREATURES, RESOURCE_NAMES, SURFACE_BIOMES, type ExpeditionView, type Resource } from '@starforce/shared';
import { store } from '../store';

const RES_COLOR: Partial<Record<Resource, string>> = {
  metal: '#b0bec5',
  ice: '#b3e5fc',
  water: '#4fc3f7',
  crystals: '#ea80fc',
  biomass: '#9ccc65',
  food: '#ffcc80',
  credits: '#ffd740',
};

const RES_GLYPH: Partial<Record<Resource, string>> = {
  metal: '⛓',
  ice: '❄',
  water: '💧',
  crystals: '💎',
  biomass: '🌿',
  food: '🍞',
  credits: '₵',
};

export interface PlanetLayout {
  ox: number;
  oy: number;
  ts: number;
}

/** Детерминированный «шум» клетки — чтобы земля не была плоской заливкой. */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const terrainCanvas = new Map<number, HTMLCanvasElement>();

/** Рельеф рисуется один раз в отдельный холст и потом только масштабируется. */
function terrainImage(e: ExpeditionView, terrain: string): HTMLCanvasElement {
  const cached = terrainCanvas.get(e.id);
  if (cached) return cached;
  const def = SURFACE_BIOMES[e.biome];
  const S = 32;
  const { w, h } = e.surface;
  const c = document.createElement('canvas');
  c.width = w * S;
  c.height = h * S;
  const g = c.getContext('2d')!;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? '#' : terrain[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = at(x, y);
      const n = hash(x, y);
      const base = ch === '#' ? def.block : ch === '~' ? def.liquid : ch === ',' ? def.rough : def.ground;
      // Непроходимое заметно темнее земли — карта должна читаться с одного взгляда.
      g.fillStyle = shade(base, ch === '#' ? 0.55 + n * 0.15 : 0.88 + n * 0.24);
      g.fillRect(x * S, y * S, S, S);
      if (ch === '.' || ch === ',') {
        // Камешки и трещины.
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let k = 0; k < 3; k++) {
          const px = x * S + hash(x * 7 + k, y * 3) * S;
          const py = y * S + hash(x * 3, y * 7 + k) * S;
          g.fillRect(px, py, 2, 2);
        }
      } else if (ch === '#') {
        // Фактура: тёмные «глыбы» (скалы, кроны, грибные столбы) внутри клетки.
        g.fillStyle = 'rgba(0,0,0,0.28)';
        for (let k = 0; k < 2; k++) {
          g.beginPath();
          g.arc(x * S + (0.3 + 0.4 * hash(x + k, y)) * S, y * S + (0.3 + 0.4 * hash(x, y + k)) * S, S * (0.18 + 0.12 * hash(x * k + 1, y)), 0, Math.PI * 2);
          g.fill();
        }
        // Объём: светлая кромка сверху-слева, тень снизу-справа, где скала граничит с землёй.
        g.fillStyle = 'rgba(255,255,255,0.10)';
        if (at(x, y - 1) !== '#') g.fillRect(x * S, y * S, S, 4);
        if (at(x - 1, y) !== '#') g.fillRect(x * S, y * S, 4, S);
        g.fillStyle = 'rgba(0,0,0,0.45)';
        if (at(x, y + 1) !== '#') g.fillRect(x * S, y * S + S - 5, S, 5);
        if (at(x + 1, y) !== '#') g.fillRect(x * S + S - 5, y * S, 5, S);
        // Чёткая граница с проходимой землёй.
        g.fillStyle = 'rgba(0,0,0,0.7)';
        if (at(x, y - 1) === '.' || at(x, y - 1) === ',') g.fillRect(x * S, y * S, S, 2);
        if (at(x, y + 1) === '.' || at(x, y + 1) === ',') g.fillRect(x * S, y * S + S - 2, S, 2);
        if (at(x - 1, y) === '.' || at(x - 1, y) === ',') g.fillRect(x * S, y * S, 2, S);
        if (at(x + 1, y) === '.' || at(x + 1, y) === ',') g.fillRect(x * S + S - 2, y * S, 2, S);
      } else if (ch === '~') {
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(x * S + 4, y * S + 10 + n * 8, S - 8, 2);
      }
    }
  }
  terrainCanvas.set(e.id, c);
  return c;
}

export function forgetTerrain(id: number): void {
  terrainCanvas.delete(id);
}

export function planetLayout(e: ExpeditionView, W: number, H: number): PlanetLayout {
  const { w, h } = e.surface;
  // Справа остаётся место под карточку высадки, снизу — под журнал и кнопки.
  const right = W > 1000 ? 460 : 16;
  const ts = Math.max(8, Math.floor(Math.min((W - right - 24) / w, (H - 150) / h)));
  return { ts, ox: Math.floor((W - right - w * ts) / 2) + 8, oy: 84 };
}

/** Позиция с интерполяцией между снимками (люди и хищники двигаются плавно). */
function lerpPos(e: ExpeditionView, kind: 'crew' | 'creatures', id: number, x: number, y: number) {
  const prev = store.prev?.expeditions.find((p) => p.id === e.id)?.surface[kind].find((o) => o.id === id);
  if (!prev || Math.hypot(prev.x - x, prev.y - y) > 3) return { x, y };
  const a = Math.min(1, (performance.now() - store.snapAt) / store.tickMs);
  return { x: prev.x + (x - prev.x) * a, y: prev.y + (y - prev.y) * a };
}

export function drawPlanetSurface(ctx: CanvasRenderingContext2D, W: number, H: number, e: ExpeditionView, terrain: string, t: number): PlanetLayout {
  const L = planetLayout(e, W, H);
  const { ox, oy, ts } = L;
  const s = e.surface;
  const def = SURFACE_BIOMES[e.biome];
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrainImage(e, terrain), ox, oy, s.w * ts, s.h * ts);

  // Жидкость мерцает; лава и кислота светятся.
  const glowing = e.biome === 'volcanic' || e.biome === 'toxic';
  if (glowing) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] !== '~') continue;
      const x = i % s.w;
      const y = Math.floor(i / s.w);
      ctx.globalAlpha = 0.12 + 0.08 * Math.sin(t * 2 + hash(x, y) * 6);
      ctx.fillStyle = def.liquid;
      ctx.fillRect(ox + x * ts - ts * 0.3, oy + y * ts - ts * 0.3, ts * 1.6, ts * 1.6);
    }
    ctx.restore();
  }

  // Шаттл: тёмный металл, посадочные огни, безопасная зона.
  const sx = ox + (s.shuttle.x + 0.5) * ts;
  const sy = oy + (s.shuttle.y + 0.5) * ts;
  ctx.strokeStyle = 'rgba(105,240,174,0.25)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(sx, sy, ts * 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const body = ctx.createLinearGradient(sx, sy - ts, sx, sy + ts);
  body.addColorStop(0, '#9aa3ad');
  body.addColorStop(1, '#3b4148');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#15181c';
  ctx.lineWidth = Math.max(1, ts * 0.08);
  ctx.beginPath();
  ctx.moveTo(sx - ts * 1.1, sy + ts * 0.7);
  ctx.lineTo(sx - ts * 0.7, sy - ts * 0.8);
  ctx.lineTo(sx + ts * 0.7, sy - ts * 0.8);
  ctx.lineTo(sx + ts * 1.1, sy + ts * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#102027';
  ctx.fillRect(sx - ts * 0.35, sy - ts * 0.55, ts * 0.7, ts * 0.35);
  for (const [lx, ly] of [
    [-1.05, 0.7],
    [1.05, 0.7],
  ]) {
    ctx.fillStyle = `rgba(255,${Math.sin(t * 4) > 0 ? 80 : 30},40,0.9)`;
    ctx.beginPath();
    ctx.arc(sx + lx * ts, sy + ly * ts, ts * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ресурсные точки.
  for (const n of s.nodes) {
    const nd = def.nodes[n.kind];
    const x = ox + (n.x + 0.5) * ts;
    const y = oy + (n.y + 0.5) * ts;
    const color = RES_COLOR[nd.resource] ?? '#fff';
    const g = ctx.createRadialGradient(x, y, 0, x, y, ts * 0.7);
    g.addColorStop(0, color + 'aa');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, ts * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1f24';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, ts * 0.07);
    ctx.beginPath();
    ctx.arc(x, y, ts * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (ts >= 14) {
      ctx.font = `${Math.round(ts * 0.42)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(RES_GLYPH[nd.resource] ?? '?', x, y + 1);
      label(ctx, String(n.amount), x, y + ts * 0.62, '#e0f7fa', Math.max(9, ts * 0.32));
    }
    if (s.marked.includes(n.id)) {
      ctx.strokeStyle = '#ff9100';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, ts * 0.55 + Math.sin(t * 5) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Местная жизнь.
  for (const c of s.creatures) {
    const cd = CREATURES[c.type];
    const p = lerpPos(e, 'creatures', c.id, c.x, c.y);
    const x = ox + (p.x + 0.5) * ts;
    const y = oy + (p.y + 0.5) * ts;
    const r = ts * 0.34;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.8, r, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    if (c.type === 'drone_scout') {
      ctx.fillStyle = '#37474f';
      ctx.strokeStyle = cd.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) ctx.lineTo(x + Math.cos((i / 6) * Math.PI * 2) * r, y + Math.sin((i / 6) * Math.PI * 2) * r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff8a80';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const wob = 1 + 0.08 * Math.sin(t * 6 + c.id);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * wob);
      g.addColorStop(0, shade(cd.color, 1.3));
      g.addColorStop(1, shade(cd.color, 0.5));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * wob, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff1744';
      ctx.fillRect(x - r * 0.35, y - r * 0.2, r * 0.18, r * 0.18);
      ctx.fillRect(x + r * 0.17, y - r * 0.2, r * 0.18, r * 0.18);
    }
    bar(ctx, x, y - r - 6, ts * 0.8, c.hp / cd.hp, '#ff5252');
  }

  // Команда.
  for (const c of s.crew) {
    if (c.task === 'boarded') continue;
    const p = lerpPos(e, 'crew', c.id, c.x, c.y);
    const x = ox + (p.x + 0.5) * ts;
    const y = oy + (p.y + 0.5) * ts;
    const r = ts * 0.32;
    if (store.planetCrew === c.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = c.robot ? '#90a4ae' : '#cfd8dc';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.3, r * 0.85, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.robot ? '#455a64' : '#4dd0e1';
    ctx.beginPath();
    ctx.arc(x, y - r * 0.35, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x - r * 0.3, y - r * 0.5, r * 0.6, r * 0.2);
    bar(ctx, x, y - r * 1.5, ts * 0.8, c.health / 100, c.health < 40 ? '#ff5252' : '#69f0ae');
    if (ts >= 14) label(ctx, c.name.split(' ')[0], x, y + r * 1.6, '#80d8ff', Math.max(9, ts * 0.3));
  }
  return L;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number): void {
  ctx.font = `${Math.round(size)}px system-ui`;
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
  ctx.fillRect(x - w / 2, y, w, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 3);
}

export function nodeTitle(e: ExpeditionView, kind: number): string {
  const nd = SURFACE_BIOMES[e.biome].nodes[kind];
  return `${nd.name} (${RESOURCE_NAMES[nd.resource]})`;
}
