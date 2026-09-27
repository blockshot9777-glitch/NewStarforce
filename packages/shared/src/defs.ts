// Игровые данные: ресурсы, модули, корпуса, биомы, фракции.
// Весь баланс живёт здесь, чтобы его можно было крутить, не трогая логику.

export const TICK_RATE = 10;
export const DT = 1 / TICK_RATE;
export const SECTOR_SIZE = 8000;
export const SAFE_ZONE_RADIUS = 600;
export const DOCK_RANGE = 260;
export const ORBIT_RANGE = 160;
export const RESPAWN_SECONDS = 5;

// ---------- Ресурсы ----------

export const RESOURCES = ['metal', 'ice', 'water', 'crystals', 'biomass', 'food', 'credits'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Resources = Record<Resource, number>;

export const RESOURCE_NAMES: Record<Resource, string> = {
  metal: 'Металл',
  ice: 'Лёд',
  water: 'Вода',
  crystals: 'Кристаллы',
  biomass: 'Биомасса',
  food: 'Еда',
  credits: 'Кредиты',
};

/** Цена продажи станции; покупка дороже в BUY_MARKUP раз. Кредиты не торгуются. */
export const SELL_PRICE: Record<Exclude<Resource, 'credits'>, number> = {
  metal: 2,
  ice: 1,
  water: 2,
  crystals: 8,
  biomass: 3,
  food: 4,
};
export const BUY_MARKUP = 1.5;
export const RECRUIT_COST = 150;
export const ROBOT_COST = 320;
export const ROBOT_SPEED_MULT = 0.5;
export const MARKET_REFRESH_SECONDS = 300;
export const MARKET_STOCK: Record<Exclude<Resource, 'credits'>, [number, number]> = {
  metal: [80, 200],
  ice: [60, 160],
  water: [30, 90],
  crystals: [10, 40],
  biomass: [20, 60],
  food: [30, 80],
};

/** Расстояние от звезды, на котором солнечная панель выдаёт номинал. */
export const SOLAR_NOMINAL_DISTANCE = 1800;

export function solarFactor(distanceToStar: number): number {
  return Math.max(0.15, Math.min(1.5, SOLAR_NOMINAL_DISTANCE / Math.max(1, distanceToStar)));
}

// ---------- Метеориты и пожары ----------
/** Метеоритов в секунду в самом центре пояса астероидов. */
export const METEOR_RATE_IN_BELT = 1 / 25;
export const METEOR_BELT_FALLOFF = 700;
export const FIRE_GROWTH = 0.08;
export const FIRE_O2_USE = 0.15;
export const FIRE_MIN_AIR = 0.15;
export const FIRE_SPREAD = 0.06;
export const HULL_REPAIR_COST_PER_HP = 0.5;

export function emptyResources(): Resources {
  return { metal: 0, ice: 0, water: 0, crystals: 0, biomass: 0, food: 0, credits: 0 };
}

// ---------- Плитки и модули ----------

export type Tile = 'empty' | 'floor' | 'wall' | 'door';
export const TILE_CHARS: Record<Tile, string> = { empty: ' ', floor: '_', wall: '#', door: '+' };
export const CHAR_TILES: Record<string, Tile> = { ' ': 'empty', _: 'floor', '#': 'wall', '+': 'door' };

export const STRUCTURE_COST: Record<Exclude<Tile, 'empty'>, Partial<Resources>> = {
  floor: { metal: 2 },
  wall: { metal: 4 },
  door: { metal: 6 },
};
export const STRUCTURE_WORK: Record<Exclude<Tile, 'empty'>, number> = { floor: 2, wall: 3, door: 4 };

export type ModuleType =
  | 'bridge'
  | 'reactor'
  | 'battery'
  | 'engine'
  | 'o2gen'
  | 'water_recycler'
  | 'hydroponics'
  | 'bed'
  | 'medbay'
  | 'shield_gen'
  | 'laser'
  | 'missile'
  | 'radar'
  | 'mining_laser'
  | 'lamp'
  | 'solar_panel'
  | 'cryopod';

export type BuildCategory = 'orders' | 'tiles' | 'power' | 'air' | 'water' | 'food' | 'furniture' | 'medicine' | 'security' | 'ship';

export const CATEGORY_NAMES: Record<BuildCategory, string> = {
  orders: 'Приказы',
  tiles: 'Плитка',
  power: 'Энергия',
  air: 'Воздух',
  water: 'Вода',
  food: 'Еда',
  furniture: 'Мебель',
  medicine: 'Медицина',
  security: 'Безопасность',
  ship: 'Корабль',
};

export interface ModuleDef {
  name: string;
  desc: string;
  cost: Partial<Resources>;
  /** Секунды работы строителя со средним навыком. */
  work: number;
  maxHp: number;
  /** Производство энергии (>0). */
  output?: number;
  /** Потребление, пока модуль активен. */
  demand: number;
  /** Потребление в простое (двигатели, буры). */
  idleDemand?: number;
  /** Меньше — раньше получает энергию при дефиците. */
  priority: number;
  category: BuildCategory;
  /** Ставится только вплотную к внешней стене корпуса (турели, двигатели, буры). */
  hullMount?: boolean;
  /** Радиус света в клетках, если модуль освещает отсек. */
  light?: number;
  glyph: string;
  color: string;
}

export const MODULES: Record<ModuleType, ModuleDef> = {
  bridge: {
    name: 'Мостик',
    desc: 'Пульт пилота. Без пилота корабль не летит.',
    cost: { metal: 30, crystals: 2 },
    work: 10,
    maxHp: 80,
    demand: 1,
    priority: 0,
    category: 'ship',
    light: 2,
    glyph: 'П',
    color: '#4fc3f7',
  },
  reactor: {
    name: 'Реактор',
    desc: 'Даёт 30 ед. энергии.',
    cost: { metal: 40, crystals: 8 },
    work: 12,
    maxHp: 100,
    output: 30,
    demand: 0,
    priority: 0,
    category: 'power',
    light: 3,
    glyph: 'Р',
    color: '#ffb300',
  },
  battery: {
    name: 'Аккумулятор',
    desc: 'Запасает 150 ед. энергии на случай дефицита.',
    cost: { metal: 20, crystals: 3 },
    work: 6,
    maxHp: 60,
    demand: 0,
    priority: 0,
    category: 'power',
    glyph: 'А',
    color: '#c0ca33',
  },
  engine: {
    name: 'Двигатель',
    desc: 'Разгон и гиперпрыжок. Без двигателей корабль ползёт на маневровых (50% скорости). Ставится у внешней стены.',
    cost: { metal: 35, crystals: 4 },
    work: 10,
    maxHp: 90,
    demand: 6,
    idleDemand: 0.5,
    priority: 3,
    category: 'ship',
    hullMount: true,
    glyph: 'Д',
    color: '#ff7043',
  },
  o2gen: {
    name: 'Генератор O₂',
    desc: 'Вода + энергия → кислород в своей комнате. Через двери воздух перетекает.',
    cost: { metal: 25, crystals: 2 },
    work: 8,
    maxHp: 60,
    demand: 5,
    priority: 1,
    category: 'air',
    glyph: 'O',
    color: '#80deea',
  },
  water_recycler: {
    name: 'Водоочиститель',
    desc: 'Растапливает и очищает лёд в воду.',
    cost: { metal: 20 },
    work: 6,
    maxHp: 60,
    demand: 3,
    priority: 1,
    category: 'water',
    glyph: 'В',
    color: '#29b6f6',
  },
  hydroponics: {
    name: 'Гидропоника',
    desc: 'Растит еду на воде. Урожай собирает экипаж.',
    cost: { metal: 15, biomass: 5 },
    work: 6,
    maxHp: 40,
    demand: 3,
    priority: 2,
    category: 'food',
    light: 2,
    glyph: 'Г',
    color: '#66bb6a',
  },
  bed: {
    name: 'Койка',
    desc: 'Сон в койке восстанавливает вдвое быстрее.',
    cost: { metal: 8, biomass: 2 },
    work: 3,
    maxHp: 30,
    demand: 0,
    priority: 0,
    category: 'furniture',
    glyph: 'К',
    color: '#8d6e63',
  },
  medbay: {
    name: 'Медотсек',
    desc: 'Лечит членов экипажа.',
    cost: { metal: 30, crystals: 6, biomass: 5 },
    work: 10,
    maxHp: 50,
    demand: 4,
    priority: 1,
    category: 'medicine',
    light: 2,
    glyph: '✚',
    color: '#ef5350',
  },
  shield_gen: {
    name: 'Щит',
    desc: '+60 к щиту корабля, восстановление 4/с.',
    cost: { metal: 40, crystals: 12 },
    work: 12,
    maxHp: 70,
    demand: 6,
    priority: 2,
    category: 'security',
    glyph: 'Щ',
    color: '#7e57c2',
  },
  laser: {
    name: 'Лазер',
    desc: 'Турель: урон 6, дальность 500, щит блокирует полностью. Ставится у внешней стены.',
    cost: { metal: 30, crystals: 5 },
    work: 8,
    maxHp: 60,
    demand: 3,
    priority: 2,
    category: 'security',
    hullMount: true,
    glyph: 'Л',
    color: '#e53935',
  },
  missile: {
    name: 'Ракетница',
    desc: 'Урон 22, дальность 800, половина урона проходит сквозь щит. 1 металл за ракету. Ставится у внешней стены.',
    cost: { metal: 45, crystals: 8 },
    work: 10,
    maxHp: 70,
    demand: 2,
    priority: 2,
    category: 'security',
    hullMount: true,
    glyph: 'Ф',
    color: '#ff8a65',
  },
  radar: {
    name: 'Радар',
    desc: 'Удваивает дальность обзора.',
    cost: { metal: 25, crystals: 6 },
    work: 8,
    maxHp: 40,
    demand: 2,
    priority: 3,
    category: 'ship',
    glyph: '◎',
    color: '#26a69a',
  },
  mining_laser: {
    name: 'Буровой лазер',
    desc: 'Откалывает от астероида контейнеры с рудой; луч притягивает их к кораблю.',
    cost: { metal: 25, crystals: 3 },
    work: 8,
    maxHp: 50,
    demand: 6,
    idleDemand: 0.3,
    priority: 4,
    category: 'ship',
    hullMount: true,
    glyph: 'Б',
    color: '#fdd835',
  },
  lamp: {
    name: 'Лампа',
    desc: 'Освещает отсек. В темноте экипаж работает медленнее.',
    cost: { metal: 3 },
    work: 2,
    maxHp: 20,
    demand: 0.2,
    priority: 1,
    category: 'furniture',
    light: 4,
    glyph: '☀',
    color: '#fff59d',
  },
  solar_panel: {
    name: 'Солнечная панель',
    desc: 'Даёт до 12 ед. энергии; чем дальше от звезды, тем слабее. Ставится у внешней стены.',
    cost: { metal: 15 },
    work: 5,
    maxHp: 30,
    output: 12,
    demand: 0,
    priority: 0,
    category: 'power',
    hullMount: true,
    glyph: '▦',
    color: '#5c6bc0',
  },
  cryopod: {
    name: 'Криокапсула',
    desc: 'Спящий в капсуле не ест, не дышит и не горит. Без питания — пробуждение.',
    cost: { metal: 25, crystals: 4 },
    work: 8,
    maxHp: 50,
    demand: 1.5,
    priority: 0,
    category: 'medicine',
    glyph: '❄',
    color: '#4dd0e1',
  },
};

export const MODULE_TYPES = Object.keys(MODULES) as ModuleType[];
export const STRUCTURE_CATEGORY: BuildCategory = 'tiles';
/** Работа в темноте идёт медленнее. */
export const DARK_WORK_MULT = 0.6;
export type BuildKind = ModuleType | Exclude<Tile, 'empty'>;

export function isModuleType(kind: string): kind is ModuleType {
  return kind in MODULES;
}

export function buildCost(kind: BuildKind): Partial<Resources> {
  return isModuleType(kind) ? MODULES[kind].cost : STRUCTURE_COST[kind];
}

export function buildWork(kind: BuildKind): number {
  return isModuleType(kind) ? MODULES[kind].work : STRUCTURE_WORK[kind];
}

// ---------- Числа систем корабля ----------

export const BATTERY_CAPACITY = 150;
export const SHIELD_PER_GEN = 60;
export const SHIELD_REGEN_PER_GEN = 4;
/** Размер клетки корабля в единицах космоса: интерьер рисуется прямо на карте сектора. */
export const TILE_WORLD = 8;
export const O2_PER_TILE = 2;
export const O2_GEN_RATE = 0.8;
/** Доля разницы концентраций, выравниваемая через открытую дверь за секунду. */
export const DOOR_FLOW = 0.8;
/** То же для закрытой двери — небольшая негерметичность. */
export const DOOR_LEAK = 0.02;
/** Доля воздуха, теряемая за секунду комнатой с пробоиной. */
export const VENT_LOSS = 1.5;
/** Ниже этой концентрации экипаж задыхается. */
export const SUFFOCATE_BELOW = 0.25;
export const TRACTOR_RANGE = 320;
export const TRACTOR_SPEED = 160;
export const LOOT_TTL = 120;
export const MINING_CHUNK = 3;
export const O2_GEN_WATER = 0.05;
export const WATER_RECYCLE_RATE = 0.1;
export const HYDRO_GROW_SECONDS = 90;
export const HYDRO_WATER = 0.03;
export const HYDRO_YIELD = 3;
export const BASE_SENSOR_RANGE = 900;
export const RADAR_BONUS = 900;
export const MINING_RANGE = 240;
export const MINING_RATE = 1.5;

export interface WeaponDef {
  damage: number;
  cooldown: number;
  range: number;
  /** Доля урона, проходящая мимо щита. */
  pierce: number;
  projectileSpeed?: number;
  ammo?: Partial<Resources>;
}

export const WEAPONS: Partial<Record<ModuleType, WeaponDef>> = {
  laser: { damage: 6, cooldown: 1, range: 500, pierce: 0 },
  missile: { damage: 22, cooldown: 4, range: 800, pierce: 0.5, projectileSpeed: 260, ammo: { metal: 1 } },
};

// ---------- Экипаж ----------

export const CREW_SPEED = 3; // плиток в секунду
export const FOOD_DECAY = 100 / 360;
export const REST_DECAY = 100 / 480;
export const O2_PER_CREW = 0.1;
export const EAT_SECONDS = 3;
export const EAT_RESTORE = 60;

export const CREW_FIRST_NAMES = [
  'Алина', 'Борис', 'Вера', 'Глеб', 'Дина', 'Егор', 'Жанна', 'Захар', 'Ива', 'Кир',
  'Лада', 'Макс', 'Нора', 'Олег', 'Полина', 'Рем', 'Сая', 'Тимур', 'Ульяна', 'Фёдор',
  'Хлоя', 'Юрий', 'Яра', 'Арсений', 'Мира', 'Лев', 'Ника', 'Родион', 'Ева', 'Стас',
];
export const CREW_LAST_NAMES = [
  'Орлов', 'Кейн', 'Волкова', 'Миронов', 'Сато', 'Рихтер', 'Лебедь', 'Нова', 'Грей', 'Зорин',
  'Ким', 'Штерн', 'Мельник', 'Ардо', 'Вега', 'Росс', 'Тарасова', 'Хан', 'Беляев', 'Ли',
];

// ---------- Корпуса ----------

export type HullClass = 'scout' | 'frigate' | 'cruiser';

export interface HullDef {
  name: string;
  w: number;
  h: number;
  maxHp: number;
  crewCap: number;
  baseSpeed: number;
  cost: Partial<Resources> | null;
  next: HullClass | null;
}

export const HULLS: Record<HullClass, HullDef> = {
  scout: { name: 'Скаут', w: 16, h: 9, maxHp: 200, crewCap: 4, baseSpeed: 90, cost: null, next: 'frigate' },
  frigate: {
    name: 'Фрегат',
    w: 24,
    h: 13,
    maxHp: 500,
    crewCap: 8,
    baseSpeed: 75,
    cost: { credits: 800, metal: 200 },
    next: 'cruiser',
  },
  cruiser: {
    name: 'Крейсер',
    w: 32,
    h: 17,
    maxHp: 1200,
    crewCap: 14,
    baseSpeed: 60,
    cost: { credits: 3000, metal: 800, crystals: 100 },
    next: null,
  },
};

/**
 * Стартовый корабль. '#' стена, '+' дверь, '_' пол, пробел — космос.
 * Буквы — модули на полу (см. STARTER_GLYPHS).
 */
export const STARTER_LAYOUT = [
  '##############',
  '#bbb#R_Z_#E_L#',
  '#___+____+___#',
  '#C_l#_O_W#_l_#',
  '#___+____#___#',
  '#H_H#M_S_#___#',
  '##############',
];

export const STARTER_GLYPHS: Record<string, ModuleType> = {
  b: 'bed',
  R: 'reactor',
  Z: 'battery',
  E: 'engine',
  C: 'bridge',
  O: 'o2gen',
  W: 'water_recycler',
  L: 'laser',
  H: 'hydroponics',
  M: 'mining_laser',
  S: 'shield_gen',
  l: 'lamp',
};

export const STARTER_RESOURCES: Resources = {
  metal: 60,
  ice: 30,
  water: 40,
  crystals: 5,
  biomass: 10,
  food: 40,
  credits: 200,
};
export const STARTER_CREW = 3;

// ---------- Планеты ----------

export type Biome = 'terran' | 'jungle' | 'ice' | 'desert' | 'volcanic' | 'ruins' | 'toxic';

export interface BiomeDef {
  name: string;
  color: string;
  glow: string;
  /** Вероятность опасного события за один бросок. */
  threat: number;
  loot: Partial<Record<Resource, [number, number]>>;
  dangers: string[];
  finds: string[];
}

export const BIOMES: Record<Biome, BiomeDef> = {
  terran: {
    name: 'Землеподобная',
    color: '#1e88e5',
    glow: '#90caf9',
    threat: 0.08,
    loot: { water: [4, 10], biomass: [2, 5], food: [1, 3] },
    dangers: ['{name} подвернул ногу в горах', 'Местный зверь укусил {name}'],
    finds: ['Чистый родник', 'Дикие злаки'],
  },
  jungle: {
    name: 'Живые джунгли',
    color: '#2e7d32',
    glow: '#76ff03',
    threat: 0.35,
    loot: { biomass: [4, 10], food: [1, 4] },
    dangers: ['Хищная лиана хлестнула {name}', 'Споры разумной рощи обожгли {name}', 'Корни-ловушки утащили {name} под землю'],
    finds: ['Съедобные плоды', 'Образцы живой древесины', 'Семенной банк'],
  },
  ice: {
    name: 'Ледяная пустошь',
    color: '#b3e5fc',
    glow: '#e1f5fe',
    threat: 0.15,
    loot: { ice: [6, 14] },
    dangers: ['{name} провалился в трещину', 'Буря обморозила {name}'],
    finds: ['Чистый ледник', 'Подлёдное озеро'],
  },
  desert: {
    name: 'Ржавая пустыня',
    color: '#bf6f3a',
    glow: '#ffcc80',
    threat: 0.2,
    loot: { metal: [5, 12] },
    dangers: ['Песчаная буря посекла {name}', '{name} наткнулся на старую мину'],
    finds: ['Жила железа', 'Обломки древнего корабля'],
  },
  volcanic: {
    name: 'Вулканический мир',
    color: '#8e2412',
    glow: '#ff6d00',
    threat: 0.4,
    loot: { crystals: [2, 5], metal: [2, 6] },
    dangers: ['Выброс лавы задел {name}', '{name} надышался серой'],
    finds: ['Кристаллическая друза', 'Застывший металл'],
  },
  ruins: {
    name: 'Руины машин',
    color: '#455a64',
    glow: '#ff1744',
    threat: 0.5,
    loot: { credits: [20, 60], crystals: [1, 4], metal: [4, 8] },
    dangers: ['Сторожевой дрон открыл огонь по {name}', 'Ловушка ИИ ударила током {name}'],
    finds: ['Процессорный блок', 'Склад запчастей', 'Архив до-войны'],
  },
  toxic: {
    name: 'Токсичные болота',
    color: '#827717',
    glow: '#eeff41',
    threat: 0.3,
    loot: { biomass: [3, 8], crystals: [1, 3] },
    dangers: ['Кислотный туман разъел скафандр {name}', 'Болотная тварь укусила {name}'],
    finds: ['Мутировавшие грибы', 'Кристаллы в иле'],
  },
};
export const BIOME_TYPES = Object.keys(BIOMES) as Biome[];

export const EXPEDITION_SECONDS = 40;
export const EXPEDITION_ROLL_SECONDS = 5;
export const EXPEDITION_MAX_CREW = 4;

// ---------- Враждебные фракции ----------

export type NpcType = 'drone' | 'sentinel' | 'sporecaster';

export interface NpcDef {
  name: string;
  faction: 'machines' | 'flora';
  maxHp: number;
  maxShield: number;
  shieldRegen: number;
  radius: number;
  speed: number;
  aggroRange: number;
  weapon: WeaponDef & { fx: 'laser' | 'spore' };
  loot: Partial<Record<Resource, [number, number]>>;
}

export const NPCS: Record<NpcType, NpcDef> = {
  drone: {
    name: 'Дрон-охотник',
    faction: 'machines',
    maxHp: 80,
    maxShield: 20,
    shieldRegen: 2,
    radius: 12,
    speed: 85,
    aggroRange: 700,
    weapon: { damage: 5, cooldown: 1.2, range: 450, pierce: 0, fx: 'laser' },
    loot: { metal: [20, 40], crystals: [2, 6], credits: [20, 50] },
  },
  sentinel: {
    name: 'Страж Машин',
    faction: 'machines',
    maxHp: 320,
    maxShield: 80,
    shieldRegen: 4,
    radius: 22,
    speed: 45,
    aggroRange: 800,
    weapon: { damage: 14, cooldown: 2, range: 600, pierce: 0.25, fx: 'laser' },
    loot: { metal: [80, 140], crystals: [10, 20], credits: [120, 220] },
  },
  sporecaster: {
    name: 'Спорокаст',
    faction: 'flora',
    maxHp: 140,
    maxShield: 0,
    shieldRegen: 0,
    radius: 20,
    speed: 25,
    aggroRange: 350,
    weapon: { damage: 10, cooldown: 2.5, range: 300, pierce: 0.5, projectileSpeed: 140, fx: 'spore' },
    loot: { biomass: [20, 40], food: [2, 6], credits: [10, 30] },
  },
};

// ---------- Звёздные системы ----------
// Каждая система — самостоятельная симуляция. Сейчас все они крутятся в одном процессе,
// но граница проведена так, чтобы позже вынести каждую систему в отдельный сервер-шард.

export interface StarSystemDef {
  name: string;
  /** Координаты на галактической карте, световые годы. */
  gx: number;
  gy: number;
  star: string;
  stations: string[];
  /** Планеты с колонией и рынком: [биом, название]. */
  colonies: [Biome, string][];
  asteroids: number;
  /** Сколько поясов астероидов. */
  belts: number;
  npcs: Record<NpcType, number>;
  biomes: Biome[];
}

export const STAR_SYSTEMS: StarSystemDef[] = [
  {
    name: 'Ковчег',
    gx: 0,
    gy: 0,
    star: '#ffe082',
    stations: ['Станция «Ковчег»'],
    colonies: [
      ['terran', 'Новая Земля'],
      ['desert', 'Красный Марс'],
    ],
    asteroids: 40,
    belts: 2,
    npcs: { drone: 6, sentinel: 0, sporecaster: 3 },
    biomes: ['ice', 'jungle', 'toxic'],
  },
  {
    name: 'Туманность Вейла',
    gx: 6,
    gy: -3,
    star: '#80d8ff',
    stations: ['Аванпост «Вейл»'],
    colonies: [],
    asteroids: 55,
    belts: 3,
    npcs: { drone: 8, sentinel: 1, sporecaster: 4 },
    biomes: ['ice', 'volcanic', 'toxic', 'desert'],
  },
  {
    name: 'Сад Спор',
    gx: 4,
    gy: 5,
    star: '#b9f6ca',
    stations: [],
    colonies: [['jungle', 'Эдем-7']],
    asteroids: 25,
    belts: 1,
    npcs: { drone: 2, sentinel: 0, sporecaster: 12 },
    biomes: ['jungle', 'toxic', 'jungle'],
  },
  {
    name: 'Пояс Машин',
    gx: 11,
    gy: 1,
    star: '#ff8a80',
    stations: [],
    colonies: [],
    asteroids: 60,
    belts: 3,
    npcs: { drone: 14, sentinel: 4, sporecaster: 0 },
    biomes: ['ruins', 'desert', 'volcanic', 'ruins'],
  },
];

export const JUMP_BASE_RANGE = 7;
export const JUMP_RANGE_PER_ENGINE = 2.5;
export const JUMP_CHARGE_SECONDS = 8;
export const JUMP_FUEL: Partial<Resources> = { crystals: 2 };

export function jumpRange(engines: number): number {
  return engines > 0 ? JUMP_BASE_RANGE + JUMP_RANGE_PER_ENGINE * (engines - 1) : 0;
}

export function systemDistance(a: number, b: number): number {
  const sa = STAR_SYSTEMS[a];
  const sb = STAR_SYSTEMS[b];
  return Math.hypot(sa.gx - sb.gx, sa.gy - sb.gy);
}
