// Внутренняя жизнь корабля: энергосеть, жизнеобеспечение, строительство и ИИ экипажа.
import {
  BATTERY_CAPACITY,
  BASE_SENSOR_RANGE,
  CHAR_TILES,
  CREW_FIRST_NAMES,
  CREW_LAST_NAMES,
  HULLS,
  HYDRO_GROW_SECONDS,
  HYDRO_WATER,
  MODULES,
  O2_GEN_RATE,
  O2_GEN_WATER,
  O2_PER_CREW,
  O2_PER_TILE,
  RADAR_BONUS,
  SHIELD_PER_GEN,
  FIRE_GROWTH,
  FIRE_MIN_AIR,
  FIRE_O2_USE,
  FIRE_SPREAD,
  SHIELD_REGEN_PER_GEN,
  STARTER_CREW,
  STARTER_GLYPHS,
  PHYSICAL,
  STARTER_LAYOUT,
  STARTER_RESOURCES,
  WATER_RECYCLE_RATE,
  buildCost,
  buildWork,
  isModuleType,
  moduleSize,
  type BuildKind,
  type HullClass,
  type ModuleType,
  type Resources,
  type Tile,
} from './defs';
import { computeRooms, stepAir, type RoomMap } from './air';
import { inBounds, isWalkable, neighbors4, tileAt } from './grid';
import { dropCarry, dropLoose, isPhysical, putInStockpile, refundDelivered, removeStored } from './items';
import type { Rng } from './rng';
import { defaultPriorities, type Crew, type LogEntry, type Ship, type ShipModule, type Vec } from './state';

export interface ShipContext {
  rng: Rng;
  nextId: () => number;
  log: (text: string, level?: LogEntry['level']) => void;
  /** Нужен ли пилот прямо сейчас (есть приказ на движение или бой). */
  wantsPilot: boolean;
  /** Бур и двигатели сообщают, работают ли они в этом тике. */
  miningActive: boolean;
  moving: boolean;
  /** Множитель солнечных панелей (зависит от расстояния до звезды). */
  solar: number;
}

// ---------- Создание ----------

export function randomCrew(rng: Rng, id: number, x: number, y: number): Crew {
  const skill = () => rng.int(2, 9);
  return {
    id,
    name: `${rng.pick(CREW_FIRST_NAMES)} ${rng.pick(CREW_LAST_NAMES)}`,
    robot: false,
    x,
    y,
    path: [],
    health: 100,
    food: rng.range(70, 100),
    rest: rng.range(70, 100),
    skills: { engineering: skill(), botany: skill(), piloting: skill(), combat: skill() },
    priorities: defaultPriorities(),
    state: 'idle',
    job: null,
    carry: null,
    draft: false,
    order: null,
    timer: 0,
  };
}

export function makeRobot(rng: Rng, id: number, x: number, y: number): Crew {
  const c = randomCrew(rng, id, x, y);
  c.name = `Робот ${['РБ', 'ТК', 'СР', 'МК'][rng.int(0, 3)]}-${rng.int(100, 999)}`;
  c.robot = true;
  c.food = 100;
  c.rest = 100;
  c.skills = { engineering: 6, botany: 4, piloting: 3, combat: 2 };
  return c;
}

export function makeModule(id: number, type: ModuleType, x: number, y: number): ShipModule {
  return { id, type, x, y, hp: MODULES[type].maxHp, enabled: true, powered: false, active: false, cooldown: 0, growth: 0 };
}

