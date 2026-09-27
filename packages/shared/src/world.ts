// Мир: звёздные системы, корабли игроков, враждебные машины и флора, торговля, экспедиции.
// Всё состояние — простые данные в WorldState, поэтому мир целиком сохраняется в JSON.
import {
  BIOMES,
  BUY_MARKUP,
  DOCK_RANGE,
  DT,
  EXPEDITION_MAX_CREW,
  EXPEDITION_ROLL_SECONDS,
  EXPEDITION_SECONDS,
  HULLS,
  HULL_REPAIR_COST_PER_HP,
  JUMP_CHARGE_SECONDS,
  JUMP_FUEL,
  LOOT_TTL,
  MARKET_REFRESH_SECONDS,
  MARKET_STOCK,
  METEOR_BELT_FALLOFF,
  METEOR_RATE_IN_BELT,
  MINING_CHUNK,
  MINING_RANGE,
  MINING_RATE,
  MODULES,
  NPCS,
  ORBIT_RANGE,
  RECRUIT_COST,
  RESOURCE_NAMES,
  RESOURCES,
  RESPAWN_SECONDS,
  ROBOT_COST,
  SAFE_ZONE_RADIUS,
  SECTOR_SIZE,
  SELL_PRICE,
  STAR_SYSTEMS,
  TICK_RATE,
  TILE_CHARS,
  TILE_WORLD,
  TRACTOR_RANGE,
  TRACTOR_SPEED,
  WEAPONS,
  isModuleType,
  jumpRange,
  solarFactor,
  systemDistance,
  type Biome,
  type BuildKind,
  type NpcType,
  type Resource,
  type Resources,
  type WeaponDef,
} from './defs';
import { clearOrder, isPiloted, normalizePriorities, orderCryo, orderMove, placeCrewOnBoard, setDraft, setPriority, toggleUrgent, updateCrew } from './crew';
import { dropCarry, giveShip, materialsReady, normalizeStorage, putInStockpile, removeStored, syncStored, takeShip } from './items';
import type { Command, Contact, LayoutView, OwnShipView, Snapshot } from './protocol';
import { Rng } from './rng';
import {
  createStarterShip,
  distributePower,
  functional,
  hasResources,
  igniteTile,
  lifeSupport,
  breachHull,
  makeRobot,
  placeBlueprint,
  placeRemoval,
  randomCrew,
  recomputeStats,
  shipRooms,
  updateFires,
  upgradeHull,
  walkableTiles,
  type ShipContext,
} from './ship';
import type {
  Asteroid,
  Belt,
  ChatEntry,
  Expedition,
  LogEntry,
  Loot,
  Market,
  Npc,
  Planet,
  Player,
  Ship,
  StarSystem,
  Station,
  Vec,
} from './state';

export interface WorldState {
  version: 1;
  seed: number;
  tick: number;
  nextId: number;
  rng: number;
  systems: StarSystem[];
  players: Player[];
  ships: Ship[];
  expeditions: Expedition[];
  chat: ChatEntry[];
  chatSeq: number;
}

/** Что конкретный клиент уже получил (планировки кораблей, чат). Хранится на сервере по соединению. */
export interface ClientCache {
  layouts: Map<number, number>;
  chatSeq: number;
}

export function newClientCache(): ClientCache {
  return { layouts: new Map(), chatSeq: 0 };
}

// ---------- Геометрия ----------

export function shipRadius(ship: { w: number; h: number }): number {
  return (Math.max(ship.w, ship.h) * TILE_WORLD) / 2;
}

