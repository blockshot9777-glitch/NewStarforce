// Состояние клиента: последние снимки сервера, кэш планировок, выбор игрока и настройки камеры.
import {
  CHAR_TILES,
  TILE_WORLD,
  computeRooms,
  type BuildKind,
  type ChatEntry,
  type Fx,
  type LayoutView,
  type LogEntry,
  type RoomMap,
  type Snapshot,
  type Tile,
} from '@starforce/shared';

export type Mode = 'ship' | 'system';
export type Tool = BuildKind | 'remove' | 'urgent' | null;

export interface ParsedLayout extends LayoutView {
  grid: { w: number; h: number; tiles: Tile[] };
  rooms: RoomMap;
}

export const store = {
  playerId: 0,
  snap: null as Snapshot | null,
  prev: null as Snapshot | null,
  snapAt: 0,
  tickMs: 100,
  layouts: new Map<number, ParsedLayout>(),
  fx: [] as { fx: Fx; born: number }[],
  log: [] as (LogEntry & { at: number })[],
  chat: [] as (ChatEntry & { at: number })[],
  toast: null as { text: string; at: number } | null,

  mode: 'ship' as Mode,
  zoom: 4,
  zoomTarget: 4,
  shipZoom: 4,
  systemZoom: 0.35,
  cam: { x: 0, y: 0 },

  tool: null as Tool,
  panel: null as 'build' | 'crew' | null,
  buildCategory: 'tiles' as string,
  selectedId: null as number | null,
  selectedCrew: null as number | null,
  expeditionCrew: new Set<number>(),
  airOverlay: false,
  galaxyOpen: false,

  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, button: 0 },
  dragStart: null as { x: number; y: number } | null,
  hoverTile: null as { x: number; y: number } | null,
};

export function parseLayout(l: LayoutView): ParsedLayout {
  const tiles = [...l.tiles].map((ch) => CHAR_TILES[ch] ?? 'empty');
  const grid = { w: l.w, h: l.h, tiles };
  return { ...l, grid, rooms: computeRooms(grid) };
}

export function applySnapshot(s: Snapshot): void {
  const now = performance.now();
  if (store.snap) store.tickMs = Math.min(250, Math.max(50, now - store.snapAt));
  store.prev = store.snap;
  store.snap = s;
  store.snapAt = now;
  for (const [id, l] of Object.entries(s.layouts)) store.layouts.set(Number(id), parseLayout(l));
  for (const fx of s.fx) store.fx.push({ fx, born: now });
  for (const e of s.log) store.log.push({ ...e, at: now });
  for (const c of s.chat) store.chat.push({ ...c, at: now });
  if (store.log.length > 60) store.log.splice(0, store.log.length - 60);
  if (store.chat.length > 60) store.chat.splice(0, store.chat.length - 60);
  // Экипаж, ушедший в экспедицию, нельзя оставлять выбранным.
  if (s.ship) {
    for (const id of store.expeditionCrew) if (!s.ship.crew.some((c) => c.id === id)) store.expeditionCrew.delete(id);
  }
}

/** Доля пути между предыдущим и текущим снимком — для плавного движения. */
export function alpha(): number {
  return Math.min(1, (performance.now() - store.snapAt) / store.tickMs);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Интерполированная позиция объекта космоса по id. */
export function interp(id: number, x: number, y: number): { x: number; y: number } {
  const prev = store.prev;
  if (!prev) return { x, y };
  let px: number | undefined;
  let py: number | undefined;
  if (prev.ship && prev.ship.id === id) {
    px = prev.ship.x;
    py = prev.ship.y;
  } else {
    const c = prev.contacts.find((o) => o.id === id);
    if (c) {
      px = c.x;
      py = c.y;
    }
  }
  if (px === undefined || py === undefined || Math.hypot(px - x, py - y) > 400) return { x, y };
  const t = alpha();
  return { x: lerp(px, x, t), y: lerp(py, y, t) };
}

export function worldToScreen(wx: number, wy: number, W: number, H: number): { x: number; y: number } {
  return { x: (wx - store.cam.x) * store.zoom + W / 2, y: (wy - store.cam.y) * store.zoom + H / 2 };
}

export function screenToWorld(sx: number, sy: number, W: number, H: number): { x: number; y: number } {
  return { x: (sx - W / 2) / store.zoom + store.cam.x, y: (sy - H / 2) / store.zoom + store.cam.y };
}

/** Клетка своего корабля под точкой мира. */
export function worldToTile(ship: { x: number; y: number }, l: { w: number; h: number }, wx: number, wy: number) {
  return { x: Math.floor((wx - ship.x) / TILE_WORLD + l.w / 2), y: Math.floor((wy - ship.y) / TILE_WORLD + l.h / 2) };
}

export function toast(text: string): void {
  store.toast = { text, at: performance.now() };
}