export function createStarterShip(opts: {
  id: number;
  ownerId: number;
  systemId: number;
  name: string;
  x: number;
  y: number;
  rng: Rng;
  nextId: () => number;
}): Ship {
  const hull = HULLS.scout;
  const tiles: Tile[] = new Array(hull.w * hull.h).fill('empty');
  const ox = Math.floor((hull.w - STARTER_LAYOUT[0].length) / 2);
  const oy = Math.floor((hull.h - STARTER_LAYOUT.length) / 2);
  const modules: ShipModule[] = [];
  STARTER_LAYOUT.forEach((row, ry) => {
    [...row].forEach((ch, rx) => {
      const x = ox + rx;
      const y = oy + ry;
      const tile = CHAR_TILES[ch];
      if (tile) {
        tiles[y * hull.w + x] = tile;
      } else {
        tiles[y * hull.w + x] = 'floor';
        modules.push(makeModule(opts.nextId(), STARTER_GLYPHS[ch], x, y));
      }
    });
  });
  const ship: Ship = {
    id: opts.id,
    ownerId: opts.ownerId,
    systemId: opts.systemId,
    name: opts.name,
    hull: 'scout',
    x: opts.x,
    y: opts.y,
    vx: 0,
    vy: 0,
    heading: 0,
    moveTarget: null,
    targetId: null,
    hp: hull.maxHp,
    shield: 0,
    w: hull.w,
    h: hull.h,
    tiles,
    layoutVersion: 1,
    modules,
    blueprints: [],
    stacks: [],
    stockpile: [],
    crew: [],
    fires: {},
    urgent: [],
    mineResource: null,
    mineProgress: 0,
    res: { ...STARTER_RESOURCES },
    air: tiles.map((t) => (t === 'floor' || t === 'door' ? 1 : 0)),
    oxygen: 0,
    battery: BATTERY_CAPACITY / 2,
    stats: {
      powerOutput: 0,
      powerDemand: 0,
      batteryCap: 0,
      oxygenCap: 0,
      maxShield: 0,
      maxSpeed: 0,
      sensorRange: BASE_SENSOR_RANGE,
      piloted: false,
    },
    lastCombatTick: -1000,
    jump: null,
  };
  const spots = walkableTiles(ship).filter((p) => !moduleAt(ship, p.x, p.y));
  for (let i = 0; i < STARTER_CREW; i++) {
    const p = spots[(i * 7) % spots.length];
    ship.crew.push(randomCrew(opts.rng, opts.nextId(), p.x, p.y));
  }
  recomputeStats(ship);
  ship.oxygen = ship.stats.oxygenCap;
  ship.shield = ship.stats.maxShield;
  for (let y = 0; y < ship.h && ship.stockpile.length < 8; y++) {
    for (let x = 0; x < ship.w && ship.stockpile.length < 8; x++) {
      const tile = ship.tiles[y * ship.w + x];
      if (tile !== 'floor' && tile !== 'door') continue;
      if (ship.modules.some((m) => m.x === x && m.y === y)) continue;
      ship.stockpile.push(y * ship.w + x);
    }
  }
  for (const r of PHYSICAL) {
    if (STARTER_RESOURCES[r] > 0) putInStockpile(ship, r, STARTER_RESOURCES[r], opts.nextId);
  }
  return ship;
}

/**
 * Переносит корабль в более крупный корпус: вся постройка игрока копируется в центр новой сетки,
 * экипаж и ресурсы сохраняются.
 */
export function upgradeHull(ship: Ship, next: HullClass, nextId: () => number): void {
  const hull = HULLS[next];
  const oldW = ship.w;
  const ox = Math.floor((hull.w - ship.w) / 2);
  const oy = Math.floor((hull.h - ship.h) / 2);
  const tiles: Tile[] = new Array(hull.w * hull.h).fill('empty');
  const air: number[] = new Array(hull.w * hull.h).fill(0);
  for (let y = 0; y < ship.h; y++) {
    for (let x = 0; x < ship.w; x++) {
      tiles[(y + oy) * hull.w + x + ox] = ship.tiles[y * ship.w + x];
      air[(y + oy) * hull.w + x + ox] = ship.air[y * ship.w + x] ?? 0;
    }
  }
  ship.air = air;
  const fires: Record<number, number> = {};
  for (const [tile, v] of Object.entries(ship.fires)) {
    const t = Number(tile);
    fires[(Math.floor(t / ship.w) + oy) * hull.w + (t % ship.w) + ox] = v;
  }
  ship.fires = fires;
  for (const m of ship.modules) {
    m.x += ox;
    m.y += oy;
  }
  for (const b of ship.blueprints) {
    b.x += ox;
    b.y += oy;
  }
  for (const c of ship.crew) dropCarry(ship, c, nextId);
  for (const s of ship.stacks) {
    s.x += ox;
    s.y += oy;
  }
  ship.stockpile = ship.stockpile.map((t) => {
    const x = (t % oldW) + ox;
    const y = Math.floor(t / oldW) + oy;
    return y * hull.w + x;
  });
  for (const c of ship.crew) {
    c.x += ox;
    c.y += oy;
    c.path = [];
    c.job = null;
    if (c.state === 'working') c.state = 'idle';
  }
  ship.tiles = tiles;
  ship.w = hull.w;
  ship.h = hull.h;
  ship.hull = next;
  ship.hp = hull.maxHp;
  ship.layoutVersion++;
  recomputeStats(ship);
}

