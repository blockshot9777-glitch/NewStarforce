// Корпус и интерьер корабля: пол, стены, двери, модули, экипаж, пожары, свет и воздух по комнатам.
import { MODULES, TEMP_COMFORT_MAX, TEMP_COMFORT_MIN, TILE_WORLD, isModuleType, moduleSize, type ModuleType, type OwnShipView, type Physical } from '@starforce/shared';
import { store, type ParsedLayout } from '../store';
import { hullFor } from './gen/hullStore';
import { drawSunlit } from './sunlight';
import { wallMask, wallTile } from './gen/interior';
import { DOOR_CELL, WALL_CELL, drawCell, drawPawn, drawStackArt, floorCell } from './kenney';
import { drawModule, roundRect } from './modules';
import { drawPaintedItem, drawPaintedPawn, drawPaintedTile } from './painted';

const floorTex = makeFloorTexture();

function makeFloorTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2e36';
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

/** Комнаты в одну клетку шириной — коридор, у них другой пол. */
function corridorRooms(l: ParsedLayout): Set<number> {
  const thin = new Set<number>();
  l.rooms.rooms.forEach((room, ri) => {
    if (!room.tiles.length) return;
    let minX = l.w;
    let minY = l.h;
    let maxX = 0;
    let maxY = 0;
    for (const t of room.tiles) {
      const x = t % l.w;
      const y = Math.floor(t / l.w);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (maxX === minX || maxY === minY) thin.add(ri);
  });
  return thin;
}

function floorKey(l: ParsedLayout, gx: number, gy: number, stock: Set<number> | null, thin: Set<number>): string {
  const i = gy * l.w + gx;
  if (stock?.has(i)) return 'floor_stockpile';
  const room = l.rooms.roomOf[i] ?? -1;
  if (room >= 0 && thin.has(room)) return 'floor_corridor';
  return 'floor';
}

function paintFloor(
  ctx: CanvasRenderingContext2D,
  l: ParsedLayout,
  gx: number,
  gy: number,
  x: number,
  y: number,
  ts: number,
  stock: Set<number> | null,
  thin: Set<number>,
): void {
  const [fc, fr] = floorCell(gx, gy);
  if (drawCell(ctx, 'tiles', fc, fr, x, y, ts + 0.5)) return;
  const key = floorKey(l, gx, gy, stock, thin);
  if (drawPaintedTile(ctx, key, x, y, ts + 0.5, 0)) return;
  if (key === 'floor_corridor') {
    ctx.fillStyle = '#0c2230';
    ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
    ctx.strokeStyle = '#1f6f86';
    ctx.lineWidth = Math.max(1, ts * 0.06);
    ctx.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
  } else if (key === 'floor_stockpile') {
    ctx.fillStyle = '#5a3322';
    ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
    ctx.fillStyle = '#f2b400';
    ctx.fillRect(x, y + ts * 0.82, ts, Math.max(1, ts * 0.08));
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x, y + ts * 0.9, ts, Math.max(1, ts * 0.08));
  } else {
    ctx.drawImage(floorTex, x, y, ts + 0.5, ts + 0.5);
  }
}

function paintWall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  gx: number,
  gy: number,
  tileAt: (x: number, y: number) => string,
): void {
  if (drawCell(ctx, 'tiles', WALL_CELL[0], WALL_CELL[1], x, y, ts + 0.5)) return;
  // Сплошная стальная переборка: плитка по маске соседей (двери считаются продолжением стены).
  const joins = (dx: number, dy: number) => {
    const t = tileAt(gx + dx, gy + dy);
    return t === 'wall' || t === 'door';
  };
  if (ts >= 6) {
    ctx.drawImage(wallTile(wallMask(joins)), x, y, ts + 0.5, ts + 0.5);
    return;
  }
  ctx.fillStyle = '#7f8894';
  ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
  const edge = Math.max(1, ts * 0.14);
  ctx.fillStyle = '#b6bec8';
  if (tileAt(gx, gy - 1) !== 'wall') ctx.fillRect(x, y, ts, edge);
  if (tileAt(gx - 1, gy) !== 'wall') ctx.fillRect(x, y, edge, ts);
  ctx.fillStyle = '#3e454e';
  if (tileAt(gx, gy + 1) !== 'wall') ctx.fillRect(x, y + ts - edge, ts, edge);
  if (tileAt(gx + 1, gy) !== 'wall') ctx.fillRect(x + ts - edge, y, edge, ts);
}

