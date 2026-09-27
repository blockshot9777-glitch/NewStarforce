// Сообщения между клиентом и сервером. Клиент только просит — всё решает сервер.
import type { Biome, BuildKind, HullClass, ModuleType, NpcType, Resource, Resources } from './defs';
import type { ChatEntry, CrewSkills, CrewState, Fx, JobKind, LogEntry, WorkPriority } from './state';

export const PROTOCOL_VERSION = 2;

export type Command =
  | { c: 'move'; x: number; y: number }
  | { c: 'stop' }
  | { c: 'target'; id: number | null }
  | { c: 'mineResource'; resource: Resource | null }
  | { c: 'build'; x: number; y: number; kind: BuildKind }
  | { c: 'remove'; x: number; y: number }
  | { c: 'urgent'; x: number; y: number }
  | { c: 'toggle'; moduleId: number }
  | { c: 'cryo'; crewId: number }
  | { c: 'setPriority'; crewId: number; kind: JobKind; value: WorkPriority }
  | { c: 'expedition'; planetId: number; crewIds: number[] }
  | { c: 'recall'; expeditionId: number }
  | { c: 'trade'; resource: Resource; amount: number }
  | { c: 'recruit'; robot: boolean }
  | { c: 'upgrade' }
  | { c: 'repair' }
  | { c: 'jump'; systemId: number }
  | { c: 'chat'; text: string };

export type ClientMessage =
  | { t: 'join'; name: string; token: string; version: number }
  | { t: 'cmd'; cmd: Command };

export interface LayoutView {
  w: number;
  h: number;
  /** По символу на клетку, см. TILE_CHARS. */
  tiles: string;
  version: number;
  /** Модули для отрисовки чужих кораблей: [тип, x, y]. */
  modules: [ModuleType, number, number][];
}

export interface CrewView {
  id: number;
  name: string;
  robot: boolean;
  x: number;
  y: number;
  health: number;
  food: number;
  rest: number;
  state: CrewState;
  job: JobKind | null;
  skills: CrewSkills;
  priorities: Record<JobKind, WorkPriority>;
}

export interface ModuleView {
  id: number;
  type: ModuleType;
  x: number;
  y: number;
  hp: number;
  enabled: boolean;
  powered: boolean;
  active: boolean;
  growth: number;
}

export interface OwnShipView {
  id: number;
  name: string;
  hull: HullClass;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  oxygen: number;
  oxygenCap: number;
  /** Средняя концентрация O₂ по комнатам — порядок совпадает с computeRooms(layout). */
  roomAir: number[];
  battery: number;
  batteryCap: number;
  powerOutput: number;
  powerDemand: number;
  maxSpeed: number;
  sensorRange: number;
  piloted: boolean;
  crewCap: number;
  jumpRange: number;
  jump: { systemId: number; timeLeft: number } | null;
  moveTarget: { x: number; y: number } | null;
  targetId: number | null;
  mineResource: Resource | null;
  res: Resources;
  modules: ModuleView[];
  blueprints: { id: number; x: number; y: number; kind: BuildKind; remove: boolean; progress: number }[];
  crew: CrewView[];
  fires: [number, number][];
  urgent: string[];
  /** id станции/колонии, у которой можно торговать, или null. */
  marketId: number | null;
  /** id планеты, на орбите которой стоит корабль. */
  orbitId: number | null;
  inSafeZone: boolean;
}

export type Contact =
  | {
      k: 'ship';
      id: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      name: string;
      owner: string;
      hull: HullClass;
      hp: number;
      maxHp: number;
      shield: number;
      maxShield: number;
      layoutVersion: number;
      miningId: number | null;
      jumping: boolean;
    }
  | {
      k: 'npc';
      id: number;
      type: NpcType;
      x: number;
      y: number;
      vx: number;
      vy: number;
      heading: number;
      hp: number;
      shield: number;
      hostile: boolean;
    }
  | {
      k: 'asteroid';
      id: number;
      x: number;
      y: number;
      r: number;
      /** Количества видны только со сканером (запитанный радар), иначе -1. */
      res: Partial<Record<Resource, number>>;
    }
  | { k: 'loot'; id: number; x: number; y: number; res: Partial<Resources> }
  | { k: 'projectile'; id: number; x: number; y: number; vx: number; vy: number; kind: 'missile' | 'spore' }
  | { k: 'planet'; id: number; x: number; y: number; r: number; name: string; biome: Biome; colony: boolean }
  | { k: 'station'; id: number; x: number; y: number; r: number; name: string };

export interface MarketView {
  hostId: number;
  name: string;
  stock: Partial<Record<Resource, number>>;
  /** Цена продажи игроком; покупка — в BUY_MARKUP раз дороже. */
  price: Partial<Record<Resource, number>>;
  refreshIn: number;
}

export interface ExpeditionView {
  id: number;
  planetId: number;
  planetName: string;
  biome: Biome;
  crew: { id: number; name: string; health: number }[];
  timeLeft: number;
  loot: Partial<Resources>;
}

export interface Snapshot {
  t: 'snap';
  tick: number;
  me: { id: number; name: string; kills: number; deaths: number; respawnIn: number };
  systemId: number;
  ship: OwnShipView | null;
  contacts: Contact[];
  /** Планировки кораблей, которые клиент ещё не видел в этой версии. */
  layouts: Record<number, LayoutView>;
  market: MarketView | null;
  expeditions: ExpeditionView[];
  fx: Fx[];
  log: LogEntry[];
  chat: ChatEntry[];
  /** Игроков онлайн по системам. */
  population: number[];
}

export type ServerMessage =
  | { t: 'welcome'; playerId: number; token: string; tickRate: number }
  | Snapshot
  | { t: 'error'; msg: string };