// ---------- Запросы ----------

const roomCache = new WeakMap<Ship, { version: number; map: RoomMap }>();

/** Комнаты корабля; пересчитываются только при изменении планировки. */
export function shipRooms(ship: Ship): RoomMap {
  const cached = roomCache.get(ship);
  if (cached && cached.version === ship.layoutVersion) return cached.map;
  const map = computeRooms(ship);
  roomCache.set(ship, { version: ship.layoutVersion, map });
  return map;
}

export function airAt(ship: Ship, x: number, y: number): number {
  const rx = Math.round(x);
  const ry = Math.round(y);
  return inBounds(ship, rx, ry) ? ship.air[ry * ship.w + rx] ?? 0 : 0;
}

/** Стена, которая граничит с открытым космосом (или краем корпуса). */
export function isOuterWall(ship: Ship, x: number, y: number): boolean {
  if (tileAt(ship, x, y) !== 'wall') return false;
  return neighbors4(x, y).some((n) => !inBounds(ship, n.x, n.y) || tileAt(ship, n.x, n.y) === 'empty');
}

/** Клетка освещена, если рядом есть запитанный светящийся модуль в той же комнате или дверном проёме. */
export function isLit(ship: Ship, x: number, y: number): boolean {
  return ship.modules.some((m) => {
    const light = MODULES[m.type].light;
    if (!light || !m.powered || !functional(m)) return false;
    const [w, h] = moduleSize(m.type);
    const cx = m.x + (w - 1) / 2;
    const cy = m.y + (h - 1) / 2;
    return Math.hypot(cx - x, cy - y) <= light;
  });
}

export function moduleAt(ship: Ship, x: number, y: number): ShipModule | undefined {
  return ship.modules.find((m) => {
    const [w, h] = moduleSize(m.type);
    return x >= m.x && y >= m.y && x < m.x + w && y < m.y + h;
  });
}

export function blueprintAt(ship: Ship, x: number, y: number) {
  return ship.blueprints.find((b) => {
    if (b.remove || !isModuleType(b.kind)) return b.x === x && b.y === y;
    const [w, h] = moduleSize(b.kind);
    return x >= b.x && y >= b.y && x < b.x + w && y < b.y + h;
  });
}

function footprint(kind: BuildKind, x: number, y: number): Vec[] {
  if (!isModuleType(kind)) return [{ x, y }];
  const [w, h] = moduleSize(kind);
  const cells: Vec[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy });
  return cells;
}

export function walkableTiles(ship: Ship): Vec[] {
  const out: Vec[] = [];
  for (let y = 0; y < ship.h; y++) {
    for (let x = 0; x < ship.w; x++) if (isWalkable(ship.tiles[y * ship.w + x])) out.push({ x, y });
  }
  return out;
}

export function functional(m: ShipModule): boolean {
  return m.hp > 0 && m.enabled;
}

export function hasResources(res: Resources, cost: Partial<Resources>, mult = 1): boolean {
  return Object.entries(cost).every(([k, v]) => res[k as keyof Resources] >= (v ?? 0) * mult - 1e-9);
}

export function spend(res: Resources, cost: Partial<Resources>, mult = 1): void {
  for (const [k, v] of Object.entries(cost)) res[k as keyof Resources] -= (v ?? 0) * mult;
}