/** Закрытая дверь — целый люк. Открытая — створки с просветом в пол. */
function paintDoor(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number, open: boolean, vertical: boolean): void {
  if (!open && drawCell(ctx, 'tiles', DOOR_CELL[0], DOOR_CELL[1], x, y, ts)) return;
  if (!open && drawPaintedTile(ctx, 'door', x, y, ts, 0)) return;
  const gap = open ? ts * 0.34 : ts * 0.02;
  ctx.fillStyle = '#5c656e';
  if (vertical) {
    ctx.fillRect(x + ts * 0.22, y + ts * 0.08, ts * 0.56, ts / 2 - gap);
    ctx.fillRect(x + ts * 0.22, y + ts / 2 + gap, ts * 0.56, ts / 2 - gap - ts * 0.08);
  } else {
    ctx.fillRect(x + ts * 0.08, y + ts * 0.22, ts / 2 - gap, ts * 0.56);
    ctx.fillRect(x + ts / 2 + gap, y + ts * 0.22, ts / 2 - gap - ts * 0.08, ts * 0.56);
  }
  const band = Math.max(1, ts * 0.07);
  ctx.fillStyle = '#f2b400';
  ctx.fillRect(x, y, ts, band);
  ctx.fillRect(x, y + ts - band, ts, band);
  ctx.fillStyle = '#1a1a1a';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(x + (ts / 6) * i, y, ts / 12, band);
    ctx.fillRect(x + (ts / 6) * i, y + ts - band, ts / 12, band);
  }
  ctx.fillStyle = '#ff8f00';
  ctx.fillRect(x + ts * 0.12, y + ts * 0.14, Math.max(2, ts * 0.08), Math.max(2, ts * 0.08));
  ctx.fillRect(x + ts * 0.8, y + ts * 0.14, Math.max(2, ts * 0.08), Math.max(2, ts * 0.08));
}

function drawStackLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ts: number): void {
  ctx.font = `${Math.max(8, ts * 0.22)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 6;
  const h = Math.max(10, ts * 0.26);
  ctx.fillStyle = 'rgba(6,22,30,0.88)';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#d8f3f8';
  ctx.fillText(text, x, y);
}

/** Запасная иконка стопки, если картинка ресурса не загрузилась. */
function drawResourceMark(ctx: CanvasRenderingContext2D, resource: Physical, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  if (resource === 'metal') {
    ctx.fillStyle = '#8d97a3';
    ctx.beginPath();
    ctx.moveTo(-s * 0.32, -s * 0.05);
    ctx.lineTo(s * 0.34, -s * 0.18);
    ctx.lineTo(s * 0.34, s * 0.12);
    ctx.lineTo(-s * 0.32, s * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d7dde4';
    ctx.fillRect(-s * 0.28, -s * 0.16, s * 0.5, s * 0.08);
  } else if (resource === 'ice') {
    ctx.fillStyle = '#b3e5fc';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.32);
    ctx.lineTo(s * 0.28, -s * 0.05);
    ctx.lineTo(s * 0.12, s * 0.3);
    ctx.lineTo(-s * 0.22, s * 0.18);
    ctx.lineTo(-s * 0.28, -s * 0.08);
    ctx.closePath();
    ctx.fill();
  } else if (resource === 'water') {
    ctx.fillStyle = '#0277bd';
    roundRect(ctx, -s * 0.22, -s * 0.3, s * 0.44, s * 0.6, s * 0.08);
    ctx.fill();
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(-s * 0.12, -s * 0.16, s * 0.24, s * 0.32);
  } else if (resource === 'crystals') {
    ctx.fillStyle = '#8e24aa';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.34);
    ctx.lineTo(s * 0.22, 0);
    ctx.lineTo(0, s * 0.34);
    ctx.lineTo(-s * 0.22, 0);
    ctx.closePath();
    ctx.fill();
  } else if (resource === 'biomass') {
    ctx.fillStyle = '#558b2f';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.04, s * 0.28, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#e65100';
    roundRect(ctx, -s * 0.26, -s * 0.18, s * 0.52, s * 0.36, s * 0.06);
    ctx.fill();
  }
  ctx.restore();
}

/** Цвета комнат для оверлея воздуха — как на скриншоте алгоритма поиска комнат из прототипа 2017 года. */
const ROOM_COLORS = ['#e53935', '#8e24aa', '#1e88e5', '#00acc1', '#43a047', '#fdd835', '#fb8c00', '#d81b60', '#3949ab', '#7cb342'];

export interface HullDrawOpts {
  /** id корабля — зерно генерации (у каждого корабля свой рисунок обшивки и номер). */
  id: number;
  cx: number;
  cy: number;
  ts: number;
  heading: number;
  moving: boolean;
  own: boolean;
  shieldFrac: number;
  /** open — вырез под интерьер; closed — крыша отсеков (вид снаружи). */
  variant: 'open' | 'closed';
  /** Направление на звезду в мире (рад) — корпус подсвечен с этой стороны. Нет — без затенения. */
  sunAngle?: number;
}

/** Внешняя обшивка корабля: сгенерированный спрайт + факелы, огни и щит, которые меняются каждый кадр. */
export function drawHull(ctx: CanvasRenderingContext2D, l: ParsedLayout, o: HullDrawOpts, t: number): void {
  const sprite = hullFor(`${o.id}:${o.variant}:${o.own}`, String(l.version), {
    w: l.w,
    h: l.h,
    tiles: l.grid.tiles,
    modules: l.modules,
    own: o.own,
    seed: o.id,
    variant: o.variant,
  });
  const ts = o.ts;
  const k = ts / sprite.px;
  const X = (tx: number) => (tx - l.w / 2) * ts;
  const Y = (ty: number) => (ty - l.h / 2) * ts;
  ctx.save();
  ctx.translate(o.cx, o.cy);
  ctx.rotate(o.heading);

  // Факелы — под корпусом, из каждого сопла.
  if (o.moving) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const n of sprite.nozzles) {
      const x = X(n.x);
      const y = Y(n.y);
      const len = ts * (2.8 + Math.sin(t * 37 + n.y * 3) * 0.35 + Math.sin(t * 13 + n.y) * 0.25);
      const r = n.r * ts;
      const outer = ctx.createLinearGradient(x, y, x - len, y);
      outer.addColorStop(0, 'rgba(255,170,80,0.9)');
      outer.addColorStop(0.35, 'rgba(255,90,30,0.55)');
      outer.addColorStop(1, 'rgba(255,40,0,0)');
      ctx.fillStyle = outer;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x - len * 0.35, y - r * 1.25, x - len, y);
      ctx.quadraticCurveTo(x - len * 0.35, y + r * 1.25, x, y + r);
      ctx.closePath();
      ctx.fill();
      const core = ctx.createLinearGradient(x, y, x - len * 0.55, y);
      core.addColorStop(0, 'rgba(220,240,255,0.95)');
      core.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.ellipse(x - len * 0.2, y, len * 0.28, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.imageSmoothingEnabled = true;
  if (o.sunAngle !== undefined) drawSunlit(ctx, sprite.canvas, X(-sprite.offX), Y(-sprite.offY), sprite.canvas.width * k, sprite.canvas.height * k, o.sunAngle - o.heading);
  else ctx.drawImage(sprite.canvas, X(-sprite.offX), Y(-sprite.offY), sprite.canvas.width * k, sprite.canvas.height * k);

  // Бортовые огни: мигают по очереди.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  sprite.lights.forEach((li, i) => {
    const on = Math.sin(t * 3 + i * 2.1) > 0.2;
    const r = ts * (on ? 0.9 : 0.35);
    const g = ctx.createRadialGradient(X(li.x), Y(li.y), 0, X(li.x), Y(li.y), r);
    g.addColorStop(0, li.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = on ? 0.95 : 0.4;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X(li.x), Y(li.y), r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // Щит: тонкая мерцающая оболочка, а не заливка поверх корабля.
  if (o.shieldFrac > 0.02) {
    const w = sprite.canvas.width * k;
    const h = sprite.canvas.height * k;
    const cx = X(-sprite.offX) + w / 2;
    const cy = Y(-sprite.offY) + h / 2;
    const rx = w * 0.56;
    const ry = h * 0.62;
    const a = 0.1 + 0.25 * o.shieldFrac;
    const rim = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.85, cx, cy, Math.max(rx, ry));
    rim.addColorStop(0, 'rgba(64,196,255,0)');
    rim.addColorStop(0.8, `rgba(64,196,255,${a * 0.35})`);
    rim.addColorStop(1, 'rgba(64,196,255,0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(128,222,255,${a})`;
    ctx.lineWidth = Math.max(1, ts * 0.06);
    ctx.setLineDash([ts * 0.9, ts * 0.5]);
    ctx.lineDashOffset = -t * ts * 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Упрощённый интерьер (чужие корабли и свой в режиме системы): стены, пол и модули без экипажа. */
export function drawLayoutSimple(ctx: CanvasRenderingContext2D, l: ParsedLayout, cx: number, cy: number, ts: number, heading: number, t: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);
  ctx.translate((-l.w / 2) * ts, (-l.h / 2) * ts);
  const thin = corridorRooms(l);
  const tileAt = (x: number, y: number) => (x < 0 || y < 0 || x >= l.w || y >= l.h ? 'empty' : l.grid.tiles[y * l.w + x]);
  l.grid.tiles.forEach((tile, i) => {
    if (tile === 'empty') return;
    const gx = i % l.w;
    const gy = Math.floor(i / l.w);
    const x = gx * ts;
    const y = gy * ts;
    if (tile === 'floor' || tile === 'door') paintFloor(ctx, l, gx, gy, x, y, ts, null, thin);
    if (tile === 'wall') paintWall(ctx, x, y, ts, gx, gy, tileAt);
    if (tile === 'door') {
      const vertical = tileAt(gx, gy - 1) === 'wall' || tileAt(gx, gy + 1) === 'wall';
      paintDoor(ctx, x, y, ts, false, vertical);
    }
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

  const stock = new Set(ship.stockpile);
  const thin = corridorRooms(l);
  // Пол.
  l.grid.tiles.forEach((tile, i) => {
    if (tile !== 'floor' && tile !== 'door') return;
    const gx = i % l.w;
    const gy = Math.floor(i / l.w);
    const p = at(gx, gy);
    paintFloor(ctx, l, gx, gy, p.x, p.y, ts, stock, thin);
  });

  if (store.tempOverlay) {
    l.rooms.rooms.forEach((room, ri) => {
      const temp = ship.roomTemp[ri] ?? 21;
      const hot = temp > TEMP_COMFORT_MAX;
      const cold = temp < TEMP_COMFORT_MIN;
      const excess = hot ? temp - TEMP_COMFORT_MAX : cold ? TEMP_COMFORT_MIN - temp : 0;
      ctx.fillStyle = hot ? '#c62828' : cold ? '#1565c0' : '#2e7d32';
      ctx.globalAlpha = 0.14 + Math.min(0.4, excess / 70);
      for (const tIdx of room.tiles) {
        const p = at(tIdx % l.w, Math.floor(tIdx / l.w));
        ctx.fillRect(p.x, p.y, ts + 0.5, ts + 0.5);
      }
      ctx.globalAlpha = 1;
    });
  }

  // Оверлей воздуха: каждая комната своим цветом, насыщенность — концентрация O₂.
  if (store.airOverlay) {
    l.rooms.rooms.forEach((room, ri) => {
      const air = ship.roomAir[ri] ?? 0;
      ctx.fillStyle = ROOM_COLORS[ri % ROOM_COLORS.length];
      ctx.globalAlpha = 0.15 + 0.5 * air;
      for (const tIdx of room.tiles) {
        const p = at(tIdx % l.w, Math.floor(tIdx / l.w));
        ctx.fillRect(p.x, p.y, ts + 0.5, ts + 0.5);
      }
      ctx.globalAlpha = 1;
    });
  }

  // Граница склада — жёлтая кромка, пол под ней остаётся тёмным.
  ctx.strokeStyle = '#f2b400';
  ctx.lineWidth = Math.max(1, ts * 0.07);
  for (const tIdx of ship.stockpile) {
    const x = tIdx % l.w;
    const y = Math.floor(tIdx / l.w);
    const p = at(x, y);
    ctx.beginPath();
    if (y === 0 || !stock.has(tIdx - l.w)) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + ts, p.y);
    }
    if (y === l.h - 1 || !stock.has(tIdx + l.w)) {
      ctx.moveTo(p.x, p.y + ts);
      ctx.lineTo(p.x + ts, p.y + ts);
    }
    if (x === 0 || !stock.has(tIdx - 1)) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + ts);
    }
    if (x === l.w - 1 || !stock.has(tIdx + 1)) {
      ctx.moveTo(p.x + ts, p.y);
      ctx.lineTo(p.x + ts, p.y + ts);
    }
    ctx.stroke();
  }

  // Стены: сплошная переборка, фаска только на открытых рёбрах.
  l.grid.tiles.forEach((tile, i) => {
    if (tile !== 'wall') return;
    const x = i % l.w;
    const y = Math.floor(i / l.w);
    const p = at(x, y);
    paintWall(ctx, p.x, p.y, ts, x, y, tileAt);
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
    paintDoor(ctx, p.x, p.y, ts, open, vertical);
  });

  // Модули.
  for (const m of ship.modules) {
    const p = at(m.x, m.y);
    drawModule(ctx, m.type, p.x, p.y, ts, { powered: m.powered || !!MODULES[m.type].output, active: m.active, growth: m.growth, hpFrac: m.hp / MODULES[m.type].maxHp, enabled: m.enabled }, t);
  }

  // Чертежи.
  for (const b of ship.blueprints) {
    const p = at(b.x, b.y);
    const [bw, bh] = isModuleType(b.kind) ? moduleSize(b.kind) : [1, 1];
    const pw = ts * bw;
    const ph = ts * bh;
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
      ctx.globalAlpha = b.ready ? 0.55 : 0.22;
      if (isModuleType(b.kind)) drawModule(ctx, b.kind as ModuleType, p.x, p.y, ts, { powered: true, active: false, growth: 0, hpFrac: 1, enabled: true }, t);
      else {
        ctx.fillStyle = b.kind === 'wall' ? '#90caf9' : b.kind === 'door' ? '#ffe082' : '#80deea';
        ctx.fillRect(p.x, p.y, ts, ts);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#40c4ff';
      ctx.setLineDash([ts * 0.15, ts * 0.1]);
      ctx.lineWidth = Math.max(1, ts * 0.05);
      ctx.strokeRect(p.x + 1, p.y + 1, pw - 2, ph - 2);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#40c4ff';
    ctx.fillRect(p.x + pw * 0.1, p.y + ph - Math.max(2, ts * 0.1), (pw * 0.8) * b.progress, Math.max(2, ts * 0.06));
  }

  for (const s of ship.stacks) {
    const p = at(s.x, s.y);
    const icon = ts * 0.62;
    const ix = p.x + (ts - icon) / 2;
    const iy = p.y + ts * 0.28;
    if (!drawStackArt(ctx, s.resource, ix, iy, icon) && !drawPaintedItem(ctx, s.resource, ix, iy, icon)) {
      drawResourceMark(ctx, s.resource, ix, iy, icon);
    }
    if (ts >= 16) {
      const label = s.amount >= 10 ? String(Math.round(s.amount)) : s.amount.toFixed(1);
      drawStackLabel(ctx, label, p.x + ts * 0.5, p.y + ts * 0.18, ts);
    }
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

  for (const c of ship.crew) {
    if (!c.order) continue;
    const p = at(c.order.x, c.order.y);
    const mine = c.id === store.selectedCrew;
    ctx.strokeStyle = mine ? '#ffab40' : 'rgba(255,224,130,0.7)';
    ctx.lineWidth = mine ? 2 : 1;
    ctx.strokeRect(p.x + 2, p.y + 2, ts - 4, ts - 4);
    ctx.fillStyle = mine ? '#ffab40' : '#ffe082';
    ctx.font = `bold ${Math.max(10, ts * 0.4)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×', p.x + ts * 0.5, p.y + ts * 0.5);
  }

  // Освещение: затемняем интерьер и «вырезаем» пятна света от ламп и светящихся модулей.
  drawLighting(ctx, ship, l, ox, oy, ts);
  // Проценты воздуха — после модулей и темноты, иначе при отдалении их закрывает постройка.
  if (store.airOverlay) drawAirLabels(ctx, ship, l, at, ts);
  if (store.tempOverlay) drawTempLabels(ctx, ship, l, at, ts);
}

function drawTempLabels(
  ctx: CanvasRenderingContext2D,
  ship: OwnShipView,
  l: ParsedLayout,
  at: (x: number, y: number) => { x: number; y: number },
  ts: number,
): void {
  if (ts < 8) return;
  l.rooms.rooms.forEach((room, ri) => {
    if (!room.tiles.length) return;
    const temp = ship.roomTemp[ri] ?? 21;
    let sx = 0;
    let sy = 0;
    for (const tIdx of room.tiles) {
      sx += tIdx % l.w;
      sy += Math.floor(tIdx / l.w);
    }
    const c = at(sx / room.tiles.length + 0.5, sy / room.tiles.length + 0.5);
    const label = `${Math.round(temp)}°`;
    ctx.font = `bold ${Math.max(9, Math.min(16, ts * 0.42))}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle = temp < TEMP_COMFORT_MIN ? '#90caf9' : temp > TEMP_COMFORT_MAX ? '#ff8a80' : '#d8f3f8';
    ctx.strokeText(label, c.x, c.y);
    ctx.fillText(label, c.x, c.y);
  });
}

