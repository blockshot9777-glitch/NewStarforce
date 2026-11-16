// Поверхность планеты: рельеф биома, ресурсные точки, шаттл, команда и местная жизнь.
import { CREATURES, RESOURCE_NAMES, SURFACE_BIOMES, type ExpeditionView, type Physical, type Resource } from '@starforce/shared';
import { store } from '../store';
import { drawPaintedItem, drawPaintedPawn, drawPaintedSprite } from './painted';
import { renderTerrain } from './terrain';
import { creatureSprite, shuttleSprite } from './gen/surface';

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


const terrainCanvas = new Map<number, HTMLCanvasElement>();

/** Рельеф рисуется один раз в отдельный холст и потом только масштабируется. */
function terrainImage(e: ExpeditionView, terrain: string): HTMLCanvasElement {
  let c = terrainCanvas.get(e.id);
  if (!c) {
    c = renderTerrain(terrain, e.surface.w, e.surface.h, e.biome, e.id);
    terrainCanvas.set(e.id, c);
  }
  return c;
}

export function forgetTerrain(id: number): void {
  terrainCanvas.delete(id);
}

/** Крупный план, как в RimWorld: камера в клетках карты, масштаб — размер клетки в пикселях. */
export function planetLayout(e: ExpeditionView, W: number, H: number): PlanetLayout {
  const { w, h } = e.surface;
  // Справа остаётся место под карточку высадки, сверху и снизу — под панели.
  const right = W > 1000 ? 460 : 0;
  const areaW = W - right;
  const areaH = H - 84 - 60;
  const fit = Math.min(areaW / w, areaH / h);
  const ts = Math.max(fit, store.planetZoom);
  store.planetZoom = ts;
  // Камера не уводит карту за края.
  const halfW = areaW / 2 / ts;
  const halfH = areaH / 2 / ts;
  store.planetCam.x = w <= 2 * halfW ? w / 2 : Math.max(halfW, Math.min(w - halfW, store.planetCam.x));
  store.planetCam.y = h <= 2 * halfH ? h / 2 : Math.max(halfH, Math.min(h - halfH, store.planetCam.y));
  return { ts, ox: Math.round(areaW / 2 - store.planetCam.x * ts), oy: Math.round(84 + areaH / 2 - store.planetCam.y * ts) };
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

  // Лава и кислота светятся поверх текстуры.
  if (e.biome === 'volcanic' || e.biome === 'toxic') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.1 + 0.05 * Math.sin(t * 2);
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] !== '~') continue;
      ctx.fillStyle = def.liquid;
      ctx.fillRect(ox + (i % s.w) * ts, oy + Math.floor(i / s.w) * ts, ts, ts);
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
  if (!drawPaintedSprite(ctx, 'planet:shuttle', sx, sy, ts * 2.6)) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(sx + ts * 0.25, sy + ts * 0.3, ts * 1.15, ts * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(shuttleSprite(), sx - ts * 1.3, sy - ts * 1.3, ts * 2.6, ts * 2.6);
  }
  // Посадочные огни мигают.
  for (const dx of [-0.95, 0.95]) {
    const on = Math.sin(t * 4 + dx) > 0;
    const g = ctx.createRadialGradient(sx + dx * ts, sy + ts * 0.75, 0, sx + dx * ts, sy + ts * 0.75, ts * 0.3);
    g.addColorStop(0, on ? 'rgba(255,80,50,0.95)' : 'rgba(120,30,20,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx + dx * ts, sy + ts * 0.75, ts * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ресурсные точки.
  drawNodes(ctx, e, L, t);
  drawCreatures(ctx, e, L, t);
  drawCrew(ctx, e, L);
  return L;
}


function drawNodes(ctx: CanvasRenderingContext2D, e: ExpeditionView, L: PlanetLayout, t: number): void {
  const { ox, oy, ts } = L;
  const s = e.surface;
  const def = SURFACE_BIOMES[e.biome];
  for (const n of s.nodes) {
    const nd = def.nodes[n.kind];
    const x = ox + (n.x + 0.5) * ts;
    const y = oy + (n.y + 0.5) * ts;
    const color = RES_COLOR[nd.resource] ?? '#fff';
    // Светящаяся метка-залежь на грунте.
    const g = ctx.createRadialGradient(x, y, 0, x, y, ts * 0.8);
    g.addColorStop(0, color + '66');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, ts * 0.8, 0, Math.PI * 2);
    ctx.fill();
    const size = ts * 0.95;
    const drawn = nd.resource !== 'credits' && drawPaintedItem(ctx, nd.resource as Physical, x - size / 2, y - size / 2, size);
    if (!drawn) {
      ctx.fillStyle = '#1b1f24';
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, ts * 0.07);
      ctx.beginPath();
      ctx.arc(x, y, ts * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `${Math.round(ts * 0.42)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(RES_GLYPH[nd.resource] ?? '?', x, y + 1);
    }
    if (ts >= 12) label(ctx, String(n.amount), x + ts * 0.35, y + ts * 0.4, '#e0f7fa', Math.max(9, ts * 0.32));
    if (s.marked.includes(n.id)) {
      ctx.strokeStyle = '#ff9100';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, ts * 0.62 + Math.sin(t * 5) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawCreatures(ctx: CanvasRenderingContext2D, e: ExpeditionView, L: PlanetLayout, t: number): void {
  const { ox, oy, ts } = L;
  for (const c of e.surface.creatures) {
    const cd = CREATURES[c.type];
    const p = lerpPos(e, 'creatures', c.id, c.x, c.y);
    const prev = store.prev?.expeditions.find((x) => x.id === e.id)?.surface.creatures.find((o) => o.id === c.id);
    const angle = prev && Math.hypot(c.x - prev.x, c.y - prev.y) > 0.01 ? Math.atan2(c.y - prev.y, c.x - prev.x) + Math.PI / 2 : 0;
    const x = ox + (p.x + 0.5) * ts;
    const y = oy + (p.y + 0.5) * ts;
    const r = ts * 0.4;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.25, y + r * 0.35, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!drawPaintedSprite(ctx, `creature:${c.type}`, x, y, ts * 1.1, angle)) {
      const wob = 1 + 0.04 * Math.sin(t * 6 + c.id);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(creatureSprite(c.type), (-ts * 0.65) * wob, (-ts * 0.65) * wob, ts * 1.3 * wob, ts * 1.3 * wob);
      ctx.restore();
    }
    bar(ctx, x, y - r - 6, ts * 0.8, c.hp / cd.hp, '#ff5252');
  }
}


function drawCrew(ctx: CanvasRenderingContext2D, e: ExpeditionView, L: PlanetLayout): void {
  const { ox, oy, ts } = L;
  for (const c of e.surface.crew) {
    if (c.task === 'boarded') continue;
    const p = lerpPos(e, 'crew', c.id, c.x, c.y);
    const x = ox + (p.x + 0.5) * ts;
    const y = oy + (p.y + 0.5) * ts;
    const size = ts * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x + size * 0.08, y + size * 0.3, size * 0.32, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    if (store.planetCrew === c.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!drawPaintedPawn(ctx, c.id, c.robot, x, y, size)) {
      ctx.fillStyle = c.robot ? '#90a4ae' : '#4dd0e1';
      ctx.beginPath();
      ctx.arc(x, y, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    bar(ctx, x, y - size * 0.55, ts * 0.8, c.health / 100, c.health < 40 ? '#ff5252' : '#69f0ae');
    if (ts >= 14) label(ctx, c.name.split(' ')[0], x, y + size * 0.55, '#80d8ff', Math.max(9, ts * 0.3));
  }
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