export function gain(res: Resources, loot: Partial<Resources>, mult = 1): void {
  for (const [k, v] of Object.entries(loot)) res[k as keyof Resources] += (v ?? 0) * mult;
}

export function recomputeStats(ship: Ship): void {
  const hull = HULLS[ship.hull];
  let batteries = 0;
  let shieldGens = 0;
  let floor = 0;
  for (const t of ship.tiles) if (t === 'floor' || t === 'door') floor++;
  for (const m of ship.modules) {
    if (m.hp <= 0) continue;
    if (m.type === 'battery') batteries++;
    if (m.type === 'shield_gen' && m.enabled) shieldGens++;
  }
  ship.stats.batteryCap = batteries * BATTERY_CAPACITY;
  ship.stats.maxShield = shieldGens * SHIELD_PER_GEN;
  ship.stats.oxygenCap = floor * O2_PER_TILE;
  // Как в оригинале: по системе корабль ходит на маневровых (половина скорости), двигатели разгоняют
  // и нужны для гиперпрыжка.
  const engines = ship.modules.filter((m) => m.type === 'engine' && functional(m) && m.powered).length;
  ship.stats.maxSpeed = hull.baseSpeed * (engines > 0 ? 1 + 0.25 * (engines - 1) : 0.5);
  const radar = ship.modules.some((m) => m.type === 'radar' && functional(m) && m.powered);
  ship.stats.sensorRange = BASE_SENSOR_RANGE + (radar ? RADAR_BONUS : 0);
}

// ---------- Энергия и системы ----------

function moduleDemand(m: ShipModule, ctx: ShipContext): number {
  const def = MODULES[m.type];
  if (m.type === 'engine') return ctx.moving ? def.demand : def.idleDemand ?? 0;
  if (m.type === 'mining_laser') return ctx.miningActive ? def.demand : def.idleDemand ?? 0;
  return def.demand;
}

/** Раздаёт энергию по приоритетам: остаток заряжает аккумуляторы, при нехватке добирается из них. */
export function distributePower(ship: Ship, dt: number, ctx: ShipContext): void {
  let output = 0;
  for (const m of ship.modules) {
    const def = MODULES[m.type];
    if (def.output && functional(m)) {
      output += m.type === 'solar_panel' ? def.output * ctx.solar : def.output;
      m.powered = true;
    }
  }
  const consumers = ship.modules
    .filter((m) => !MODULES[m.type].output)
    .sort((a, b) => MODULES[a.type].priority - MODULES[b.type].priority);
  let pool = output * dt + ship.battery;
  let demandTotal = 0;
  for (const m of consumers) {
    if (!functional(m)) {
      m.powered = false;
      continue;
    }
    const need = moduleDemand(m, ctx) * dt;
    demandTotal += moduleDemand(m, ctx);
    if (pool + 1e-9 >= need) {
      pool -= need;
      m.powered = true;
    } else {
      m.powered = false;
    }
  }
  for (const m of ship.modules) if (MODULES[m.type].output && !functional(m)) m.powered = false;
  recomputeStats(ship);
  ship.battery = Math.min(ship.stats.batteryCap, Math.max(0, pool));
  ship.stats.powerOutput = output;
  ship.stats.powerDemand = demandTotal;
}

