// Сообщения между клиентом и сервером. Клиент только просит — всё решает сервер.
import type { Alert } from './alerts';
import type { Biome, BuildKind, CreatureType, HullClass, ModuleType, NpcType, Physical, Resource, Resources } from './defs';
import type { ChatEntry, CrewSkills, CrewState, Fx, JobKind, LogEntry, SurfaceActor, WorkPriority } from './state';

export const PROTOCOL_VERSION = 8;

export type Command =
  | { c: 'move'; x: number; y: number }
  | { c: 'stop' }
  | { c: 'target'; id: number | null }
  | { c: 'mineResource'; resource: Resource | null }
  | { c: 'build'; x: number; y: number; kind: BuildKind }
  | { c: 'remove'; x: number; y: number }
  | { c: 'urgent'; x: number; y: number }
  | { c: 'stockpile'; x: number; y: number; on: boolean }
  | { c: 'toggle'; moduleId: number }
  | { c: 'cryo'; crewId: number }
  | { c: 'setPriority'; crewId: number; kind: JobKind; value: WorkPriority }
  | { c: 'order'; crewId: number; x: number; y: number }
  | { c: 'draft'; crewId: number; on: boolean }
  | { c: 'clearOrder'; crewId: number }
  | { c: 'expedition'; planetId: number; crewIds: number[] }
  | { c: 'recall'; expeditionId: number }
  | { c: 'landMove'; expeditionId: number; crewId: number; x: number; y: number }
  | { c: 'landMark'; expeditionId: number; nodeId: number }
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
  /** Что несёт в руках, иначе null. */
  carry: { resource: Physical; amount: number } | null;
  /** Прямое управление: сама работу не берёт. */
  draft: boolean;
  /** Куда игрок отправил пешку, иначе null. */
  order: { x: number; y: number } | null;
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
  /** Средняя температура °C по комнатам, тот же порядок. */
  roomTemp: number[];
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
  blueprints: { id: number; x: number; y: number; kind: BuildKind; remove: boolean; progress: number; ready: boolean }[];
  /** Стопки на полу. В запасе корабля — только то, что лежит в зоне склада. */
  stacks: { x: number; y: number; resource: Physical; amount: number }[];
  stockpile: number[];
  crew: CrewView[];
  fires: [number, number][];
  urgent: string[];
  /** id станции/колонии, у которой можно торговать, или null. */
  marketId: number | null;
  /** id планеты, на орбите которой стоит корабль. */
  orbitId: number | null;
  inSafeZone: boolean;
  /** Предупреждения капитану (что вот-вот убьёт экипаж и что делать). */
  alerts: Alert[];
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

export interface SurfaceView {
  w: number;
  h: number;
  /** Рельеф (см. Surface.terrain) — только в первом снимке после начала высадки, дальше null. */
  terrain: string | null;
  shuttle: { x: number; y: number };
  elapsed: number;
  marked: number[];
  nodes: { id: number; x: number; y: number; kind: number; amount: number }[];
  creatures: { id: number; type: CreatureType; x: number; y: number; hp: number }[];
  crew: { id: number; name: string; robot: boolean; x: number; y: number; health: number; task: SurfaceActor['task'] }[];
}

export interface ExpeditionView {
  id: number;
  planetId: number;
  planetName: string;
  biome: Biome;
  loot: Partial<Resources>;
  returning: boolean;
  /** Все в шаттле, но корабль улетел из системы. */
  waitingForShip: boolean;
  surface: SurfaceView;
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