/** Мировые координаты центра клетки корабля. */
export function tileWorld(ship: { x: number; y: number; w: number; h: number }, tx: number, ty: number): Vec {
  return { x: ship.x + (tx - ship.w / 2 + 0.5) * TILE_WORLD, y: ship.y + (ty - ship.h / 2 + 0.5) * TILE_WORLD };
}

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const TRADEABLE = RESOURCES.filter((r) => r !== 'credits') as Exclude<Resource, 'credits'>[];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatLoot(res: Partial<Resources>): string {
  return Object.entries(res)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${Math.round(v!)} ${RESOURCE_NAMES[k as Resource]}`)
    .join(', ');
}

type Target =
  | { k: 'ship'; x: number; y: number; r: number; ship: Ship }
  | { k: 'npc'; x: number; y: number; r: number; npc: Npc }
  | { k: 'asteroid'; x: number; y: number; r: number; asteroid: Asteroid }
  | { k: 'planet'; x: number; y: number; r: number; planet: Planet }
  | { k: 'station'; x: number; y: number; r: number; station: Station }
  | { k: 'loot'; x: number; y: number; r: number; loot: Loot };

export class World {
  state: WorldState;
  rng: Rng;

  constructor(state: WorldState) {
    this.state = state;
    this.rng = new Rng(1);
    this.rng.state = state.rng;
  }

  static create(seed = 20170621): World {
    const w = new World({
      version: 1,
      seed,
      tick: 0,
      nextId: 1,
      rng: seed,
      systems: [],
      players: [],
      ships: [],
      expeditions: [],
      chat: [],
      chatSeq: 0,
    });
    w.state.systems = STAR_SYSTEMS.map((_, i) => w.generateSystem(i));
    return w;
  }

  static fromJSON(json: string): World {
    const state = JSON.parse(json) as WorldState;
    for (const sys of state.systems) sys.fx = [];
    for (const ship of state.ships) {
      normalizeStorage(ship, () => state.nextId++);
      for (const c of ship.crew) normalizePriorities(c);
    }
    for (const e of state.expeditions) {
      for (const c of e.crew) {
        normalizePriorities(c);
        if (c.carry === undefined) c.carry = null;
      }
    }
    return new World(state);
  }

  toJSON(): string {
    this.state.rng = this.rng.state;
    return JSON.stringify(this.state);
  }

  nextId = (): number => this.state.nextId++;

  // ---------- Генерация ----------

  private generateSystem(index: number): StarSystem {
    const def = STAR_SYSTEMS[index];
    const rng = this.rng;
    const sys: StarSystem = {
      id: index,
      planets: [],
      stations: [],
      markets: [],
      belts: [],
      asteroids: [],
      npcs: [],
      loot: [],
      projectiles: [],
      fx: [],
    };
    const placed: { x: number; y: number; r: number }[] = [{ x: 0, y: 0, r: 420 }];
    const place = (r: number, minD: number, maxD: number): Vec => {
      for (let attempt = 0; attempt < 300; attempt++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(minD, maxD);
        const p = { x: Math.cos(a) * d, y: Math.sin(a) * d };
        if (placed.every((o) => dist(o, p) > o.r + r + 180)) {
          placed.push({ ...p, r });
          return p;
        }
      }
      const a = rng.range(0, Math.PI * 2);
      return { x: Math.cos(a) * maxD, y: Math.sin(a) * maxD };
    };
    for (const name of def.stations) {
      const p = place(90, 900, 1500);
      const station: Station = { id: this.nextId(), name, x: p.x, y: p.y, r: 90 };
      sys.stations.push(station);
      sys.markets.push(this.newMarket(station.id));
    }
    const planetDefs: { biome: Biome; name: string; colony: boolean }[] = [
      ...def.colonies.map(([biome, name]) => ({ biome, name, colony: true })),
      ...def.biomes.map((biome, i) => ({ biome, name: `${def.name} ${ROMAN[i + def.colonies.length]}`, colony: false })),
    ];
    for (const pd of planetDefs) {
      const r = rng.range(120, 210);
      const p = place(r + SAFE_ZONE_RADIUS * (pd.colony ? 0.5 : 0), 1300, 3500);
      const planet: Planet = { id: this.nextId(), name: pd.name, biome: pd.biome, colony: pd.colony, x: p.x, y: p.y, r };
      sys.planets.push(planet);
      if (pd.colony) sys.markets.push(this.newMarket(planet.id));
    }
    for (let i = 0; i < def.belts; i++) {
      const p = place(480, 1700, 3600);
      sys.belts.push({ x: p.x, y: p.y, r: 480 });
    }
    for (let i = 0; i < def.asteroids; i++) this.spawnAsteroid(sys);
    for (const [type, count] of Object.entries(def.npcs) as [NpcType, number][]) {
      for (let i = 0; i < count; i++) this.spawnNpc(sys, type);
    }
    return sys;
  }

  private newMarket(hostId: number): Market {
    const m: Market = { hostId, stock: {}, price: {}, refreshIn: MARKET_REFRESH_SECONDS };
    this.restockMarket(m);
    return m;
  }

  private restockMarket(m: Market): void {
    for (const r of TRADEABLE) {
      const [lo, hi] = MARKET_STOCK[r];
      m.stock[r] = this.rng.int(lo, hi);
      m.price[r] = Math.round(SELL_PRICE[r] * this.rng.range(0.8, 1.25) * 10) / 10;
    }
    m.refreshIn = MARKET_REFRESH_SECONDS;
  }

  private spawnAsteroid(sys: StarSystem): void {
    if (!sys.belts.length) return;
    const rng = this.rng;
    const belt = rng.pick(sys.belts);
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * belt.r;
    const res: Partial<Resources> = { metal: rng.int(20, 60) };
    if (rng.chance(0.6)) res.ice = rng.int(10, 45);
    if (rng.chance(0.4)) res.crystals = rng.int(3, 14);
    const total = Object.values(res).reduce((s, v) => s + (v ?? 0), 0);
    sys.asteroids.push({ id: this.nextId(), x: belt.x + Math.cos(a) * d, y: belt.y + Math.sin(a) * d, r: 14 + total / 6, res });
  }

  private spawnNpc(sys: StarSystem, type: NpcType): void {
    const def = NPCS[type];
    let p: Vec = { x: 0, y: 0 };
    for (let attempt = 0; attempt < 50; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      p = { x: Math.cos(a) * this.rng.range(1500, 3800), y: Math.sin(a) * this.rng.range(1500, 3800) };
      if (!this.inSafeZone(sys, p, 600)) break;
    }
    sys.npcs.push({
      id: this.nextId(),
      type,
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      heading: 0,
      hp: def.maxHp,
      shield: def.maxShield,
      cooldown: 0,
      targetShipId: null,
      wander: p,
    });
  }

  // ---------- Игроки ----------

  player(id: number): Player | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  /** Вход по токену: тот же токен возвращает игрока к его кораблю. */
  join(name: string, token: string): Player {
    const existing = this.state.players.find((p) => p.token === token);
    if (existing) {
      existing.online = true;
      this.log(existing, 'С возвращением, капитан.', 'info');
      return existing;
    }
    const clean = name.replace(/[^\p{L}\p{N} _\-]/gu, '').trim().slice(0, 20) || 'Капитан';
    const player: Player = {
      id: this.nextId(),
      name: clean,
      token,
      online: true,
      shipId: null,
      respawnIn: 0,
      kills: 0,
      deaths: 0,
      inbox: [],
    };
    this.state.players.push(player);
    this.spawnShip(player);
    this.log(player, 'Человечество покинуло Землю. Ваш корабль — последний дом для экипажа. Найдите пригодный мир.', 'info');
    return player;
  }

  leave(playerId: number): void {
    const p = this.player(playerId);
    if (p) p.online = false;
  }

  private spawnShip(player: Player): Ship {
    const sys = this.state.systems[0];
    const home = sys.stations[0] ?? { x: 0, y: 0 };
    const a = this.rng.range(0, Math.PI * 2);
    const ship = createStarterShip({
      id: this.nextId(),
      ownerId: player.id,
      systemId: 0,
      name: `«Буран» ${player.name}`,
      x: home.x + Math.cos(a) * 260,
      y: home.y + Math.sin(a) * 260,
      rng: this.rng,
      nextId: this.nextId,
    });
    this.state.ships.push(ship);
    player.shipId = ship.id;
    return ship;
  }

  log(player: Player | undefined, text: string, level: LogEntry['level'] = 'info'): void {
    if (!player) return;
    player.inbox.push({ tick: this.state.tick, text, level });
    if (player.inbox.length > 200) player.inbox.splice(0, player.inbox.length - 200);
  }

  private ownerOf(ship: Ship): Player | undefined {
    return this.player(ship.ownerId);
  }

  /** Корабли, которые сейчас участвуют в симуляции (владелец онлайн). Офлайн-корабли заморожены и невидимы. */
  activeShips(systemId?: number): Ship[] {
    return this.state.ships.filter(
      (s) => (systemId === undefined || s.systemId === systemId) && this.player(s.ownerId)?.online,
    );
  }

  shipOf(player: Player): Ship | undefined {
    return player.shipId === null ? undefined : this.state.ships.find((s) => s.id === player.shipId);
  }

  // ---------- Запросы по системе ----------

  inSafeZone(sys: StarSystem, p: Vec, extra = 0): boolean {
    return (
      sys.stations.some((s) => dist(s, p) < SAFE_ZONE_RADIUS + extra) ||
      sys.planets.some((pl) => pl.colony && dist(pl, p) < pl.r + SAFE_ZONE_RADIUS * 0.5 + extra)
    );
  }

  private findTarget(sys: StarSystem, id: number): Target | null {
    const ship = this.activeShips(sys.id).find((s) => s.id === id);
    if (ship) return { k: 'ship', x: ship.x, y: ship.y, r: shipRadius(ship), ship };
    const npc = sys.npcs.find((n) => n.id === id);
    if (npc) return { k: 'npc', x: npc.x, y: npc.y, r: NPCS[npc.type].radius, npc };
    const asteroid = sys.asteroids.find((a) => a.id === id);
    if (asteroid) return { k: 'asteroid', x: asteroid.x, y: asteroid.y, r: asteroid.r, asteroid };
    const planet = sys.planets.find((p) => p.id === id);
    if (planet) return { k: 'planet', x: planet.x, y: planet.y, r: planet.r, planet };
    const station = sys.stations.find((s) => s.id === id);
    if (station) return { k: 'station', x: station.x, y: station.y, r: station.r, station };
    const loot = sys.loot.find((l) => l.id === id);
    if (loot) return { k: 'loot', x: loot.x, y: loot.y, r: 6, loot };
    return null;
  }

  marketNear(ship: Ship): Market | null {
    const sys = this.state.systems[ship.systemId];
    for (const m of sys.markets) {
      const st = sys.stations.find((s) => s.id === m.hostId);
      if (st && dist(st, ship) < st.r + DOCK_RANGE) return m;
      const pl = sys.planets.find((p) => p.id === m.hostId);
      if (pl && dist(pl, ship) < pl.r + ORBIT_RANGE + shipRadius(ship)) return m;
    }
    return null;
  }

  orbitOf(ship: Ship): Planet | null {
    const sys = this.state.systems[ship.systemId];
    return sys.planets.find((p) => dist(p, ship) < p.r + ORBIT_RANGE + shipRadius(ship)) ?? null;
  }

  private marketName(sys: StarSystem, m: Market): string {
    return sys.stations.find((s) => s.id === m.hostId)?.name ?? sys.planets.find((p) => p.id === m.hostId)?.name ?? '?';
  }

  private totalCrew(ship: Ship): number {
    return ship.crew.length + this.state.expeditions.filter((e) => e.shipId === ship.id).reduce((s, e) => s + e.crew.length, 0);
  }

  // ---------- Шаг симуляции ----------

  step(): void {
    const dt = DT;
    this.state.tick++;
    for (const sys of this.state.systems) sys.fx = [];
    for (const ship of this.activeShips()) this.updateShip(ship, dt);
    for (const sys of this.state.systems) {
      this.updateNpcs(sys, dt);
      this.updateProjectiles(sys, dt);
      this.updateLoot(sys, dt);
      for (const m of sys.markets) {
        m.refreshIn -= dt;
        if (m.refreshIn <= 0) this.restockMarket(m);
      }
      if (this.state.tick % (TICK_RATE * 5) === 0) this.maintainPopulation(sys);
    }
    this.updateExpeditions(dt);
    for (const p of this.state.players) {
      if (!p.online || p.shipId !== null) continue;
      p.respawnIn -= dt;
      if (p.respawnIn <= 0) {
        this.spawnShip(p);
        this.log(p, 'Новый корабль и новая команда. Попробуйте ещё раз.', 'info');
      }
    }
  }

  private updateShip(ship: Ship, dt: number): void {
    const sys = this.state.systems[ship.systemId];
    const owner = this.ownerOf(ship);
    const target = ship.targetId !== null ? this.findTarget(sys, ship.targetId) : null;
    if (ship.targetId !== null && !target) ship.targetId = null;
    const asteroid = target?.k === 'asteroid' ? target.asteroid : null;
    const miningInRange = !!asteroid && dist(asteroid, ship) < MINING_RANGE + asteroid.r + shipRadius(ship);
    const inCombat = this.state.tick - ship.lastCombatTick < TICK_RATE * 5;
    const ctx: ShipContext = {
      rng: this.rng,
      nextId: this.nextId,
      log: (text, level) => this.log(owner, text, level),
      wantsPilot: !!ship.moveTarget || !!ship.jump || inCombat,
      miningActive: miningInRange,
      moving: !!ship.moveTarget || !!ship.jump,
      solar: solarFactor(Math.hypot(ship.x, ship.y)),
    };

    syncStored(ship);
    distributePower(ship, dt, ctx);
    lifeSupport(ship, dt, this.nextId);
    updateFires(ship, dt, this.rng);
    updateCrew(ship, dt, ctx);
    ship.stats.piloted = isPiloted(ship);

    // Полёт.
    const accel = 70;
    if (ship.moveTarget && ship.stats.piloted && ship.stats.maxSpeed > 0) {
      const dx = ship.moveTarget.x - ship.x;
      const dy = ship.moveTarget.y - ship.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) {
        ship.moveTarget = null;
      } else {
        const speed = Math.min(ship.stats.maxSpeed, Math.sqrt(2 * accel * d));
        let ax = (dx / d) * speed - ship.vx;
        let ay = (dy / d) * speed - ship.vy;
        const a = Math.hypot(ax, ay);
        if (a > accel * dt) {
          ax = (ax / a) * accel * dt;
          ay = (ay / a) * accel * dt;
        }
        ship.vx += ax;
        ship.vy += ay;
        ship.heading = Math.atan2(dy, dx);
      }
    } else {
      const damp = Math.max(0, 1 - 1.2 * dt);
      ship.vx *= damp;
      ship.vy *= damp;
    }
    const half = SECTOR_SIZE / 2;
    ship.x = Math.max(-half, Math.min(half, ship.x + ship.vx * dt));
    ship.y = Math.max(-half, Math.min(half, ship.y + ship.vy * dt));

    // Добыча: бур откалывает контейнеры, луч затягивает их на борт.
    const miners = ship.modules.filter((m) => m.type === 'mining_laser' && functional(m) && m.powered);
    const wanted = ship.mineResource;
    const canMine = miningInRange && asteroid && (!wanted || (asteroid.res[wanted] ?? 0) > 0);
    for (const m of ship.modules) if (m.type === 'mining_laser') m.active = !!canMine && miners.includes(m);
    if (canMine && miners.length && asteroid) {
      ship.mineProgress += MINING_RATE * miners.length * dt;
      while (ship.mineProgress >= MINING_CHUNK && asteroid.res) {
        ship.mineProgress -= MINING_CHUNK;
        this.chipAsteroid(sys, asteroid, ship, wanted);
        if (!sys.asteroids.includes(asteroid)) break;
      }
    }

    this.fireWeapons(sys, ship, target, dt);

    // Тяговый луч.
    const r = shipRadius(ship);
    for (const loot of [...sys.loot]) {
      const d = dist(loot, ship);
      if (d > TRACTOR_RANGE) continue;
      if (d < r * 0.6) {
        giveShip(ship, loot.res, this.nextId);
        sys.loot = sys.loot.filter((l) => l !== loot);
        const total = Object.values(loot.res).reduce((s, v) => s + (v ?? 0), 0);
        if (total >= 10 || (loot.res.credits ?? 0) > 0) this.log(owner, `Подобран груз: ${formatLoot(loot.res)}`, 'good');
        continue;
      }
      loot.vx = ((ship.x - loot.x) / d) * TRACTOR_SPEED + ship.vx;
      loot.vy = ((ship.y - loot.y) / d) * TRACTOR_SPEED + ship.vy;
    }

    // Метеориты: чем ближе к поясу астероидов, тем чаще.
    const beltDist = Math.min(...sys.belts.map((b: Belt) => dist(b, ship) - b.r), Infinity);
    const closeness = Math.max(0, Math.min(1, 1 - beltDist / METEOR_BELT_FALLOFF));
    if (closeness > 0 && this.rng.chance(METEOR_RATE_IN_BELT * closeness * dt)) this.meteorStrike(sys, ship);

    // Гиперпрыжок.
    if (ship.jump) {
      const engines = ship.modules.filter((m) => m.type === 'engine' && functional(m) && m.powered).length;
      if (ship.stats.piloted && engines > 0) ship.jump.timeLeft -= dt;
      if (ship.jump.timeLeft <= 0) {
        const to = ship.jump.systemId;
        sys.fx.push({ k: 'boom', x: ship.x, y: ship.y, r: 40 });
        const a = this.rng.range(0, Math.PI * 2);
        ship.systemId = to;
        ship.x = Math.cos(a) * 3000;
        ship.y = Math.sin(a) * 3000;
        ship.vx = ship.vy = 0;
        ship.moveTarget = null;
        ship.targetId = null;
        ship.jump = null;
        this.log(owner, `Прыжок завершён: система «${STAR_SYSTEMS[to].name}».`, 'good');
      }
    }

    if (ship.crew.length === 0 && !this.state.expeditions.some((e) => e.shipId === ship.id)) {
      this.destroyShip(ship, null, 'На борту не осталось живых. Корабль потерян.');
    }
  }

  private chipAsteroid(sys: StarSystem, asteroid: Asteroid, ship: Ship, wanted: Resource | null): void {
    const available = (Object.entries(asteroid.res) as [Resource, number][]).filter(([, v]) => v > 0);
    if (!available.length) return;
    let resource: Resource;
    if (wanted && (asteroid.res[wanted] ?? 0) > 0) resource = wanted;
    else {
      const total = available.reduce((s, [, v]) => s + v, 0);
      let roll = this.rng.range(0, total);
      resource = available[0][0];
      for (const [k, v] of available) {
        roll -= v;
        if (roll <= 0) {
          resource = k;
          break;
        }
      }
    }
    const amount = Math.min(MINING_CHUNK, asteroid.res[resource] ?? 0);
    asteroid.res[resource] = (asteroid.res[resource] ?? 0) - amount;
    const d = dist(asteroid, ship) || 1;
    const ux = (ship.x - asteroid.x) / d;
    const uy = (ship.y - asteroid.y) / d;
    sys.loot.push({
      id: this.nextId(),
      x: asteroid.x + ux * asteroid.r,
      y: asteroid.y + uy * asteroid.r,
      vx: ux * 40 + this.rng.range(-15, 15),
      vy: uy * 40 + this.rng.range(-15, 15),
      res: { [resource]: amount },
      ttl: LOOT_TTL,
    });
    const left = Object.values(asteroid.res).reduce((s, v) => s + (v ?? 0), 0);
    asteroid.r = Math.max(8, 14 + left / 6);
    if (left <= 0) {
      sys.asteroids = sys.asteroids.filter((a) => a !== asteroid);
      sys.fx.push({ k: 'boom', x: asteroid.x, y: asteroid.y, r: 20 });
      this.log(this.ownerOf(ship), 'Астероид выработан.', 'info');
    }
  }

  private meteorStrike(sys: StarSystem, ship: Ship): void {
    const owner = this.ownerOf(ship);
    sys.fx.push({ k: 'boom', x: ship.x + this.rng.range(-20, 20), y: ship.y + this.rng.range(-20, 20), r: 18 });
    this.log(owner, 'Метеорит ударил в корпус!', 'warn');
    this.damageShip(sys, ship, this.rng.range(6, 14), 0.5, null);
    if (this.rng.chance(0.5)) {
      const spots = walkableTiles(ship);
      if (spots.length) {
        const p = this.rng.pick(spots);
        if (igniteTile(ship, p.x, p.y)) this.log(owner, 'Пожар на борту!', 'bad');
      }
    }
  }

  // ---------- Бой ----------

  private weaponTarget(sys: StarSystem, ship: Ship, target: Target | null, origin: Vec, w: WeaponDef): Target | null {
    const inRange = (t: Target) => dist(origin, t) <= w.range + t.r;
    if (target?.k === 'npc' && inRange(target)) return target;
    if (
      target?.k === 'ship' &&
      target.ship.ownerId !== ship.ownerId &&
      inRange(target) &&
      !this.inSafeZone(sys, ship) &&
      !this.inSafeZone(sys, target.ship)
    ) {
      return target;
    }
    // Автозащита: ближайший враг, который атакует нас.
    let best: Target | null = null;
    for (const npc of sys.npcs) {
      if (npc.targetShipId !== ship.id) continue;
      const t: Target = { k: 'npc', x: npc.x, y: npc.y, r: NPCS[npc.type].radius, npc };
      if (inRange(t) && (!best || dist(origin, t) < dist(origin, best))) best = t;
    }
    return best;
  }

  private fireWeapons(sys: StarSystem, ship: Ship, target: Target | null, dt: number): void {
    for (const m of ship.modules) {
      const w = WEAPONS[m.type];
      if (!w) continue;
      m.active = false;
      if (!functional(m) || !m.powered) continue;
      m.cooldown = Math.max(0, m.cooldown - dt);
      if (m.cooldown > 0) continue;
      const origin = tileWorld(ship, m.x, m.y);
      const t = this.weaponTarget(sys, ship, target, origin, w);
      if (!t || (t.k !== 'npc' && t.k !== 'ship')) continue;
      if (w.ammo && !hasResources(ship.res, w.ammo)) continue;
      m.cooldown = w.cooldown;
      m.active = true;
      ship.lastCombatTick = this.state.tick;
      if (t.k === 'ship') t.ship.lastCombatTick = this.state.tick;
      if (w.projectileSpeed) {
        if (w.ammo) takeShip(ship, w.ammo);
        const d = dist(origin, t) || 1;
        sys.projectiles.push({
          id: this.nextId(),
          x: origin.x,
          y: origin.y,
          vx: ((t.x - origin.x) / d) * w.projectileSpeed,
          vy: ((t.y - origin.y) / d) * w.projectileSpeed,
          speed: w.projectileSpeed,
          targetId: t.k === 'ship' ? t.ship.id : t.npc.id,
          damage: w.damage,
          pierce: w.pierce,
          kind: 'missile',
          ownerShipId: ship.id,
          life: 8,
        });
      } else {
        const evasive = t.k === 'ship' && t.ship.stats.piloted && Math.hypot(t.ship.vx, t.ship.vy) > 10;
        const hit = this.rng.chance(evasive ? 0.75 : 0.9);
        const miss = hit ? { x: 0, y: 0 } : { x: this.rng.range(-40, 40), y: this.rng.range(-40, 40) };
        sys.fx.push({ k: 'laser', x1: origin.x, y1: origin.y, x2: t.x + miss.x, y2: t.y + miss.y, hostile: false });
        if (hit) {
          if (t.k === 'npc') this.damageNpc(sys, t.npc, w.damage, w.pierce, ship);
          else this.damageShip(sys, t.ship, w.damage, w.pierce, ship);
        }
      }
    }
  }

  /** Урон кораблю игрока: щит → корпус → модули, экипаж, пробоины. */
  damageShip(sys: StarSystem, ship: Ship, damage: number, pierce: number, attacker: Ship | null): void {
    const owner = this.ownerOf(ship);
    ship.lastCombatTick = this.state.tick;
    let toShield = damage * (1 - pierce);
    let through = damage * pierce;
    const absorbed = Math.min(ship.shield, toShield);
    ship.shield -= absorbed;
    toShield -= absorbed;
    through += toShield;
    sys.fx.push({ k: 'hit', x: ship.x + this.rng.range(-15, 15), y: ship.y + this.rng.range(-15, 15), shield: through <= 0 });
    if (through <= 0) return;
    ship.hp -= through;
    if (this.rng.chance(0.35) && ship.modules.length) {
      const m = this.rng.pick(ship.modules);
      const wasAlive = m.hp > 0;
      m.hp = Math.max(0, m.hp - through * 1.5);
      if (wasAlive && m.hp <= 0) {
        this.log(owner, `Модуль «${MODULES[m.type].name}» выведен из строя!`, 'bad');
        if (this.rng.chance(0.4)) igniteTile(ship, m.x, m.y, 0.5);
      }
    }
    const aboard = ship.crew.filter((c) => c.state !== 'cryo');
    if (this.rng.chance(0.12) && aboard.length) {
      const c = this.rng.pick(aboard);
      c.health -= through * 0.8;
      this.log(owner, `${c.name} ранен(а) осколками.`, 'warn');
    }
    if (this.rng.chance(0.06 + through / 120)) {
      if (breachHull(ship, this.rng, this.nextId())) this.log(owner, 'Пробоина в корпусе! Отсек теряет воздух.', 'bad');
    }
    if (ship.hp <= 0) {
      this.destroyShip(ship, attacker, attacker ? `Корабль уничтожен игроком ${this.ownerOf(attacker)?.name ?? '?'}.` : 'Корабль уничтожен.');
    }
  }

  private damageNpc(sys: StarSystem, npc: Npc, damage: number, pierce: number, attacker: Ship | null): void {
    let toShield = damage * (1 - pierce);
    let through = damage * pierce;
    const absorbed = Math.min(npc.shield, toShield);
    npc.shield -= absorbed;
    toShield -= absorbed;
    through += toShield;
    sys.fx.push({ k: 'hit', x: npc.x, y: npc.y, shield: through <= 0 });
    npc.hp -= through;
    if (attacker && npc.targetShipId === null && !this.inSafeZone(sys, attacker)) npc.targetShipId = attacker.id;
    if (npc.hp > 0) return;
    const def = NPCS[npc.type];
    sys.npcs = sys.npcs.filter((n) => n !== npc);
    sys.fx.push({ k: 'boom', x: npc.x, y: npc.y, r: def.radius * 2 });
    const loot: Partial<Resources> = {};
    for (const [k, range] of Object.entries(def.loot) as [Resource, [number, number]][]) loot[k] = this.rng.int(range[0], range[1]);
    this.dropLoot(sys, npc, loot, 3);
    if (attacker) {
      const owner = this.ownerOf(attacker);
      if (owner) owner.kills++;
      this.log(owner, `Уничтожен: ${def.name}. Трофеи выпали в космос.`, 'good');
    }
  }

  private dropLoot(sys: StarSystem, at: Vec, res: Partial<Resources>, chunks: number): void {
    const entries = Object.entries(res).filter(([, v]) => (v ?? 0) >= 1) as [Resource, number][];
    if (!entries.length) return;
    const parts: Partial<Resources>[] = Array.from({ length: Math.min(chunks, entries.length) }, () => ({}));
    entries.forEach(([k, v], i) => {
      parts[i % parts.length][k] = Math.floor(v);
    });
    for (const part of parts) {
      const a = this.rng.range(0, Math.PI * 2);
      sys.loot.push({ id: this.nextId(), x: at.x, y: at.y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, res: part, ttl: LOOT_TTL });
    }
  }

  destroyShip(ship: Ship, killer: Ship | null, reason: string): void {
    const sys = this.state.systems[ship.systemId];
    const owner = this.ownerOf(ship);
    sys.fx.push({ k: 'boom', x: ship.x, y: ship.y, r: shipRadius(ship) * 1.5 });
    const salvage: Partial<Resources> = {};
    for (const r of RESOURCES) salvage[r] = Math.floor(ship.res[r] * 0.5);
    this.dropLoot(sys, ship, salvage, 5);
    for (const e of this.state.expeditions.filter((x) => x.shipId === ship.id)) {
      this.log(owner, `Высадившаяся команда (${e.crew.map((c) => c.name).join(', ')}) осталась без корабля.`, 'bad');
    }
    this.state.expeditions = this.state.expeditions.filter((e) => e.shipId !== ship.id);
    this.state.ships = this.state.ships.filter((s) => s !== ship);
    if (owner) {
      owner.shipId = null;
      owner.respawnIn = RESPAWN_SECONDS;
      owner.deaths++;
      this.log(owner, `${reason} Игра начинается заново.`, 'bad');
    }
    if (killer) {
      const k = this.ownerOf(killer);
      if (k) {
        k.kills++;
        this.log(k, `Корабль игрока ${owner?.name ?? '?'} уничтожен. Обломки с грузом дрейфуют рядом.`, 'good');
      }
    }
  }

  // ---------- Враги ----------

  private updateNpcs(sys: StarSystem, dt: number): void {
    const ships = this.activeShips(sys.id);
    for (const npc of [...sys.npcs]) {
      const def = NPCS[npc.type];
      npc.shield = Math.min(def.maxShield, npc.shield + def.shieldRegen * dt);
      npc.cooldown = Math.max(0, npc.cooldown - dt);
      let target = npc.targetShipId !== null ? ships.find((s) => s.id === npc.targetShipId) : undefined;
      if (target && (this.inSafeZone(sys, target) || dist(target, npc) > def.aggroRange * 1.8)) target = undefined;
      if (!target) {
        npc.targetShipId = null;
        let best = Infinity;
        for (const s of ships) {
          const d = dist(s, npc);
          if (d < def.aggroRange && d < best && !this.inSafeZone(sys, s)) {
            best = d;
            target = s;
          }
        }
        if (target) npc.targetShipId = target.id;
      }

      let desired: Vec;
      if (target) {
        const d = dist(target, npc) || 1;
        const ux = (target.x - npc.x) / d;
        const uy = (target.y - npc.y) / d;
        const keep = def.weapon.range * 0.7;
        // Сближаемся до дистанции стрельбы, дальше кружим вокруг цели.
        desired = d > keep ? { x: ux * def.speed, y: uy * def.speed } : { x: -uy * def.speed * 0.6, y: ux * def.speed * 0.6 };
        npc.heading = Math.atan2(uy, ux);
      } else {
        if (dist(npc.wander, npc) < 40) {
          const a = this.rng.range(0, Math.PI * 2);
          const p = { x: npc.x + Math.cos(a) * 600, y: npc.y + Math.sin(a) * 600 };
          const lim = SECTOR_SIZE / 2 - 200;
          npc.wander = { x: Math.max(-lim, Math.min(lim, p.x)), y: Math.max(-lim, Math.min(lim, p.y)) };
        }
        const d = dist(npc.wander, npc) || 1;
        desired = { x: ((npc.wander.x - npc.x) / d) * def.speed * 0.4, y: ((npc.wander.y - npc.y) / d) * def.speed * 0.4 };
        npc.heading = Math.atan2(desired.y, desired.x);
      }
      // Враги не заходят в безопасную зону станций.
      for (const st of sys.stations) {
        const d = dist(st, npc);
        if (d < SAFE_ZONE_RADIUS + 100) {
          desired = { x: ((npc.x - st.x) / (d || 1)) * def.speed, y: ((npc.y - st.y) / (d || 1)) * def.speed };
          npc.wander = { x: npc.x + desired.x * 10, y: npc.y + desired.y * 10 };
        }
      }
      const k = Math.min(1, 2 * dt);
      npc.vx += (desired.x - npc.vx) * k;
      npc.vy += (desired.y - npc.vy) * k;
      npc.x += npc.vx * dt;
      npc.y += npc.vy * dt;

      if (target && npc.cooldown <= 0 && dist(target, npc) <= def.weapon.range + shipRadius(target)) {
        npc.cooldown = def.weapon.cooldown;
        if (def.weapon.fx === 'spore') {
          const d = dist(target, npc) || 1;
          const speed = def.weapon.projectileSpeed ?? 150;
          sys.projectiles.push({
            id: this.nextId(),
            x: npc.x,
            y: npc.y,
            vx: ((target.x - npc.x) / d) * speed,
            vy: ((target.y - npc.y) / d) * speed,
            speed,
            targetId: target.id,
            damage: def.weapon.damage,
            pierce: def.weapon.pierce,
            kind: 'spore',
            ownerShipId: -npc.id,
            life: 6,
          });
        } else {
          const evasive = target.stats.piloted && Math.hypot(target.vx, target.vy) > 10;
          const hit = this.rng.chance(evasive ? 0.7 : 0.85);
          const off = hit ? 0 : this.rng.range(-50, 50);
          sys.fx.push({ k: 'laser', x1: npc.x, y1: npc.y, x2: target.x + off, y2: target.y - off, hostile: true });
          if (hit) this.damageShip(sys, target, def.weapon.damage, def.weapon.pierce, null);
        }
      }
    }
  }

  private updateProjectiles(sys: StarSystem, dt: number): void {
    for (const p of [...sys.projectiles]) {
      p.life -= dt;
      const t = this.findTarget(sys, p.targetId);
      if (!t || p.life <= 0 || (t.k !== 'ship' && t.k !== 'npc')) {
        sys.projectiles = sys.projectiles.filter((o) => o !== p);
        continue;
      }
      const d = dist(t, p) || 1;
      // Самонаведение с ограниченной манёвренностью.
      const k = Math.min(1, 3 * dt);
      p.vx += (((t.x - p.x) / d) * p.speed - p.vx) * k;
      p.vy += (((t.y - p.y) / d) * p.speed - p.vy) * k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (dist(t, p) < t.r * 0.8) {
        sys.projectiles = sys.projectiles.filter((o) => o !== p);
        const attacker = p.ownerShipId > 0 ? this.state.ships.find((s) => s.id === p.ownerShipId) ?? null : null;
        if (t.k === 'ship') this.damageShip(sys, t.ship, p.damage, p.pierce, attacker);
        else this.damageNpc(sys, t.npc, p.damage, p.pierce, attacker);
      }
    }
  }

  private updateLoot(sys: StarSystem, dt: number): void {
    for (const l of sys.loot) {
      l.ttl -= dt;
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      const damp = Math.max(0, 1 - 0.8 * dt);
      l.vx *= damp;
      l.vy *= damp;
    }
    sys.loot = sys.loot.filter((l) => l.ttl > 0);
  }

  private maintainPopulation(sys: StarSystem): void {
    const def = STAR_SYSTEMS[sys.id];
    if (sys.asteroids.length < def.asteroids) this.spawnAsteroid(sys);
    for (const [type, count] of Object.entries(def.npcs) as [NpcType, number][]) {
      if (sys.npcs.filter((n) => n.type === type).length < count && this.rng.chance(0.3)) this.spawnNpc(sys, type);
    }
  }

  // ---------- Экспедиции ----------

  private updateExpeditions(dt: number): void {
    for (const e of [...this.state.expeditions]) {
      const ship = this.state.ships.find((s) => s.id === e.shipId);
      const owner = this.player(e.ownerId);
      if (!ship) {
        this.state.expeditions = this.state.expeditions.filter((x) => x !== e);
        continue;
      }
      if (!owner?.online) continue;
      const sys = this.state.systems[e.systemId];
      const planet = sys.planets.find((p) => p.id === e.planetId)!;
      const biome = BIOMES[planet.biome];
      if (e.timeLeft > 0) {
        e.timeLeft -= dt;
        e.rollTimer -= dt;
        while (e.rollTimer <= 0 && e.crew.length) {
          e.rollTimer += EXPEDITION_ROLL_SECONDS;
          if (this.rng.chance(biome.threat)) {
            const victim = this.rng.pick(e.crew);
            const dmg = this.rng.range(10, 30) * (1 - victim.skills.combat * 0.05);
            victim.health -= dmg;
            this.log(owner, `${planet.name}: ${this.rng.pick(biome.dangers).replace('{name}', victim.name)}.`, 'warn');
            if (victim.health <= 0) {
              e.crew = e.crew.filter((c) => c !== victim);
              this.log(owner, `${victim.name} погиб(ла) на планете ${planet.name}.`, 'bad');
            }
          } else {
            const entries = Object.entries(biome.loot) as [Resource, [number, number]][];
            const [res, [lo, hi]] = this.rng.pick(entries);
            e.loot[res] = (e.loot[res] ?? 0) + this.rng.int(lo, hi);
            if (this.rng.chance(0.3)) this.log(owner, `${planet.name}: найдено — ${this.rng.pick(biome.finds)}.`, 'info');
          }
        }
        if (!e.crew.length) {
          this.state.expeditions = this.state.expeditions.filter((x) => x !== e);
          this.log(owner, `Экспедиция на ${planet.name} погибла полностью.`, 'bad');
        }
        continue;
      }
      // Команда ждёт на поверхности, пока корабль не вернётся в систему.
      if (ship.systemId !== e.systemId) continue;
      for (const c of e.crew) placeCrewOnBoard(ship, c);
      giveShip(ship, e.loot, this.nextId);
      this.state.expeditions = this.state.expeditions.filter((x) => x !== e);
      this.log(owner, `Экспедиция вернулась с ${planet.name}. Добыто: ${formatLoot(e.loot) || 'ничего'}.`, 'good');
    }
  }

  // ---------- Команды игрока ----------

  command(playerId: number, raw: unknown): string | null {
    const player = this.player(playerId);
    if (!player) return 'Нет игрока';
    if (!raw || typeof raw !== 'object' || typeof (raw as { c?: unknown }).c !== 'string') return 'Некорректная команда';
    const cmd = raw as Command;
    if (cmd.c === 'chat') {
      if (typeof cmd.text !== 'string') return 'Некорректный текст';
      const text = cmd.text.trim().slice(0, 200);
      if (!text) return null;
      this.state.chat.push({ seq: ++this.state.chatSeq, tick: this.state.tick, from: player.name, text });
      if (this.state.chat.length > 100) this.state.chat.splice(0, this.state.chat.length - 100);
      return null;
    }
    const ship = this.shipOf(player);
    if (!ship) return 'Корабля нет — ждите нового';
    syncStored(ship);
    const sys = this.state.systems[ship.systemId];
    switch (cmd.c) {
      case 'move':
        if (!isNum(cmd.x) || !isNum(cmd.y)) return 'Некорректные координаты';
        ship.moveTarget = { x: cmd.x, y: cmd.y };
        return null;
      case 'stop':
        ship.moveTarget = null;
        if (ship.jump) {
          giveShip(ship, JUMP_FUEL, this.nextId);
          ship.jump = null;
          this.log(player, 'Гиперпрыжок отменён.', 'info');
        }
        return null;
      case 'target':
        if (cmd.id === null) {
          ship.targetId = null;
          return null;
        }
        if (!isInt(cmd.id)) return 'Некорректная цель';
        if (cmd.id === ship.id) return 'Нельзя выбрать себя';
        if (!this.findTarget(sys, cmd.id)) return 'Цель не найдена';
        ship.targetId = cmd.id;
        return null;
      case 'mineResource':
        if (cmd.resource !== null && !RESOURCES.includes(cmd.resource)) return 'Нет такого ресурса';
        ship.mineResource = cmd.resource;
        return null;
      case 'build':
        if (!isInt(cmd.x) || !isInt(cmd.y)) return 'Некорректная клетка';
        if (typeof cmd.kind !== 'string' || !(isModuleType(cmd.kind) || ['floor', 'wall', 'door'].includes(cmd.kind))) {
          return 'Неизвестная постройка';
        }
        return placeBlueprint(ship, this.nextId(), cmd.x, cmd.y, cmd.kind as BuildKind);
      case 'remove':
        if (!isInt(cmd.x) || !isInt(cmd.y)) return 'Некорректная клетка';
        return placeRemoval(ship, this.nextId(), cmd.x, cmd.y, this.nextId);
      case 'urgent':
        if (!isInt(cmd.x) || !isInt(cmd.y) || cmd.x < 0 || cmd.y < 0 || cmd.x >= ship.w || cmd.y >= ship.h) return 'Некорректная клетка';
        return toggleUrgent(ship, cmd.x, cmd.y);
      case 'toggle': {
        const m = ship.modules.find((o) => o.id === cmd.moduleId);
        if (!m) return 'Нет такого модуля';
        m.enabled = !m.enabled;
        recomputeStats(ship);
        return null;
      }
      case 'cryo':
        if (!isInt(cmd.crewId)) return 'Некорректный член экипажа';
        return orderCryo(ship, cmd.crewId);
      case 'setPriority':
        if (!isInt(cmd.crewId) || typeof cmd.kind !== 'string' || !isInt(cmd.value)) return 'Некорректный приоритет';
        return setPriority(ship, cmd.crewId, cmd.kind, cmd.value, this.nextId);
      case 'order':
        if (!isInt(cmd.crewId) || !isInt(cmd.x) || !isInt(cmd.y)) return 'Некорректный приказ';
        return orderMove(ship, cmd.crewId, cmd.x, cmd.y, this.nextId);
      case 'draft':
        if (!isInt(cmd.crewId) || typeof cmd.on !== 'boolean') return 'Некорректный приказ';
        return setDraft(ship, cmd.crewId, cmd.on, this.nextId);
      case 'clearOrder':
        if (!isInt(cmd.crewId)) return 'Некорректный приказ';
        return clearOrder(ship, cmd.crewId);
      case 'expedition':
        return this.startExpedition(player, ship, cmd.planetId, cmd.crewIds);
      case 'recall': {
        const e = this.state.expeditions.find((x) => x.id === cmd.expeditionId && x.ownerId === player.id);
        if (!e) return 'Нет такой экспедиции';
        e.timeLeft = Math.min(e.timeLeft, 5);
        return null;
      }
      case 'trade':
        return this.trade(ship, cmd.resource, cmd.amount);
      case 'recruit': {
        if (!this.marketNear(ship)) return 'Нанять команду можно только у станции или колонии';
        if (this.totalCrew(ship) >= HULLS[ship.hull].crewCap) return 'Корабль переполнен — нужен корпус побольше';
        const cost = cmd.robot ? ROBOT_COST : RECRUIT_COST;
        if (ship.res.credits < cost) return `Нужно ${cost} кредитов`;
        ship.res.credits -= cost;
        const c = cmd.robot ? makeRobot(this.rng, this.nextId(), 0, 0) : randomCrew(this.rng, this.nextId(), 0, 0);
        placeCrewOnBoard(ship, c);
        this.log(player, `На борт поднимается ${c.name}.`, 'good');
        return null;
      }
      case 'upgrade': {
        if (!this.marketNear(ship)) return 'Сменить корпус можно только у станции или колонии';
        const next = HULLS[ship.hull].next;
        if (!next) return 'Это уже самый большой корпус';
        const cost = HULLS[next].cost!;
        if (!hasResources(ship.res, cost)) return `Нужно: ${formatLoot(cost)}`;
        if (!takeShip(ship, cost)) return `Нужно: ${formatLoot(cost)}`;
        upgradeHull(ship, next, this.nextId);
        this.log(player, `Корабль перестроен в класс «${HULLS[next].name}». Вся ваша постройка сохранена.`, 'good');
        return null;
      }
      case 'repair': {
        if (!this.marketNear(ship)) return 'Ремонт корпуса — только у станции или колонии';
        const missing = HULLS[ship.hull].maxHp - ship.hp;
        if (missing <= 0) return 'Корпус цел';
        const affordable = Math.min(missing, ship.res.credits / HULL_REPAIR_COST_PER_HP);
        if (affordable < 1) return 'Не хватает кредитов';
        ship.res.credits -= Math.ceil(affordable * HULL_REPAIR_COST_PER_HP);
        ship.hp += affordable;
        return null;
      }
      case 'jump': {
        if (!isInt(cmd.systemId) || cmd.systemId < 0 || cmd.systemId >= STAR_SYSTEMS.length) return 'Нет такой системы';
        if (cmd.systemId === ship.systemId) return 'Вы уже здесь';
        if (ship.jump) return 'Прыжок уже заряжается';
        const engines = ship.modules.filter((m) => m.type === 'engine' && functional(m)).length;
        const range = jumpRange(engines);
        const d = systemDistance(ship.systemId, cmd.systemId);
        if (d > range) return `Слишком далеко: ${d.toFixed(1)} св. лет, дальность ${range.toFixed(1)}`;
        if (!hasResources(ship.res, JUMP_FUEL)) return `Нужно топливо: ${formatLoot(JUMP_FUEL)}`;
        if (!takeShip(ship, JUMP_FUEL)) return `Нужно топливо: ${formatLoot(JUMP_FUEL)}`;
        ship.jump = { systemId: cmd.systemId, timeLeft: JUMP_CHARGE_SECONDS };
        this.log(player, `Зарядка гиперпрыжка в «${STAR_SYSTEMS[cmd.systemId].name}»… Нужны пилот и работающий двигатель.`, 'info');
        return null;
      }
      case 'stockpile': {
        if (!isInt(cmd.x) || !isInt(cmd.y) || typeof cmd.on !== 'boolean') return 'Некорректная зона склада';
        if (cmd.x < 0 || cmd.y < 0 || cmd.x >= ship.w || cmd.y >= ship.h) return 'Вне корпуса';
        const tile = ship.tiles[cmd.y * ship.w + cmd.x];
        if (tile !== 'floor' && tile !== 'door') return 'Склад только на полу';
        const idx = cmd.y * ship.w + cmd.x;
        const has = ship.stockpile.includes(idx);
        if (cmd.on && !has) ship.stockpile.push(idx);
        if (!cmd.on && has) ship.stockpile = ship.stockpile.filter((t) => t !== idx);
        syncStored(ship);
        return null;
      }
      default:
        return 'Неизвестная команда';
    }
  }

  private startExpedition(player: Player, ship: Ship, planetId: unknown, crewIds: unknown): string | null {
    const sys = this.state.systems[ship.systemId];
    const planet = sys.planets.find((p) => p.id === planetId);
    if (!planet) return 'Нет такой планеты';
    if (dist(planet, ship) > planet.r + ORBIT_RANGE + shipRadius(ship)) return 'Подлетите к планете ближе';
    if (!Array.isArray(crewIds) || !crewIds.length || crewIds.length > EXPEDITION_MAX_CREW) {
      return `Выберите от 1 до ${EXPEDITION_MAX_CREW} членов экипажа`;
    }
    const crew = ship.crew.filter((c) => crewIds.includes(c.id) && c.state !== 'cryo');
    if (crew.length !== new Set(crewIds).size) return 'Кого-то из выбранных нет на борту (или спит в криокапсуле)';
    if (crew.length >= ship.crew.filter((c) => c.state !== 'cryo').length) return 'Кто-то должен остаться на борту';
    for (const c of crew) {
      dropCarry(ship, c, this.nextId);
      c.job = null;
      c.path = [];
      c.order = null;
      c.draft = false;
      c.state = 'idle';
    }
    ship.crew = ship.crew.filter((c) => !crew.includes(c));
    this.state.expeditions.push({
      id: this.nextId(),
      shipId: ship.id,
      ownerId: player.id,
      systemId: ship.systemId,
      planetId: planet.id,
      crew,
      timeLeft: EXPEDITION_SECONDS,
      rollTimer: EXPEDITION_ROLL_SECONDS,
      loot: {},
    });
    this.log(player, `Шаттл уходит на ${planet.name} (${BIOMES[planet.biome].name}): ${crew.map((c) => c.name).join(', ')}.`, 'info');
    return null;
  }

  private trade(ship: Ship, resource: unknown, amount: unknown): string | null {
    const market = this.marketNear(ship);
    if (!market) return 'Торговать можно только у станции или на орбите колонии';
    if (typeof resource !== 'string' || !TRADEABLE.includes(resource as Exclude<Resource, 'credits'>)) return 'Этим не торгуют';
    if (!isInt(amount) || amount === 0 || Math.abs(amount) > 1000) return 'Некорректное количество';
    const r = resource as Exclude<Resource, 'credits'>;
    const price = market.price[r] ?? SELL_PRICE[r];
    if (amount > 0) {
      const cost = Math.ceil(price * BUY_MARKUP * amount);
      if ((market.stock[r] ?? 0) < amount) return 'На складе столько нет';
      if (ship.res.credits < cost) return `Нужно ${cost} кредитов`;
      ship.res.credits -= cost;
      putInStockpile(ship, r, amount, this.nextId);
      market.stock[r] = (market.stock[r] ?? 0) - amount;
    } else {
      const qty = -amount;
      if (ship.res[r] < qty) return 'У вас столько нет';
      removeStored(ship, r, qty);
      ship.res.credits += Math.floor(price * qty);
      market.stock[r] = (market.stock[r] ?? 0) + qty;
    }
    return null;
  }

  // ---------- Снимок для клиента ----------

  private layoutView(ship: Ship): LayoutView {
    return {
      w: ship.w,
      h: ship.h,
      tiles: ship.tiles.map((t) => TILE_CHARS[t]).join(''),
      version: ship.layoutVersion,
      modules: ship.modules.map((m) => [m.type, m.x, m.y]),
    };
  }

  private ownShipView(ship: Ship, sys: StarSystem): OwnShipView {
    const rooms = shipRooms(ship);
    const market = this.marketNear(ship);
    const engines = ship.modules.filter((m) => m.type === 'engine' && functional(m)).length;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      id: ship.id,
      name: ship.name,
      hull: ship.hull,
      x: ship.x,
      y: ship.y,
      vx: ship.vx,
      vy: ship.vy,
      hp: ship.hp,
      maxHp: HULLS[ship.hull].maxHp,
      shield: ship.shield,
      maxShield: ship.stats.maxShield,
      oxygen: ship.oxygen,
      oxygenCap: ship.stats.oxygenCap,
      roomAir: rooms.rooms.map((r) => r2(ship.air[r.tiles[0]] ?? 0)),
      battery: ship.battery,
      batteryCap: ship.stats.batteryCap,
      powerOutput: ship.stats.powerOutput,
      powerDemand: ship.stats.powerDemand,
      maxSpeed: ship.stats.maxSpeed,
      sensorRange: ship.stats.sensorRange,
      piloted: ship.stats.piloted,
      crewCap: HULLS[ship.hull].crewCap,
      jumpRange: jumpRange(engines),
      jump: ship.jump,
      moveTarget: ship.moveTarget,
      targetId: ship.targetId,
      mineResource: ship.mineResource,
      res: { ...ship.res },
      modules: ship.modules.map((m) => ({
        id: m.id,
        type: m.type,
        x: m.x,
        y: m.y,
        hp: m.hp,
        enabled: m.enabled,
        powered: m.powered,
        active: m.active,
        growth: m.growth,
      })),
      blueprints: ship.blueprints.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        kind: b.kind,
        remove: b.remove,
        progress: 1 - b.work / b.workTotal,
        ready: materialsReady(b),
      })),
      stacks: ship.stacks.map((s) => ({
        x: s.x,
        y: s.y,
        resource: s.resource,
        amount: Math.round(s.amount * 100) / 100,
      })),
      stockpile: [...ship.stockpile],
      crew: ship.crew.map((c) => ({
        id: c.id,
        name: c.name,
        robot: c.robot,
        x: Math.round(c.x * 100) / 100,
        y: Math.round(c.y * 100) / 100,
        health: c.health,
        food: c.food,
        rest: c.rest,
        state: c.state,
        job: c.job?.kind ?? null,
        skills: c.skills,
        priorities: { ...c.priorities },
        carry: c.carry ? { resource: c.carry.resource, amount: Math.round(c.carry.amount * 100) / 100 } : null,
        draft: c.draft,
        order: c.order ? { x: c.order.x, y: c.order.y } : null,
      })),
      fires: Object.entries(ship.fires).map(([t, v]) => [Number(t), r2(v)]),
      urgent: [...ship.urgent],
      marketId: market?.hostId ?? null,
      orbitId: this.orbitOf(ship)?.id ?? null,
      inSafeZone: this.inSafeZone(sys, ship),
    };
  }

  snapshotFor(playerId: number, cache: ClientCache): Snapshot {
    const player = this.player(playerId)!;
    const ship = this.shipOf(player);
    const systemId = ship?.systemId ?? 0;
    const sys = this.state.systems[systemId];
    const center: Vec = ship ?? sys.stations[0] ?? { x: 0, y: 0 };
    const range = ship?.stats.sensorRange ?? 1200;
    const visible = (p: Vec, pad = 0) => dist(p, center) <= range + pad;
    const scanner = !!ship?.modules.some((m) => m.type === 'radar' && functional(m) && m.powered);

    const contacts: Contact[] = [];
    for (const p of sys.planets) contacts.push({ k: 'planet', id: p.id, x: p.x, y: p.y, r: p.r, name: p.name, biome: p.biome, colony: p.colony });
    for (const s of sys.stations) contacts.push({ k: 'station', id: s.id, x: s.x, y: s.y, r: s.r, name: s.name });
    const layouts: Record<number, LayoutView> = {};
    const sendLayout = (s: Ship) => {
      if (cache.layouts.get(s.id) !== s.layoutVersion) {
        layouts[s.id] = this.layoutView(s);
        cache.layouts.set(s.id, s.layoutVersion);
      }
    };
    if (ship) sendLayout(ship);
    for (const s of this.activeShips(systemId)) {
      if (s === ship || !visible(s, shipRadius(s))) continue;
      sendLayout(s);
      const target = s.targetId !== null ? sys.asteroids.find((a) => a.id === s.targetId) : undefined;
      contacts.push({
        k: 'ship',
        id: s.id,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        r: shipRadius(s),
        name: s.name,
        owner: this.ownerOf(s)?.name ?? '?',
        hull: s.hull,
        hp: s.hp,
        maxHp: HULLS[s.hull].maxHp,
        shield: s.shield,
        maxShield: s.stats.maxShield,
        layoutVersion: s.layoutVersion,
        miningId: target && s.modules.some((m) => m.type === 'mining_laser' && m.active) ? target.id : null,
        jumping: !!s.jump,
      });
    }
    for (const n of sys.npcs) {
      if (!visible(n, 50)) continue;
      contacts.push({ k: 'npc', id: n.id, type: n.type, x: n.x, y: n.y, vx: n.vx, vy: n.vy, heading: n.heading, hp: n.hp, shield: n.shield, hostile: n.targetShipId !== null });
    }
    for (const a of sys.asteroids) {
      if (!visible(a, a.r)) continue;
      const res: Partial<Record<Resource, number>> = {};
      for (const [k, v] of Object.entries(a.res)) if ((v ?? 0) > 0) res[k as Resource] = scanner ? Math.round(v!) : -1;
      contacts.push({ k: 'asteroid', id: a.id, x: a.x, y: a.y, r: a.r, res });
    }
    for (const l of sys.loot) if (visible(l)) contacts.push({ k: 'loot', id: l.id, x: l.x, y: l.y, res: l.res });
    for (const p of sys.projectiles) if (visible(p)) contacts.push({ k: 'projectile', id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, kind: p.kind });

    const market = ship ? this.marketNear(ship) : null;
    const chat = this.state.chat.filter((c) => c.seq > cache.chatSeq);
    cache.chatSeq = this.state.chatSeq;
    const log = player.inbox;
    player.inbox = [];
    const population = STAR_SYSTEMS.map((_, i) => this.activeShips(i).length);

    return {
      t: 'snap',
      tick: this.state.tick,
      me: { id: player.id, name: player.name, kills: player.kills, deaths: player.deaths, respawnIn: Math.max(0, player.respawnIn) },
      systemId,
      ship: ship ? this.ownShipView(ship, sys) : null,
      contacts,
      layouts,
      market: market
        ? { hostId: market.hostId, name: this.marketName(sys, market), stock: { ...market.stock }, price: { ...market.price }, refreshIn: market.refreshIn }
        : null,
      expeditions: this.state.expeditions
        .filter((e) => e.ownerId === player.id)
        .map((e) => {
          const planet = this.state.systems[e.systemId].planets.find((p) => p.id === e.planetId)!;
          return {
            id: e.id,
            planetId: e.planetId,
            planetName: planet.name,
            biome: planet.biome,
            crew: e.crew.map((c) => ({ id: c.id, name: c.name, health: c.health })),
            timeLeft: Math.max(0, e.timeLeft),
            loot: { ...e.loot },
          };
        }),
      fx: sys.fx.filter((f) => ('x' in f ? visible(f, 100) : visible({ x: f.x1, y: f.y1 }, 600))),
      log,
      chat,
      population,
    };
  }
}