export function lifeSupport(ship: Ship, dt: number, nextId: () => number): void {
  const deltas = new Map<number, number>();
  for (const m of ship.modules) {
    if (!m.powered || !functional(m)) continue;
    switch (m.type) {
      case 'o2gen': {
        const water = O2_GEN_WATER * dt;
        const tile = m.y * ship.w + m.x;
        if (ship.res.water + 1e-9 >= water && (ship.air[tile] ?? 0) < 1) {
          removeStored(ship, 'water', water);
          deltas.set(tile, (deltas.get(tile) ?? 0) + O2_GEN_RATE * dt);
        }
        break;
      }
      case 'water_recycler': {
        const amount = Math.min(ship.res.ice, WATER_RECYCLE_RATE * dt);
        const got = amount > 1e-9 ? removeStored(ship, 'ice', amount) : 0;
        if (got > 1e-9) putInStockpile(ship, 'water', got, nextId);
        break;
      }
      case 'hydroponics': {
        const water = HYDRO_WATER * dt;
        if (m.growth < 1 && ship.res.water + 1e-9 >= water) {
          removeStored(ship, 'water', water);
          m.growth = Math.min(1, m.growth + dt / HYDRO_GROW_SECONDS);
        }
        break;
      }
      default:
        break;
    }
  }
  // Щиты: восстанавливаются от запитанных генераторов, без питания быстро гаснут.
  const poweredShields = ship.modules.filter((m) => m.type === 'shield_gen' && functional(m) && m.powered).length;
  if (poweredShields > 0) ship.shield = Math.min(ship.stats.maxShield, ship.shield + poweredShields * SHIELD_REGEN_PER_GEN * dt);
  else ship.shield = Math.max(0, ship.shield - 20 * dt);
  ship.shield = Math.min(ship.shield, ship.stats.maxShield);
  // Дыхание экипажа — из той клетки, где стоит человек.
  for (const c of ship.crew) {
    if (c.robot || c.state === 'cryo') continue;
    const rx = Math.round(c.x);
    const ry = Math.round(c.y);
    if (!inBounds(ship, rx, ry)) continue;
    const tile = ry * ship.w + rx;
    deltas.set(tile, (deltas.get(tile) ?? 0) - O2_PER_CREW * dt);
  }
  const rooms = shipRooms(ship);
  const vents: [number, number][] = [];
  for (const m of ship.modules) {
    if (m.type !== 'vent' || !functional(m)) continue;
    const ids = new Set<number>();
    for (const n of neighbors4(m.x, m.y)) {
      if (!inBounds(ship, n.x, n.y)) continue;
      const room = rooms.roomOf[n.y * ship.w + n.x];
      if (room >= 0) ids.add(room);
    }
    const pair = [...ids];
    if (pair.length >= 2) vents.push([pair[0], pair[1]]);
  }
  const openDoors = new Set<number>();
  for (const c of ship.crew) {
    const t = Math.round(c.y) * ship.w + Math.round(c.x);
    if (ship.tiles[t] === 'door') openDoors.add(t);
  }
  const conc = stepAir(ship, ship.air, rooms, { deltas, openDoors, vents }, dt);
  ship.oxygen = rooms.rooms.reduce((sum, r, i) => sum + conc[i] * r.tiles.length * O2_PER_TILE, 0);
}

/** Поджигает клетку пола (метеорит, взрыв модуля). */
export function igniteTile(ship: Ship, x: number, y: number, intensity = 0.4): boolean {
  if (!isWalkable(tileAt(ship, x, y))) return false;
  const t = y * ship.w + x;
  ship.fires[t] = Math.max(ship.fires[t] ?? 0, intensity);
  return true;
}

/**
 * Пожары: растут, пока есть воздух, выжигают кислород, повреждают модули и людей,
 * перекидываются на соседние клетки. Без воздуха гаснут сами.
 */
export function updateFires(ship: Ship, dt: number, rng: Rng): void {
  for (const [key, value] of Object.entries(ship.fires)) {
    const t = Number(key);
    const x = t % ship.w;
    const y = Math.floor(t / ship.w);
    if (!isWalkable(ship.tiles[t])) {
      delete ship.fires[t];
      continue;
    }
    const air = ship.air[t] ?? 0;
    let v = value;
    if (air < FIRE_MIN_AIR) v -= 0.5 * dt;
    else {
      v = Math.min(1, v + FIRE_GROWTH * dt);
      ship.air[t] = Math.max(0, air - FIRE_O2_USE * v * dt);
    }
    if (v <= 0) {
      delete ship.fires[t];
      continue;
    }
    ship.fires[t] = v;
    const m = moduleAt(ship, x, y);
    if (m) m.hp = Math.max(0, m.hp - 3 * v * dt);
    for (const c of ship.crew) {
      if (c.state !== 'cryo' && Math.round(c.x) === x && Math.round(c.y) === y) c.health -= 6 * v * dt;
    }
    for (const n of neighbors4(x, y)) {
      const nt = n.y * ship.w + n.x;
      if (!inBounds(ship, n.x, n.y) || !isWalkable(ship.tiles[nt]) || ship.fires[nt] !== undefined) continue;
      if ((ship.air[nt] ?? 0) > FIRE_MIN_AIR + 0.05 && rng.chance(FIRE_SPREAD * v * dt)) ship.fires[nt] = 0.2;
    }
  }
}

