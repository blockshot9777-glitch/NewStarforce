// Состояние мира на сервере. Только простые данные (без классов), чтобы всё легко сохранялось в JSON.
import type { Biome, BuildKind, HullClass, ModuleType, NpcType, Physical, Resource, Resources, Tile } from './defs';

export interface Vec {
  x: number;
  y: number;
}

export interface ShipModule {
  id: number;
  type: ModuleType;
  x: number;
  y: number;
  hp: number;
  enabled: boolean;
  /** Получил ли энергию в последнем тике. */
  powered: boolean;
  /** Активен ли прямо сейчас (для двигателей, буров, орудий). */
  active: boolean;
  cooldown: number;
  /** Рост гидропоники 0..1. */
  growth: number;
}

export interface Blueprint {
  id: number;
  x: number;
  y: number;
  kind: BuildKind;
  /** true — это приказ на разбор того, что стоит на клетке. */
  remove: boolean;
  /** Бесплатный чертёж (заделка пробоины) — при отмене ничего не возвращает. */
  free: boolean;
  work: number;
  workTotal: number;
  /** Сколько уже принесли к чертежу. Пока не хватает стоимости, стройка не начинается. */
  delivered: Partial<Resources>;
}

/** Стопка одного ресурса на клетке корабля. */
export interface ItemStack {
  id: number;
  x: number;
  y: number;
  resource: Physical;
  amount: number;
}

export type JobKind = 'build' | 'harvest' | 'repair' | 'pilot' | 'extinguish' | 'haul' | 'cryo';

/** 1 — берётся в первую очередь, 4 — в последнюю, 0 — эту работу не делает. */
export type WorkPriority = 0 | 1 | 2 | 3 | 4;

export const JOB_KINDS: readonly JobKind[] = ['extinguish', 'pilot', 'repair', 'haul', 'harvest', 'build', 'cryo'];

/** Как сейчас устроен общий порядок: пожар, мостик, ремонт, переноска, урожай и стройка. */
export function defaultPriorities(): Record<JobKind, WorkPriority> {
  return { extinguish: 1, pilot: 2, repair: 3, haul: 3, harvest: 4, build: 4, cryo: 1 };
}

export interface Job {
  kind: JobKind;
  /** id чертежа или модуля; для пожара — индекс клетки. */
  targetId: number;
  x: number;
  y: number;
  /** Куда и сколько нести. blueprintId — чертёж, иначе клетка склада. */
  haul?: { resource: Physical; amount: number; destX: number; destY: number; blueprintId: number | null };
}

export type CrewState = 'idle' | 'working' | 'eating' | 'sleeping' | 'healing' | 'cryo';

export interface CrewSkills {
  engineering: number;
  botany: number;
  piloting: number;
  combat: number;
}

export interface Crew {
  id: number;
  name: string;
  /** Робот: не ест, не спит, не дышит, но медленный. */
  robot: boolean;
  /** Координаты в клетках; целое значение — центр клетки. */
  x: number;
  y: number;
  path: Vec[];
  health: number;
  food: number;
  rest: number;
  skills: CrewSkills;
  /** Личные приоритеты работ. Криосон сюда входит для полноты типа, приказ им не управляется. */
  priorities: Record<JobKind, WorkPriority>;
  state: CrewState;
  job: Job | null;
  /** Что несёт в руках. Пока не положит — в складе этого нет. */
  carry: { resource: Physical; amount: number } | null;
  timer: number;
}

export interface Ship {
  id: number;
  ownerId: number;
  systemId: number;
  name: string;
  hull: HullClass;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  moveTarget: Vec | null;
  targetId: number | null;
  hp: number;
  shield: number;
  w: number;
  h: number;
  tiles: Tile[];
  layoutVersion: number;
  modules: ShipModule[];
  blueprints: Blueprint[];
  /** Стопки на полу. В «запасе» корабля только то, что лежит в зоне склада. */
  stacks: ItemStack[];
  /** Индексы клеток зоны склада. */
  stockpile: number[];
  crew: Crew[];
  /** Пожары: индекс клетки → интенсивность 0..1. */
  fires: Record<number, number>;
  /** Ключи задач, помеченных игроком как важные. */
  urgent: string[];
  /** Какой ресурс добывать из астероида (null — любой). */
  mineResource: Resource | null;
  /** Накопитель добычи бура. */
  mineProgress: number;
  res: Resources;
  /** Концентрация кислорода 0..1 на каждой клетке. */
  air: number[];
  /** Суммарный кислород на борту (для интерфейса). */
  oxygen: number;
  battery: number;
  /** Производные показатели, пересчитываются каждый тик. */
  stats: ShipStats;
  lastCombatTick: number;
  /** Идёт зарядка гиперпрыжка: куда и сколько осталось секунд. */
  jump: { systemId: number; timeLeft: number } | null;
}

export interface ShipStats {
  powerOutput: number;
  powerDemand: number;
  batteryCap: number;
  oxygenCap: number;
  maxShield: number;
  maxSpeed: number;
  sensorRange: number;
  piloted: boolean;
}

export interface Npc {
  id: number;
  type: NpcType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  hp: number;
  shield: number;
  cooldown: number;
  targetShipId: number | null;
  wander: Vec;
}

export interface Asteroid {
  id: number;
  x: number;
  y: number;
  r: number;
  res: Partial<Resources>;
}

export interface Planet {
  id: number;
  name: string;
  colony: boolean;
  biome: Biome;
  x: number;
  y: number;
  r: number;
}

export interface Station {
  id: number;
  name: string;
  x: number;
  y: number;
  r: number;
}

/** Контейнер с ресурсами в космосе: отколот буром, выпал из сбитого корабля. Его может подобрать любой. */
export interface Loot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  res: Partial<Resources>;
  ttl: number;
}

export interface Market {
  /** id станции или планеты-колонии. */
  hostId: number;
  stock: Partial<Record<Resource, number>>;
  price: Partial<Record<Resource, number>>;
  refreshIn: number;
}

export interface Belt {
  x: number;
  y: number;
  r: number;
}

export interface StarSystem {
  id: number;
  planets: Planet[];
  markets: Market[];
  belts: Belt[];
  stations: Station[];
  asteroids: Asteroid[];
  npcs: Npc[];
  loot: Loot[];
  projectiles: Projectile[];
  /** Визуальные эффекты текущего тика (не сохраняются). */
  fx: Fx[];
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  targetId: number;
  damage: number;
  pierce: number;
  kind: 'missile' | 'spore';
  /** id корабля игрока, либо -id NPC. */
  ownerShipId: number;
  life: number;
}

export interface Expedition {
  id: number;
  shipId: number;
  ownerId: number;
  systemId: number;
  planetId: number;
  crew: Crew[];
  timeLeft: number;
  rollTimer: number;
  loot: Partial<Resources>;
}

export interface Player {
  id: number;
  name: string;
  token: string;
  online: boolean;
  shipId: number | null;
  respawnIn: number;
  kills: number;
  deaths: number;
  inbox: LogEntry[];
}

export interface LogEntry {
  tick: number;
  text: string;
  level: 'info' | 'good' | 'warn' | 'bad';
}

export interface ChatEntry {
  seq: number;
  tick: number;
  from: string;
  text: string;
}

export type Fx =
  | { k: 'laser'; x1: number; y1: number; x2: number; y2: number; hostile: boolean }
  | { k: 'mine'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'hit'; x: number; y: number; shield: boolean }
  | { k: 'boom'; x: number; y: number; r: number };
