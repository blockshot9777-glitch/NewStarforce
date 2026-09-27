// Рисованные тайлы проекта (public/tiles, public/sprites). Kenney сюда не входит.
import type { Physical } from '@starforce/shared';

const images = new Map<string, HTMLImageElement>();

function load(key: string, url: string): void {
  const img = new Image();
  img.onload = () => images.set(key, img);
  img.src = url;
}

export function loadPainted(): void {
  load('floor', 'tiles/floor.png');
  load('floor_corridor', 'tiles/floor_corridor.png');
  load('floor_stockpile', 'tiles/floor_stockpile.png');
  load('wall', 'tiles/wall.png');
  load('door', 'tiles/door.png');
  for (let i = 0; i < 3; i++) load(`pawn${i}`, `sprites/pawns/${i}.png`);
  load('robot', 'sprites/pawns/robot.png');
  for (const name of ['metal', 'ice', 'water', 'crystals', 'biomass', 'food']) {
    load(`item:${name}`, `sprites/items/${name}.png`);
  }
}

function ready(key: string): HTMLImageElement | undefined {
  const img = images.get(key);
  if (!img || !img.complete || img.naturalWidth === 0) return undefined;
  return img;
}

/** Клетка пола, стены или двери. variant крутит плиту, чтобы пол не был одним штампом. */
export function drawPaintedTile(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  size: number,
  variant = 0,
): boolean {
  const img = ready(key);
  if (!img) return false;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  if (variant & 1) ctx.scale(-1, 1);
  if (variant & 2) ctx.scale(1, -1);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
  ctx.imageSmoothingEnabled = prev;
  return true;
}

/** Пешка: крупная голова и туловище, без ног. Робот — отдельный спрайт. */
export function drawPaintedPawn(
  ctx: CanvasRenderingContext2D,
  id: number,
  robot: boolean,
  x: number,
  y: number,
  size: number,
): boolean {
  const img = ready(robot ? 'robot' : `pawn${Math.abs(id) % 3}`);
  if (!img) return false;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.imageSmoothingEnabled = prev;
  return true;
}

/** Иконка ресурса на стопке. Число дописывает вызывающий код. */
export function drawPaintedItem(
  ctx: CanvasRenderingContext2D,
  resource: Physical,
  x: number,
  y: number,
  size: number,
): boolean {
  const img = ready(`item:${resource}`);
  if (!img) return false;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x, y, size, size);
  ctx.imageSmoothingEnabled = prev;
  return true;
}