/**
 * Пробоина: случайная внешняя стена превращается в дыру (пол у космоса), комната начинает терять воздух.
 * Экипажу автоматически выдаётся бесплатный чертёж заделки.
 */
export function breachHull(ship: Ship, rng: Rng, blueprintId: number): { x: number; y: number } | null {
  const outer: Vec[] = [];
  for (let y = 0; y < ship.h; y++) {
    for (let x = 0; x < ship.w; x++) if (isOuterWall(ship, x, y) && !blueprintAt(ship, x, y)) outer.push({ x, y });
  }
  if (!outer.length) return null;
  const p = rng.pick(outer);
  ship.tiles[p.y * ship.w + p.x] = 'floor';
  ship.air[p.y * ship.w + p.x] = 0;
  ship.layoutVersion++;
  const work = buildWork('wall');
  ship.blueprints.push({ id: blueprintId, x: p.x, y: p.y, kind: 'wall', remove: false, free: true, work, workTotal: work, delivered: {} });
  recomputeStats(ship);
  return p;
}

// ---------- Строительство ----------

export function validateBuild(ship: Ship, x: number, y: number, kind: BuildKind): string | null {
  if (!inBounds(ship, x, y)) return 'Вне корпуса';
  if (blueprintAt(ship, x, y)) return 'Здесь уже есть чертёж';
  const tile = tileAt(ship, x, y);
  const hasNeighbor = neighbors4(x, y).some((p) => tileAt(ship, p.x, p.y) !== 'empty');
  if (isModuleType(kind) && MODULES[kind].wallMount) {
    if (tile !== 'wall') return 'Ставится в стену между отсеками';
    if (isOuterWall(ship, x, y)) return 'Не во внешней обшивке';
    if (moduleAt(ship, x, y)) return 'Клетка занята модулем';
    const rooms = new Set<number>();
    const map = shipRooms(ship);
    for (const n of neighbors4(x, y)) {
      if (!inBounds(ship, n.x, n.y)) continue;
      const room = map.roomOf[n.y * ship.w + n.x];
      if (room >= 0) rooms.add(room);
    }
    if (rooms.size < 2) return 'Стена должна разделять два отсека';
  } else if (isModuleType(kind)) {
    const cells = footprint(kind, x, y);
    for (const c of cells) {
      if (!inBounds(ship, c.x, c.y)) return 'Вне корпуса';
      if (blueprintAt(ship, c.x, c.y)) return 'Здесь уже есть чертёж';
      if (tileAt(ship, c.x, c.y) !== 'floor') return 'Модуль ставится только на пол';
      if (moduleAt(ship, c.x, c.y)) return 'Клетка занята модулем';
    }
    const byHull = cells.some((c) => neighbors4(c.x, c.y).some((n) => isOuterWall(ship, n.x, n.y)));
    if (MODULES[kind].hullMount && !byHull) return 'Ставится вплотную к внешней стене корпуса';
  } else if (kind === 'floor') {
    if (tile !== 'empty') return 'Здесь уже что-то есть';
    if (!hasNeighbor) return 'Пол должен примыкать к кораблю';
  } else {
    if (tile === kind) return 'Уже построено';
    if (moduleAt(ship, x, y)) return 'Клетка занята модулем';
    if (tile === 'empty' && !hasNeighbor) return 'Должно примыкать к кораблю';
  }
  return null;
}

