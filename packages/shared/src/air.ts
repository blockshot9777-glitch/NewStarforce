// Комнаты и воздух. Комнаты — связные области пола, разделённые стенами и дверями
// (тот же принцип, что в прототипе STARFORCE.IO 2017 года). Воздух хранится как концентрация
// 0..1 на каждой клетке: так он переживает перестройку корабля без пересчёта «чьих» комнат.
import { DOOR_FLOW, DOOR_LEAK, O2_PER_TILE, VENT_LOSS } from './defs';
import { inBounds, neighbors4, type Grid } from './grid';

export interface Room {
  tiles: number[];
  /** Пол комнаты касается открытого космоса — воздух уходит. */
  vented: boolean;
}

export interface RoomMap {
  /** Индекс комнаты для каждой клетки или -1 (стены, двери, космос). */
  roomOf: Int32Array;
  rooms: Room[];
  /** Двери и комнаты, которые они соединяют. */
  doors: { tile: number; rooms: number[] }[];
}

export function computeRooms(g: Grid): RoomMap {
  const roomOf = new Int32Array(g.w * g.h).fill(-1);
  const rooms: Room[] = [];
  for (let start = 0; start < g.tiles.length; start++) {
    if (g.tiles[start] !== 'floor' || roomOf[start] !== -1) continue;
    const room: Room = { tiles: [], vented: false };
    const idx = rooms.length;
    const stack = [start];
    roomOf[start] = idx;
    while (stack.length) {
      const t = stack.pop()!;
      room.tiles.push(t);
      for (const n of neighbors4(t % g.w, Math.floor(t / g.w))) {
        if (!inBounds(g, n.x, n.y)) {
          room.vented = true;
          continue;
        }
        const ni = n.y * g.w + n.x;
        const tile = g.tiles[ni];
        if (tile === 'empty') room.vented = true;
        if (tile === 'floor' && roomOf[ni] === -1) {
          roomOf[ni] = idx;
          stack.push(ni);
        }
      }
    }
    rooms.push(room);
  }
  const doors: RoomMap['doors'] = [];
  g.tiles.forEach((tile, i) => {
    if (tile !== 'door') return;
    const adj = new Set<number>();
    for (const n of neighbors4(i % g.w, Math.floor(i / g.w))) {
      if (inBounds(g, n.x, n.y) && roomOf[n.y * g.w + n.x] >= 0) adj.add(roomOf[n.y * g.w + n.x]);
    }
    doors.push({ tile: i, rooms: [...adj] });
  });
  return { roomOf, rooms, doors };
}

export interface AirSources {
  /** Сколько единиц O₂ добавить в клетку (генераторы — «+», дыхание экипажа — «−»). */
  deltas: Map<number, number>;
  /** Двери, открытые прямо сейчас (в проёме кто-то стоит). Остальные почти герметичны. */
  openDoors: Set<number>;
}

/**
 * Один шаг воздухообмена: перемешивание внутри комнат, источники/потребители,
 * утечка в космос и перетекание через двери. Возвращает средние концентрации по комнатам.
 */
export function stepAir(g: Grid, air: number[], map: RoomMap, sources: AirSources, dt: number): number[] {
  const conc = map.rooms.map((r) => r.tiles.reduce((s, t) => s + (air[t] ?? 0), 0) / r.tiles.length);
  const cap = map.rooms.map((r) => r.tiles.length * O2_PER_TILE);
  for (const [tile, delta] of sources.deltas) {
    let room = map.roomOf[tile];
    if (room < 0) {
      // Потребитель стоит в двери — дышит воздухом первой соседней комнаты.
      room = map.doors.find((d) => d.tile === tile)?.rooms[0] ?? -1;
    }
    if (room >= 0) conc[room] += delta / cap[room];
  }
  map.rooms.forEach((r, i) => {
    if (r.vented) conc[i] *= Math.max(0, 1 - VENT_LOSS * dt);
  });
  for (const d of map.doors) {
    const k = Math.min(1, (sources.openDoors.has(d.tile) ? DOOR_FLOW : DOOR_LEAK) * dt);
    for (let a = 0; a < d.rooms.length; a++) {
      for (let b = a + 1; b < d.rooms.length; b++) {
        const ra = d.rooms[a];
        const rb = d.rooms[b];
        // Переносим количество воздуха, а не концентрацию: маленькая комната не «накачивает» большую.
        const amount = (k * (conc[ra] - conc[rb]) * Math.min(cap[ra], cap[rb])) / 2;
        conc[ra] -= amount / cap[ra];
        conc[rb] += amount / cap[rb];
      }
    }
  }
  for (let i = 0; i < conc.length; i++) conc[i] = Math.max(0, Math.min(1, conc[i]));
  air.length = g.tiles.length;
  for (let i = 0; i < g.tiles.length; i++) air[i] = 0;
  map.rooms.forEach((r, i) => {
    for (const t of r.tiles) air[t] = conc[i];
  });
  for (const d of map.doors) {
    air[d.tile] = d.rooms.length ? d.rooms.reduce((s, r) => s + conc[r], 0) / d.rooms.length : 0;
  }
  return conc;
}