function drawAirLabels(
  ctx: CanvasRenderingContext2D,
  ship: OwnShipView,
  l: ParsedLayout,
  at: (x: number, y: number) => { x: number; y: number },
  ts: number,
): void {
  if (ts < 8) return;
  l.rooms.rooms.forEach((room, ri) => {
    if (!room.tiles.length) return;
    const air = ship.roomAir[ri] ?? 0;
    let sx = 0;
    let sy = 0;
    for (const tIdx of room.tiles) {
      sx += tIdx % l.w;
      sy += Math.floor(tIdx / l.w);
    }
    const c = at(sx / room.tiles.length + 0.5, sy / room.tiles.length + 0.5);
    const label = room.vented ? `ПРОБОИНА ${Math.round(air * 100)}%` : `${Math.round(air * 100)}%`;
    ctx.font = `bold ${Math.max(9, Math.min(16, ts * 0.42))}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle = room.vented ? '#ff1744' : '#fff';
    ctx.strokeText(label, c.x, c.y);
    ctx.fillText(label, c.x, c.y);
  });
}

let lightCanvas: HTMLCanvasElement | null = null;

/** Цвет света модулей (только визуал): тёплые лампы, голубой мостик, оранжевый реактор, зелёная фитолампа (палитра ART_STYLE.md). */
const LIGHT_COLOR: Partial<Record<ModuleType, [number, number, number]>> = {
  lamp: [255, 222, 170],
  bridge: [120, 196, 255],
  reactor: [255, 160, 50],
  hydroponics: [105, 240, 174],
  medbay: [150, 255, 205],
};

/**
 * Освещение интерьера — карта света: тёмный холодный фон, цветные пятна от источников, свет не проходит
 * сквозь стены (каждое пятно обрезано своей комнатой и её стенами). Карта умножается на кадр, затем
 * часть света добавляется сверху — светлые пятна «горят» и подхватываются свечением постобработки.
 * Пожары дают мерцающий оранжевый свет, разгерметизированная комната — красный тревожный.
 */
function drawLighting(ctx: CanvasRenderingContext2D, ship: OwnShipView, l: ParsedLayout, ox: number, oy: number, ts: number): void {
  const w = Math.ceil(l.w * ts);
  const h = Math.ceil(l.h * ts);
  if (w <= 0 || h <= 0 || w > 8192 || h > 8192) return;
  if (!lightCanvas) lightCanvas = document.createElement('canvas');
  if (lightCanvas.width !== w || lightCanvas.height !== h) {
    lightCanvas.width = w;
    lightCanvas.height = h;
  }
  const t = performance.now() / 1000;
  const lc = lightCanvas.getContext('2d')!;
  lc.globalCompositeOperation = 'source-over';
  lc.clearRect(0, 0, w, h);
  // Фон: пол в полутьме, стены чуть светлее (их видно и без ламп).
  l.grid.tiles.forEach((tile, i) => {
    if (tile === 'empty') return;
    lc.fillStyle = tile === 'wall' ? 'rgb(132,138,156)' : 'rgb(92,98,122)';
    lc.fillRect((i % l.w) * ts, Math.floor(i / l.w) * ts, ts + 0.5, ts + 0.5);
  });

  // Область комнаты для обрезки света: её клетки плюс соседние стены и двери (освещается их внутренняя грань).
  const roomPath = new Map<number, Path2D>();
  const pathOf = (room: number): Path2D => {
    let p = roomPath.get(room);
    if (p) return p;
    p = new Path2D();
    const seen = new Set<number>();
    for (const tIdx of l.rooms.rooms[room].tiles) {
      const x = tIdx % l.w;
      const y = Math.floor(tIdx / l.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= l.w || ny >= l.h) continue;
          const ni = ny * l.w + nx;
          if (seen.has(ni) || l.grid.tiles[ni] === 'empty') continue;
          if (ni !== tIdx && l.rooms.roomOf[ni] !== -1) continue;
          seen.add(ni);
          p.rect(nx * ts, ny * ts, ts + 0.5, ts + 0.5);
        }
    }
    roomPath.set(room, p);
    return p;
  };
  type Light = { x: number; y: number; r: number; c: [number, number, number]; k: number; room: number };
  const lights: Light[] = [];
  const roomAt = (x: number, y: number) => {
    const xi = Math.max(0, Math.min(l.w - 1, Math.floor(x)));
    const yi = Math.max(0, Math.min(l.h - 1, Math.floor(y)));
    return l.rooms.roomOf[yi * l.w + xi];
  };
  for (const m of ship.modules) {
    const light = MODULES[m.type].light;
    if (!light || !m.powered || !m.enabled || m.hp <= 0) continue;
    const [sw, sh] = moduleSize(m.type);
    const cx = m.x + sw / 2;
    const cy = m.y + sh / 2;
    lights.push({ x: cx, y: cy, r: light * 1.15, c: LIGHT_COLOR[m.type] ?? [255, 236, 210], k: 1, room: roomAt(m.x, m.y) });
  }
  ship.fires.forEach(([tile, v], i) => {
    const flick = 0.75 + 0.25 * Math.sin(t * 23 + i * 1.7) * Math.sin(t * 7.3 + i);
    lights.push({ x: (tile % l.w) + 0.5, y: Math.floor(tile / l.w) + 0.5, r: 1.8 + v * 1.5, c: [255, 130, 40], k: flick, room: roomAt(tile % l.w, tile / l.w) });
  });

  const paint = (g: CanvasRenderingContext2D, li: Light, alpha: number) => {
    const cx = li.x * ts;
    const cy = li.y * ts;
    const r = li.r * ts;
    const [cr, cg, cb] = li.c;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = alpha * li.k;
    gr.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    gr.addColorStop(0.35, `rgba(${cr},${cg},${cb},${a * 0.6})`);
    gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  lc.globalCompositeOperation = 'lighter';
  for (const li of lights) {
    lc.save();
    if (li.room >= 0) lc.clip(pathOf(li.room));
    paint(lc, li, 1);
    lc.restore();
  }
  // Разгерметизация: комната мигает красным аварийным светом.
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);
  l.rooms.rooms.forEach((room, ri) => {
    if (!room.vented || !room.tiles.length) return;
    lc.fillStyle = `rgba(255,30,20,${0.25 + 0.35 * pulse})`;
    lc.fill(pathOf(ri));
  });

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lightCanvas, ox, oy);
  // Пересвет в центре пятен — пол «блестит» от ламп.
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(ox, oy);
  for (const li of lights) {
    ctx.save();
    if (li.room >= 0) ctx.clip(pathOf(li.room));
    paint(ctx, { ...li, r: li.r * 0.7 }, 0.16);
    ctx.restore();
  }
  ctx.restore();
}

const SUITS = ['#1a3a5c', '#3e4a32', '#5c4033', '#37474f', '#4a2c2a'];
const HAIR = ['#1a1a1a', '#8d6e63', '#e6c27a', '#3e2723', '#6d4c41'];
const SKIN = ['#f1c27d', '#e0ac69', '#8d5524', '#c68642', '#ffdbac'];

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
  // В кадре много пустого поля: видимый рост ~0.58 стороны. 1.38 клетки даёт тело около 0.8 клетки.
  const pawn = ts * 1.38;
  const bodyHalf = pawn * 0.32;
  if (c.state === 'cryo') {
    ctx.globalAlpha = 0.6;
  }
  if (c.draft) {
    ctx.strokeStyle = '#ffab40';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - ts * 0.46, y - bodyHalf - ts * 0.06, ts * 0.92, bodyHalf * 2 + ts * 0.1);
  }
  if (selected || expedition) {
    ctx.strokeStyle = expedition ? '#69f0ae' : '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, bodyHalf + ts * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + bodyHalf * 0.92, ts * 0.28, ts * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  const dressed = drawPawn(ctx, c.id, c.robot, x, y, pawn) || drawPaintedPawn(ctx, c.id, c.robot, x, y, pawn);
  if (!dressed && c.robot) {
    ctx.fillStyle = '#90a4ae';
    roundRect(ctx, x - r * 0.8, y - r * 0.7, r * 1.6, r * 1.5, r * 0.3);
    ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.fillRect(x - r * 0.55, y - r * 0.35, r * 1.1, r * 0.4);
    ctx.fillStyle = `hsl(${(t * 120) % 360},90%,60%)`;
    ctx.fillRect(x - r * 0.4, y - r * 0.25, r * 0.25, r * 0.2);
    ctx.fillRect(x + r * 0.15, y - r * 0.25, r * 0.25, r * 0.2);
  } else if (!dressed) {
    const n = Math.abs(c.id);
    ctx.fillStyle = SUITS[n % SUITS.length];
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.42, r * 0.72, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SKIN[n % SKIN.length];
    ctx.beginPath();
    ctx.arc(x, y - r * 0.22, r * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HAIR[n % HAIR.length];
    ctx.beginPath();
    ctx.arc(x, y - r * 0.38, r * 0.58, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Полоска здоровья и значок состояния.
  if (c.health < 99) {
    const barY = y - bodyHalf - ts * 0.1;
    const barW = ts * 0.55;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - barW / 2, barY, barW, Math.max(2, ts * 0.06));
    ctx.fillStyle = c.health < 35 ? '#ff5252' : '#69f0ae';
    ctx.fillRect(x - barW / 2, barY, (barW * c.health) / 100, Math.max(2, ts * 0.06));
  }
  if (c.carry && ts >= 12) {
    const icon = ts * 0.32;
    const ix = x + ts * 0.18;
    const iy = y - ts * 0.02;
    if (!drawStackArt(ctx, c.carry.resource, ix, iy, icon) && !drawPaintedItem(ctx, c.carry.resource, ix, iy, icon)) {
      drawResourceMark(ctx, c.carry.resource, ix, iy, icon);
    }
  }
  const icon =
    c.state === 'sleeping' ? 'z' : c.state === 'eating' ? '🍴' : c.state === 'cryo' ? '❄' : c.state === 'healing' ? '✚' : c.job === 'extinguish' ? '🔥' : c.job === 'haul' ? '▣' : c.job === 'pilot' ? '✈' : '';
  if (ts >= 16) {
    ctx.font = `${Math.max(9, ts * 0.28)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const name = c.name.split(' ')[0];
    const w = ctx.measureText(name).width + 6;
    const nameY = y + bodyHalf + ts * 0.02;
    ctx.fillRect(x - w / 2, nameY, w, Math.max(9, ts * 0.28) + 3);
    ctx.fillStyle = '#80d8ff';
    ctx.fillText(name, x, nameY + 1);
    if (icon) {
      ctx.fillStyle = '#fff';
      ctx.fillText(icon, x + ts * 0.4, y - bodyHalf);
    }
  }
}

/** Мировые координаты центра модуля — для лучей бура и лазеров. */
export function moduleWorld(ship: { x: number; y: number }, l: { w: number; h: number }, mx: number, my: number) {
  return { x: ship.x + (mx - l.w / 2 + 0.5) * TILE_WORLD, y: ship.y + (my - l.h / 2 + 0.5) * TILE_WORLD };
}