export function placeBlueprint(ship: Ship, id: number, x: number, y: number, kind: BuildKind): string | null {
  const err = validateBuild(ship, x, y, kind);
  if (err) return err;
  const work = buildWork(kind);
  ship.blueprints.push({ id, x, y, kind, remove: false, free: false, work, workTotal: work, delivered: {} });
  return null;
}

export function placeRemoval(ship: Ship, id: number, x: number, y: number, nextId: () => number): string | null {
  if (!inBounds(ship, x, y)) return 'Вне корпуса';
  const bp = blueprintAt(ship, x, y);
  if (bp) {
    if (!bp.remove && !bp.free) refundDelivered(ship, bp, nextId);
    ship.blueprints = ship.blueprints.filter((b) => b !== bp);
    return null;
  }
  const m = moduleAt(ship, x, y);
  const tile = tileAt(ship, x, y);
  if (!m && tile === 'empty') return 'Нечего разбирать';
  if (!m && tile === 'floor' && ship.tiles.filter((t) => t !== 'empty').length <= 1) return 'Нельзя разобрать последний пол';
  const kind: BuildKind = m ? m.type : (tile as Exclude<Tile, 'empty'>);
  const work = buildWork(kind) / 2;
  ship.blueprints.push({ id, x, y, kind, remove: true, free: false, work, workTotal: work, delivered: {} });
  return null;
}

/** Половина стоимости разбора падает на пол, а не сразу в запас. */
function scatter(ship: Ship, cost: Partial<Resources>, mult: number, x: number, y: number, nextId: () => number): void {
  for (const [k, v] of Object.entries(cost)) {
    const amount = (v ?? 0) * mult;
    if (amount <= 1e-9) continue;
    if (k === 'credits') ship.res.credits += amount;
    else if (isPhysical(k)) dropLoose(ship, k, amount, x, y, nextId);
  }
}

export function completeBlueprint(ship: Ship, bpId: number, ctx: ShipContext): void {
  const bp = ship.blueprints.find((b) => b.id === bpId);
  if (!bp) return;
  ship.blueprints = ship.blueprints.filter((b) => b !== bp);
  const idx = bp.y * ship.w + bp.x;
  if (bp.remove) {
    const m = moduleAt(ship, bp.x, bp.y);
    if (m) {
      ship.modules = ship.modules.filter((o) => o !== m);
      scatter(ship, MODULES[m.type].cost, 0.5, bp.x, bp.y, ctx.nextId);
    } else {
      const tile = ship.tiles[idx];
      if (tile !== 'empty') {
        scatter(ship, buildCost(tile), 0.5, bp.x, bp.y, ctx.nextId);
        ship.tiles[idx] = tile === 'floor' ? 'empty' : 'floor';
      }
    }
  } else if (isModuleType(bp.kind) && MODULES[bp.kind].wallMount) {
    if (tileAt(ship, bp.x, bp.y) === 'wall' && !moduleAt(ship, bp.x, bp.y)) {
      ship.modules.push(makeModule(ctx.nextId(), bp.kind, bp.x, bp.y));
      ctx.log(`Построен модуль: ${MODULES[bp.kind].name}`, 'good');
    } else if (!bp.free) {
      refundDelivered(ship, bp, ctx.nextId);
    }
  } else if (isModuleType(bp.kind)) {
    const cells = footprint(bp.kind, bp.x, bp.y);
    const clear = cells.every((c) => inBounds(ship, c.x, c.y) && tileAt(ship, c.x, c.y) === 'floor' && !moduleAt(ship, c.x, c.y));
    if (clear) {
      ship.modules.push(makeModule(ctx.nextId(), bp.kind, bp.x, bp.y));
      ctx.log(`Построен модуль: ${MODULES[bp.kind].name}`, 'good');
    } else if (!bp.free) {
      refundDelivered(ship, bp, ctx.nextId);
    }
  } else {
    ship.tiles[idx] = bp.kind;
  }
  ship.layoutVersion++;
  recomputeStats(ship);
  // Изменилась карта — пересчитываем пути всем, чей путь проходит через клетку.
  for (const c of ship.crew) if (c.path.some((p) => p.x === bp.x && p.y === bp.y)) c.path = [];
}

