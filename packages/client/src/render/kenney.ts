// Интерьер корабля — лист Buch «Sci-fi Interior» (CC0), 32×32 без полей.
// Экипаж — скафандры из Kenney Sci-fi RTS (CC0). Если лист не загрузился, клетка рисуется по-старому.
import type { ModuleType, Physical } from '@starforce/shared';

type SheetName = 'tiles' | 'chars';

const SPEC: Record<SheetName, { stride: number; tile: number; url: string }> = {
  tiles: { stride: 32, tile: 32, url: 'sprites/kenney/interior.png' },
  chars: { stride: 48, tile: 48, url: 'sprites/kenney/crew.png' },
};

const sheets: Record<SheetName, HTMLImageElement | null> = { tiles: null, chars: null };

/** Пиксельные листы выключены, пока в адресе нет ?kenney=1. */
export function kenneyEnabled(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('kenney') === '1';
  } catch {
    return false;
  }
}

function load(name: SheetName): void {
  const img = new Image();
  img.onload = () => {
    sheets[name] = img;
  };
  img.src = SPEC[name].url;
}

export function loadKenney(): void {
  load('tiles');
  load('chars');
}

export function drawCell(
  ctx: CanvasRenderingContext2D,
  sheet: SheetName,
  col: number,
  row: number,
  x: number,
  y: number,
  size: number,
): boolean {
  if (!kenneyEnabled()) return false;
  const img = sheets[sheet];
  const spec = SPEC[sheet];
  if (!img || !img.complete || img.naturalWidth === 0) return false;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, col * spec.stride, row * spec.stride, spec.tile, spec.tile, x, y, size, size);
  ctx.imageSmoothingEnabled = prev;
  return true;
}

/** Светлые плиты палубы. Клетка выбирается по координате, чтобы пол не был одним штампом. */
const FLOORS: readonly (readonly [number, number])[] = [
  [6, 1],
  [7, 2],
  [8, 4],
  [9, 5],
  [10, 2],
  [11, 5],
];

export function floorCell(x: number, y: number): readonly [number, number] {
  return FLOORS[Math.abs((x * 17 + y * 31) | 0) % FLOORS.length];
}

/** Переборка: сине-оранжевая полоса, не камень. */
export const WALL_CELL: readonly [number, number] = [4, 0];
/** Люк в палубе. */
export const DOOR_CELL: readonly [number, number] = [2, 5];

const MODULE_ART: Record<ModuleType, { c: number; r: number }> = {
  bridge: { c: 0, r: 3 },
  reactor: { c: 4, r: 3 },
  battery: { c: 1, r: 3 },
  engine: { c: 2, r: 4 },
  o2gen: { c: 1, r: 3 },
  water_recycler: { c: 6, r: 4 },
  hydroponics: { c: 0, r: 3 },
  bed: { c: 1, r: 4 },
  medbay: { c: 1, r: 4 },
  shield_gen: { c: 3, r: 0 },
  laser: { c: 2, r: 0 },
  missile: { c: 2, r: 4 },
  radar: { c: 3, r: 0 },
  mining_laser: { c: 0, r: 3 },
  lamp: { c: 2, r: 5 },
  solar_panel: { c: 5, r: 0 },
  cryopod: { c: 2, r: 0 },
  vent: { c: 6, r: 4 },
  heater: { c: 4, r: 3 },
  cooler: { c: 6, r: 4 },
};

export function drawModuleArt(ctx: CanvasRenderingContext2D, type: ModuleType, x: number, y: number, size: number): boolean {
  const a = MODULE_ART[type];
  return drawCell(ctx, 'tiles', a.c, a.r, x, y, size);
}

/** Груз — ящик. Цвет ресурса дорисовывает вызывающий код. */
export function drawStackArt(ctx: CanvasRenderingContext2D, _resource: Physical, x: number, y: number, size: number): boolean {
  return drawCell(ctx, 'tiles', 2, 4, x, y, size);
}

/** Скафандр. Робот берёт серый шлем из конца ленты. */
export function drawPawn(ctx: CanvasRenderingContext2D, id: number, robot: boolean, x: number, y: number, size: number): boolean {
  const col = robot ? 6 + (Math.abs(id) % 2) : Math.abs(id) % 6;
  return drawCell(ctx, 'chars', col, 0, x - size / 2, y - size / 2, size);
}
