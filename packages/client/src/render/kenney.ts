// Спрайты Kenney (CC0): листы 16×16 с полем 1 пиксель. Если лист ещё не загрузился — рисуем по-старому.
import type { ModuleType, Physical } from '@starforce/shared';

const STRIDE = 17;
const TILE = 16;

type SheetName = 'tiles' | 'chars' | 'indoor';

const sheets: Record<SheetName, HTMLImageElement | null> = { tiles: null, chars: null, indoor: null };

function load(name: SheetName, url: string): void {
  const img = new Image();
  img.onload = () => {
    sheets[name] = img;
  };
  img.src = url;
}

export function loadKenney(): void {
  load('tiles', 'sprites/kenney/tiles.png');
  load('chars', 'sprites/kenney/chars.png');
  load('indoor', 'sprites/kenney/indoor.png');
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
  const img = sheets[sheet];
  if (!img || !img.complete || img.naturalWidth === 0) return false;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, col * STRIDE, row * STRIDE, TILE, TILE, x, y, size, size);
  ctx.imageSmoothingEnabled = prev;
  return true;
}

/** Каменные полы — палуба. Клетка выбирается по координате, чтобы палуба не была одним штампом. */
const FLOORS: readonly (readonly [number, number])[] = [
  [7, 0],
  [8, 0],
  [9, 0],
  [7, 1],
  [8, 1],
];

export function floorCell(x: number, y: number): readonly [number, number] {
  return FLOORS[Math.abs((x * 17 + y * 31) | 0) % FLOORS.length];
}

export const WALL_CELL: readonly [number, number] = [7, 2];
export const DOOR_CELL: readonly [number, number] = [32, 2];

const MODULE_ART: Record<ModuleType, { sheet: SheetName; c: number; r: number }> = {
  bridge: { sheet: 'indoor', c: 4, r: 5 },
  reactor: { sheet: 'tiles', c: 14, r: 0 },
  battery: { sheet: 'tiles', c: 29, r: 2 },
  engine: { sheet: 'tiles', c: 31, r: 0 },
  o2gen: { sheet: 'tiles', c: 23, r: 0 },
  water_recycler: { sheet: 'tiles', c: 18, r: 1 },
  hydroponics: { sheet: 'tiles', c: 13, r: 10 },
  bed: { sheet: 'tiles', c: 14, r: 1 },
  medbay: { sheet: 'tiles', c: 13, r: 2 },
  shield_gen: { sheet: 'tiles', c: 45, r: 1 },
  laser: { sheet: 'tiles', c: 46, r: 1 },
  missile: { sheet: 'tiles', c: 20, r: 2 },
  radar: { sheet: 'tiles', c: 44, r: 1 },
  mining_laser: { sheet: 'tiles', c: 15, r: 0 },
  lamp: { sheet: 'tiles', c: 16, r: 8 },
  solar_panel: { sheet: 'tiles', c: 10, r: 8 },
  cryopod: { sheet: 'tiles', c: 33, r: 2 },
  vent: { sheet: 'tiles', c: 33, r: 3 },
};

export function drawModuleArt(ctx: CanvasRenderingContext2D, type: ModuleType, x: number, y: number, size: number): boolean {
  const a = MODULE_ART[type];
  return drawCell(ctx, a.sheet, a.c, a.r, x, y, size);
}

const STACK_ART: Record<Physical, readonly [number, number]> = {
  metal: [22, 0],
  ice: [11, 9],
  water: [24, 0],
  crystals: [45, 1],
  biomass: [19, 10],
  food: [25, 0],
};

export function drawStackArt(ctx: CanvasRenderingContext2D, resource: Physical, x: number, y: number, size: number): boolean {
  const [c, r] = STACK_ART[resource];
  return drawCell(ctx, 'tiles', c, r, x, y, size);
}

/** Тело, одежда и волосы (или шлем у робота) с одного листа персонажей. */
export function drawPawn(ctx: CanvasRenderingContext2D, id: number, robot: boolean, x: number, y: number, size: number): boolean {
  if (!sheets.chars?.complete || sheets.chars.naturalWidth === 0) return false;
  const bodyCol = Math.abs(id) % 3;
  const bodyRow = robot ? 0 : Math.abs(id) % 3;
  const layers: readonly (readonly [number, number])[] = robot
    ? [
        [bodyCol, bodyRow],
        [6 + (Math.abs(id) % 10), 0],
        [28 + (Math.abs(id) % 4), 0],
      ]
    : [
        [bodyCol, bodyRow],
        [6 + (Math.abs(id) % 10), Math.abs(id) % 3],
        [20 + (Math.abs(id) % 8), Math.abs(id) % 5],
      ];
  const dx = x - size / 2;
  const dy = y - size / 2;
  for (const [c, r] of layers) drawCell(ctx, 'chars', c, r, dx, dy, size);
  return true;
}
