// Температура по комнатам. Тот же каркас, что у воздуха: среднее по отсеку,
// утечка в космос, перетекание через двери и решётки.
import {
  DOOR_FLOW,
  DOOR_LEAK,
  TEMP_AMBIENT,
  TEMP_HULL_LEAK,
  TEMP_MAX,
  TEMP_MIN,
  TEMP_SPACE,
  TEMP_VENT_LEAK,
  VENT_FLOW,
} from './defs';
import type { RoomMap } from './air';
import { inBounds, type Grid } from './grid';
import type { Ship } from './state';

export interface TempSources {
  /** °C/с на всю комнату: обогреватель положительный, охладитель отрицательный. */
  roomDelta: Map<number, number>;
  openDoors: Set<number>;
  vents?: [number, number][];
}

/** Старым сохранениям без поля temp — комфортные 21 °C на каждой клетке. */
export function normalizeTemp(ship: Ship): void {
  const n = ship.w * ship.h;
  if (!ship.temp || ship.temp.length !== n) ship.temp = new Array(n).fill(TEMP_AMBIENT);
}

export function tempAt(ship: Ship, x: number, y: number): number {
  const rx = Math.round(x);
  const ry = Math.round(y);
  if (!inBounds(ship, rx, ry) || !ship.temp) return TEMP_SPACE;
  return ship.temp[ry * ship.w + rx] ?? TEMP_AMBIENT;
}

/**
 * Один шаг теплообмена. Возвращает среднюю температуру по комнатам.
 * Герметичный отсек тянется к 21 °C, пробоина — к холоду космоса.
 */
export function stepTemp(g: Grid, temp: number[], map: RoomMap, sources: TempSources, dt: number): number[] {
  const n = map.rooms.map((r) => Math.max(1, r.tiles.length));
  const t = map.rooms.map((r) => {
    if (!r.tiles.length) return TEMP_AMBIENT;
    return r.tiles.reduce((s, tile) => s + (temp[tile] ?? TEMP_AMBIENT), 0) / r.tiles.length;
  });
  map.rooms.forEach((r, i) => {
    const outside = r.vented ? TEMP_SPACE : TEMP_AMBIENT;
    const leak = r.vented ? TEMP_VENT_LEAK : TEMP_HULL_LEAK;
    t[i] += (outside - t[i]) * Math.min(1, leak * dt);
    t[i] += ((sources.roomDelta.get(i) ?? 0) * dt) / n[i];
  });
  for (const d of map.doors) {
    const k = Math.min(1, (sources.openDoors.has(d.tile) ? DOOR_FLOW : DOOR_LEAK) * dt);
    for (let a = 0; a < d.rooms.length; a++) {
      for (let b = a + 1; b < d.rooms.length; b++) {
        const ra = d.rooms[a];
        const rb = d.rooms[b];
        const amount = (k * (t[ra] - t[rb]) * Math.min(n[ra], n[rb])) / 2;
        t[ra] -= amount / n[ra];
        t[rb] += amount / n[rb];
      }
    }
  }
  for (const [ra, rb] of sources.vents ?? []) {
    if (ra === rb || n[ra] === undefined || n[rb] === undefined) continue;
    const k = Math.min(1, VENT_FLOW * dt);
    const amount = (k * (t[ra] - t[rb]) * Math.min(n[ra], n[rb])) / 2;
    t[ra] -= amount / n[ra];
    t[rb] += amount / n[rb];
  }
  for (let i = 0; i < t.length; i++) t[i] = Math.max(TEMP_MIN, Math.min(TEMP_MAX, t[i]));
  temp.length = g.tiles.length;
  for (let i = 0; i < g.tiles.length; i++) temp[i] = TEMP_AMBIENT;
  map.rooms.forEach((r, i) => {
    for (const tile of r.tiles) temp[tile] = t[i];
  });
  for (const d of map.doors) {
    temp[d.tile] = d.rooms.length ? d.rooms.reduce((s, r) => s + t[r], 0) / d.rooms.length : TEMP_SPACE;
  }
  return t;
}
