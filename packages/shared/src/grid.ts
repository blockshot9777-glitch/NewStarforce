import type { Tile } from './defs';
import type { Vec } from './state';

export interface Grid {
  w: number;
  h: number;
  tiles: Tile[];
}

export function inBounds(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

export function tileAt(g: Grid, x: number, y: number): Tile {
  return inBounds(g, x, y) ? g.tiles[y * g.w + x] : 'empty';
}

export function isWalkable(t: Tile): boolean {
  return t === 'floor' || t === 'door';
}

const DIRS: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function neighbors4(x: number, y: number): Vec[] {
  return DIRS.map((d) => ({ x: x + d.x, y: y + d.y }));
}

/**
 * A* по 4 направлениям. Возвращает путь без стартовой клетки (пустой, если уже на месте)
 * или null, если цель недостижима. Стартовая клетка может быть непроходимой — так член
 * экипажа, оказавшийся в только что построенной стене, всё равно сможет выйти.
 */
export function findPath(g: Grid, from: Vec, to: Vec): Vec[] | null {
  if (!inBounds(g, to.x, to.y) || !isWalkable(tileAt(g, to.x, to.y))) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const size = g.w * g.h;
  const start = from.y * g.w + from.x;
  const goal = to.y * g.w + to.x;
  const gScore = new Float64Array(size).fill(Infinity);
  const came = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  gScore[start] = 0;
  // Сетки кораблей маленькие (до 32x17), поэтому простая бинарная куча не нужна —
  // хватает линейного поиска минимума по открытому списку.
  const open: number[] = [start];
  const h = (i: number) => Math.abs((i % g.w) - to.x) + Math.abs(Math.floor(i / g.w) - to.y);
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (gScore[open[i]] + h(open[i]) < gScore[open[best]] + h(open[best])) best = i;
    }
    const cur = open[best];
    open[best] = open[open.length - 1];
    open.pop();
    if (cur === goal) {
      const path: Vec[] = [];
      for (let n = goal; n !== start; n = came[n]) path.push({ x: n % g.w, y: Math.floor(n / g.w) });
      return path.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % g.w;
    const cy = Math.floor(cur / g.w);
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!inBounds(g, nx, ny) || !isWalkable(g.tiles[ny * g.w + nx])) continue;
      const ni = ny * g.w + nx;
      if (closed[ni]) continue;
      const tentative = gScore[cur] + 1;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  return null;
}
