// Корпус и интерьер корабля: пол, стены, двери, модули, экипаж, пожары, свет и воздух по комнатам.
import { MODULES, TILE_WORLD, isModuleType, type ModuleType, type OwnShipView } from '@starforce/shared';
import { store, type ParsedLayout } from '../store';
import { drawModule, roundRect } from './modules';

const floorTex = makeFloorTexture();

function makeFloorTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b2f37';
  g.fillRect(0, 0, 64, 64);
  const grad = g.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad;
  g.fillRect(2, 2, 60, 60);
  g.strokeStyle = '#1a1d22';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 61, 61);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  g.strokeRect(4.5, 4.5, 55, 55);
  g.fillStyle = '#4a505b';
  for (const [x, y] of [
    [8, 8],
    [56, 8],
    [8, 56],
    [56, 56],
  ]) {
    g.beginPath();
    g.arc(x, y, 2, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Цвета комнат для оверлея воздуха — как на скриншоте алгоритма поиска комнат из прототипа 2017 года. */
const ROOM_COLORS = ['#e53935', '#8e24aa', '#1e88e5', '#00acc1', '#43a047', '#fdd835', '#fb8c00', '#d81b60', '#3949ab', '#7cb342'];

export interface HullDrawOpts {
  cx: number;
  cy: number;
  ts: number;
  heading: number;
  moving: boolean;
  own: boolean;
  shieldFrac: number;
  engines: [number, number][];
}

/** Внешняя обшивка корабля: корпус вокруг интерьера, нос вправо, дюзы слева. */
export function drawHull(ctx: CanvasRenderingContext2D, l: ParsedLayout, o: HullDrawOpts, t: number): void {
  let minX = l.w;
  let minY = l.h;
  let maxX = 0;
  let maxY = 0;
  l.grid.tiles.forEach((tile, i) => {
    if (tile === 'empty') return;
    const x = i % l.w;
    const y = Math.floor(i / l.w);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  });
  if (minX > maxX) return;
  const ts = o.ts;
  const left = (minX - l.w / 2) * ts;
  const right = (maxX - l.w / 2) * ts;
  const top = (minY - l.h / 2) * ts;
  const bottom = (maxY - l.h / 2) * ts;
  const h = bottom - top;
  const pad = ts * 1.1;

  ctx.save();
  ctx.translate(o.cx, o.cy);
  ctx.rotate(o.heading);

  // Факел двигателей.
  if (o.moving) {
    for (const [, ey] of o.engines.length ? o.engines : [[minX, (minY + maxY) / 2]]) {
      const y = (ey - l.h / 2 + 0.5) * ts;
      const len = ts * (3 + Math.sin(t * 30 + ey) * 0.6);
      const g = ctx.createLinearGradient(left - pad, y, left - pad - len, y);
      g.addColorStop(0, 'rgba(255,220,120,0.95)');
      g.addColorStop(0.4, 'rgba(255,110,40,0.7)');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(left - pad * 0.6, y - ts * 0.45);
      ctx.lineTo(left - pad - len, y);
      ctx.lineTo(left - pad * 0.6, y + ts * 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Обшивка.
  const g = ctx.createLinearGradient(0, top - pad, 0, bottom + pad);
  g.addColorStop(0, o.own ? '#9aa3ad' : '#a1887f');
  g.addColorStop(0.5, o.own ? '#5f6770' : '#6d4c41');
  g.addColorStop(1, o.own ? '#3b4148' : '#3e2723');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#15181c';
  ctx.lineWidth = Math.max(1, ts * 0.12);
  ctx.beginPath();
  ctx.moveTo(left - pad, top - pad * 0.4);
  ctx.lineTo(right + pad * 0.3, top - pad);
  ctx.lineTo(right + pad + h * 0.35, (top + bottom) / 2);
  ctx.lineTo(right + pad * 0.3, bottom + pad);
  ctx.lineTo(left - pad, bottom + pad * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Гондолы двигателей.
  ctx.fillStyle = o.own ? '#4a5058' : '#4e342e';
  for (const sy of [top - pad * 0.2, bottom - ts * 1.6 + pad * 0.2]) {
    roundRect(ctx, left - pad * 1.5, sy, pad * 1.4, ts * 1.6, ts * 0.3);
    ctx.fill();
    ctx.stroke();
  }
  // Полосы на обшивке.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = Math.max(1, ts * 0.08);
  ctx.beginPath();
  ctx.moveTo(left, top - pad * 0.55);
  ctx.lineTo(right, top - pad * 0.75);
  ctx.moveTo(left, bottom + pad * 0.55);
  ctx.lineTo(right, bottom + pad * 0.75);
  ctx.stroke();

  if (o.shieldFrac > 0.02) {
    const rx = (right - left) / 2 + pad * 2 + h * 0.2;
    const ry = h / 2 + pad * 2;
    const cx = (left + right) / 2 + h * 0.1;
    const sg = ctx.createRadialGradient(cx, 0, Math.min(rx, ry) * 0.6, cx, 0, Math.max(rx, ry));
    sg.addColorStop(0, 'rgba(124,77,255,0)');
    sg.addColorStop(1, `rgba(150,110,255,${0.12 + 0.25 * o.shieldFrac})`);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(cx, (top + bottom) / 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(179,136,255,${0.25 + 0.4 * o.shieldFrac})`;
    ctx.lineWidth = Math.max(1, ts * 0.06);
    ctx.stroke();
  }
  ctx.restore();
}

/** Упрощённый интерьер (чужие корабли и свой в режиме системы): стены, пол и модули без экипажа. */
export function drawLayoutSimple(ctx: CanvasRenderingContext2D, l: ParsedLayout, cx: number, cy: number, ts: number, heading: number, t: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);
  ctx.translate((-l.w / 2) * ts, (-l.h / 2) * ts);
  l.grid.tiles.forEach((tile, i) => {
    if (tile === 'empty') return;
    const x = (i % l.w) * ts;
    const y = Math.floor(i / l.w) * ts;
    ctx.fillStyle = tile === 'wall' ? '#9ea7b3' : tile === 'door' ? '#ffb300' : '#2b2f37';
    ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
  });
  if (ts >= 5) {
    for (const [type, x, y] of l.modules) {
      drawModule(ctx, type, x * ts, y * ts, ts, { powered: true, active: false, growth: 0.6, hpFrac: 1, enabled: true }, t);
    }
  }
  ctx.restore();
}

export interface InteriorDrawOpts {
  ox: number;
  oy: number;
  ts: number;
  t: number;
  crewPos: Map<number, { x: number; y: number }>;
}

/** Полный интерьер своего корабля. (ox, oy) — экранные координаты левого верхнего угла клетки (0,0). */
export function drawInterior(ctx: CanvasRenderingContext2D, ship: OwnShipView, l: ParsedLayout, o: InteriorDrawOpts): void {
  const { ox, oy, ts, t } = o;
  const at = (x: number, y: number) => ({ x: ox + x * ts, y: oy + y * ts });
  const tileAt = (x: number, y: number) => (x < 0 || y < 0 || x >= l.w || y >= l.h ? 'empty' : l.grid.tiles[y * l.w + x]);

  // Пол.
  l.grid.tiles.forEach((tile, i) => {
    if (tile !== 'floor' && tile !== 'door') return;
    const p = at(i % l.w, Math.floor(i / l.w));
    ctx.drawImage(floorTex, p.x, p.y, ts + 0.5, ts + 0.5);
  });

  // Оверлей воздуха: каждая комната своим цветом, насыщенность — концентрация O₂.
  if (store.airOverlay) {
    l.rooms.rooms.forEach((room, ri) => {
      const air = ship.roomAir[ri] ?? 0;
      ctx.fillStyle = ROOM_COLORS[ri % ROOM_COLORS.length];
      ctx.globalAlpha = 0.15 + 0.5 * air;
      let sx = 0;
      let sy = 0;
      for (const tIdx of room.tiles) {
        const p = at(tIdx % l.w, Math.floor(tIdx / l.w));
        ctx.fillRect(p.x, p.y, ts + 0.5, ts + 0.5);
        sx += tIdx % l.w;
        sy += Math.floor(tIdx / l.w);
      }
      ctx.globalAlpha = 1;
      if (ts >= 14) {
        const c = at(sx / room.tiles.length + 0.5, sy / room.tiles.length + 0.5);
        ctx.font = `bold ${Math.max(10, ts * 0.45)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = room.vented ? '#ff1744' : '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        const label = room.vented ? `ПРОБОИНА ${Math.round(air * 100)}%` : `${Math.round(air * 100)}%`;
        ctx.strokeText(label, c.x, c.y);
        ctx.fillText(label, c.x, c.y);
      }
    });
  }

  // Стены: заливка + фаска, соединённые с соседями.
  l.grid.tiles.forEach((tile, i) => {
    if (tile !== 'wall') return;
    const x = i % l.w;
    const y = Math.floor(i / l.w);
    const p = at(x, y);
    ctx.fillStyle = '#7d8793';
    ctx.fillRect(p.x, p.y, ts + 0.5, ts + 0.5);
    ctx.fillStyle = '#a9b3be';
    const edge = Math.max(1, ts * 0.14);
    if (tileAt(x, y - 1) !== 'wall') ctx.fillRect(p.x, p.y, ts, edge);
    if (tileAt(x - 1, y) !== 'wall') ctx.fillRect(p.x, p.y, edge, ts);
    ctx.fillStyle = '#4b535d';
    if (tileAt(x, y + 1) !== 'wall') ctx.fillRect(p.x, p.y + ts - edge, ts, edge);
    if (tileAt(x + 1, y) !== 'wall') ctx.fillRect(p.x + ts - edge, p.y, edge, ts);
  });

  // Двери: открыты, если в проёме кто-то стоит.
  const crewTiles = new Set(ship.crew.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`));
  l.grid.tiles.forEach((tile, i) => {
    if (tile !== 'door') return;
    const x = i % l.w;
    const y = Math.floor(i / l.w);
    const p = at(x, y);
    const open = crewTiles.has(`${x},${y}`);
    const vertical = tileAt(x, y - 1) === 'wall' || tileAt(x, y + 1) === 'wall';
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(p.x, p.y, ts, ts);
    ctx.fillStyle = '#ffb300';
    const gap = open ? ts * 0.35 : 0.02 * ts;
    if (vertical) {
      ctx.fillRect(p.x + ts * 0.3, p.y, ts * 0.4, ts / 2 - gap);
      ctx.fillRect(p.x + ts * 0.3, p.y + ts / 2 + gap, ts * 0.4, ts / 2 - gap);
    } else {
      ctx.fillRect(p.x, p.y + ts * 0.3, ts / 2 - gap, ts * 0.4);
      ctx.fillRect(p.x + ts / 2 + gap, p.y + ts * 0.3, ts / 2 - gap, ts * 0.4);
    }
  });

  // Модули.
  for (const m of ship.modules) {
    const p = at(m.x, m.y);
    drawModule(ctx, m.type, p.x, p.y, ts, { powered: m.powered || !!MODULES[m.type].output, active: m.active, growth: m.growth, hpFrac: m.hp / MODULES[m.type].maxHp, enabled: m.enabled }, t);
  }

  // Чертежи.
  for (const b of ship.blueprints) {
    const p = at(b.x, b.y);
    if (b.remove) {
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = Math.max(1, ts * 0.08);
      ctx.beginPath();
      ctx.moveTo(p.x + ts * 0.2, p.y + ts * 0.2);
      ctx.lineTo(p.x + ts * 0.8, p.y + ts * 0.8);
      ctx.moveTo(p.x + ts * 0.8, p.y + ts * 0.2);
      ctx.lineTo(p.x + ts * 0.2, p.y + ts * 0.8);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.45;
      if (isModuleType(b.kind)) drawModule(ctx, b.kind as ModuleType, p.x, p.y, ts, { powered: true, active: false, growth: 0, hpFrac: 1, enabled: true }, t);
      else {
        ctx.fillStyle = b.kind === 'wall' ? '#90caf9' : b.kind === 'door' ? '#ffe082' : '#80deea';
        ctx.fillRect(p.x, p.y, ts, ts);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#40c4ff';
      ctx.setLineDash([ts * 0.15, ts * 0.1]);
      ctx.lineWidth = Math.max(1, ts * 0.05);
      ctx.strokeRect(p.x + 1, p.y + 1, ts - 2, ts - 2);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#40c4ff';
    ctx.fillRect(p.x + ts * 0.1, p.y + ts * 0.9, ts * 0.8 * b.progress, Math.max(2, ts * 0.06));
  }
  for (const key of ship.urgent) {
    const [kind, id] = key.split(':');
    const target =
      kind === 'extinguish'
        ? { x: Number(id) % l.w, y: Math.floor(Number(id) / l.w) }
        : ship.blueprints.find((b) => b.id === Number(id)) ?? ship.modules.find((m) => m.id === Number(id));
    if (!target) continue;
    const p = at(target.x, target.y);
    ctx.fillStyle = '#ff9100';
    ctx.font = `bold ${ts * 0.5}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('!', p.x + ts * 0.85, p.y + ts * 0.4);
  }

  // Пожары.
  for (const [tile, v] of ship.fires) {
    const p = at(tile % l.w, Math.floor(tile / l.w));
    for (let k = 0; k < 4; k++) {
      const fx = p.x + ts * (0.2 + 0.6 * ((k * 37 + tile) % 10) / 10);
      const fy = p.y + ts * (0.85 - ((t * 1.5 + k * 0.25) % 1) * 0.7);
      const r = ts * (0.18 + 0.2 * v) * (1 - ((t * 1.5 + k * 0.25) % 1) * 0.6);
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
      g.addColorStop(0, 'rgba(255,240,150,0.95)');
      g.addColorStop(0.5, 'rgba(255,120,20,0.8)');
      g.addColorStop(1, 'rgba(200,30,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Экипаж. Если несколько человек в одной клетке — раздвигаем их, чтобы не «залазили друг другу на голову»
  // (проблема, из-за которой в 2017 году отказались от вида сверху).
  const occupancy = new Map<string, number>();
  for (const c of ship.crew) {
    const pos = o.crewPos.get(c.id) ?? c;
    const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
    const n = occupancy.get(key) ?? 0;
    occupancy.set(key, n + 1);
    const spread = n === 0 ? { x: 0, y: 0 } : { x: Math.cos(n * 2.4) * 0.28, y: Math.sin(n * 2.4) * 0.28 };
    const p = at(pos.x + 0.5 + spread.x, pos.y + 0.5 + spread.y);
    drawCrew(ctx, c, p.x, p.y, ts, c.id === store.selectedCrew, store.expeditionCrew.has(c.id), t);
  }

  // Освещение: затемняем интерьер и «вырезаем» пятна света от ламп и светящихся модулей.
  drawLighting(ctx, ship, l, ox, oy, ts);
}

let lightCanvas: HTMLCanvasElement | null = null;

function drawLighting(ctx: CanvasRenderingContext2D, ship: OwnShipView, l: ParsedLayout, ox: number, oy: number, ts: number): void {
  const w = Math.ceil(l.w * ts);
  const h = Math.ceil(l.h * ts);
  if (w <= 0 || h <= 0 || w > 8192 || h > 8192) return;
  if (!lightCanvas) lightCanvas = document.createElement('canvas');
  if (lightCanvas.width !== w || lightCanvas.height !== h) {
    lightCanvas.width = w;
    lightCanvas.height = h;
  }
  const lc = lightCanvas.getContext('2d')!;
  lc.globalCompositeOperation = 'source-over';
  lc.clearRect(0, 0, w, h);
  lc.fillStyle = 'rgba(2,4,12,0.55)';
  l.grid.tiles.forEach((tile, i) => {
    if (tile === 'floor' || tile === 'door') lc.fillRect((i % l.w) * ts, Math.floor(i / l.w) * ts, ts + 0.5, ts + 0.5);
  });
  lc.globalCompositeOperation = 'destination-out';
  for (const m of ship.modules) {
    const light = MODULES[m.type].light;
    if (!light || !m.powered || !m.enabled || m.hp <= 0) continue;
    const cx = (m.x + 0.5) * ts;
    const cy = (m.y + 0.5) * ts;
    const r = light * ts;
    const g = lc.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.arc(cx, cy, r, 0, Math.PI * 2);
    lc.fill();
  }
  ctx.drawImage(lightCanvas, ox, oy);
}

function hashColor(id: number): string {
  const hues = [0, 25, 45, 200, 280, 320, 160, 15];
  return `hsl(${hues[id % hues.length]}, 55%, 45%)`;
}

function drawCrew(
  ctx: CanvasRenderingContext2D,
  c: OwnShipView['crew'][number],
  x: number,
  y: number,
  ts: number,
  selected: boolean,
  expedition: boolean,
  t: number,
): void {
  const r = ts * 0.3;
  if (c.state === 'cryo') {
    ctx.globalAlpha = 0.6;
  }
  if (selected || expedition) {
    ctx.strokeStyle = expedition ? '#69f0ae' : '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.9, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  if (c.robot) {
    ctx.fillStyle = '#90a4ae';
    roundRect(ctx, x - r * 0.8, y - r * 0.7, r * 1.6, r * 1.5, r * 0.3);
    ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.fillRect(x - r * 0.55, y - r * 0.35, r * 1.1, r * 0.4);
    ctx.fillStyle = `hsl(${(t * 120) % 360},90%,60%)`;
    ctx.fillRect(x - r * 0.4, y - r * 0.25, r * 0.25, r * 0.2);
    ctx.fillRect(x + r * 0.15, y - r * 0.25, r * 0.25, r * 0.2);
  } else {
    ctx.fillStyle = hashColor(c.id);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.3, r * 0.85, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1c7a3';
    ctx.beginPath();
    ctx.arc(x, y - r * 0.35, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4e342e';
    ctx.beginPath();
    ctx.arc(x, y - r * 0.5, r * 0.55, Math.PI, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Полоска здоровья и значок состояния.
  if (c.health < 99) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - r, y - r * 1.45, r * 2, Math.max(2, r * 0.2));
    ctx.fillStyle = c.health < 35 ? '#ff5252' : '#69f0ae';
    ctx.fillRect(x - r, y - r * 1.45, (r * 2 * c.health) / 100, Math.max(2, r * 0.2));
  }
  const icon =
    c.state === 'sleeping' ? 'z' : c.state === 'eating' ? '🍴' : c.state === 'cryo' ? '❄' : c.state === 'healing' ? '✚' : c.job === 'extinguish' ? '🔥' : c.job === 'pilot' ? '✈' : '';
  if (ts >= 16) {
    ctx.font = `${Math.max(9, ts * 0.28)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const name = c.name.split(' ')[0];
    const w = ctx.measureText(name).width + 6;
    ctx.fillRect(x - w / 2, y + r * 1.05, w, Math.max(9, ts * 0.28) + 3);
    ctx.fillStyle = '#80d8ff';
    ctx.fillText(name, x, y + r * 1.1);
    if (icon) {
      ctx.fillStyle = '#fff';
      ctx.fillText(icon, x + r * 1.2, y - r * 1.6);
    }
  }
}

/** Мировые координаты центра модуля — для лучей бура и лазеров. */
export function moduleWorld(ship: { x: number; y: number }, l: { w: number; h: number }, mx: number, my: number) {
  return { x: ship.x + (mx - l.w / 2 + 0.5) * TILE_WORLD, y: ship.y + (my - l.h / 2 + 0.5) * TILE_WORLD };
}
