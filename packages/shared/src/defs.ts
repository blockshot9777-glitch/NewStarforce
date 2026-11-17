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

/** Всё, кроме кредитов, лежит стопками на полу и переносится руками. */
export const PHYSICAL = ['metal', 'ice', 'water', 'crystals', 'biomass', 'food'] as const;
export type Physical = (typeof PHYSICAL)[number];

/** Сколько одного ресурса влезает в стопку на клетке. */
export const STACK_MAX = 75;
/** Сколько человек уносит за один заход. */
export const CARRY_MAX = 35;

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
  | 'cryopod'
  | 'vent'
  | 'heater'
  | 'cooler';

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
  /** Прямоугольник клеток. Левый верх — точка постановки. Нет поля — одна клетка. */
  size?: readonly [number, number];
  /** Ставится в межкомнатную стену и соединяет воздух двух отсеков. */
  wallMount?: boolean;
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
  vent: {
    name: 'Вентиляция',
    desc: 'Решётка в стене между отсеками. Воздух идёт, даже если дверь закрыта.',
    cost: { metal: 8 },
    work: 4,
    maxHp: 40,
    demand: 0,
    priority: 0,
    category: 'air',
    wallMount: true,
    glyph: '▦',
    color: '#4dd0e1',
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
    desc: 'Лечит членов экипажа. Занимает 2×2 клетки.',
    size: [2, 2],
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
    desc: 'Даёт до 12 ед. энергии; чем дальше от звезды, тем слабее. Панель 2×1 у внешней стены.',
    size: [2, 1],
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
  heater: {
    name: 'Обогреватель',
    desc: 'Греет свой отсек. В тесноте может перегреть экипаж.',
    cost: { metal: 12 },
    work: 4,
    maxHp: 40,
    demand: 2,
    priority: 4,
    category: 'air',
    glyph: '♨',
    color: '#ff8f00',
  },
  cooler: {
    name: 'Охладитель',
    desc: 'Студит свой отсек. Без меры люди замерзают.',
    cost: { metal: 12, crystals: 1 },
    work: 4,
    maxHp: 40,
    demand: 2,
    priority: 4,
    category: 'air',
    glyph: 'Х',
    color: '#29b6f6',
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

/** Сколько клеток занимает модуль, слева направо и сверху вниз. */
export function moduleSize(type: ModuleType): readonly [number, number] {
  return MODULES[type].size ?? [1, 1];
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
/** Решётка гоняет воздух между отсеками слабее открытой двери, но всегда. */
export const VENT_FLOW = 0.55;
/** То же для закрытой двери — небольшая негерметичность. */
export const DOOR_LEAK = 0.02;
/** Доля воздуха, теряемая за секунду комнатой с пробоиной. */
export const VENT_LOSS = 1.5;
/** Комфорт экипажа, °C. Вне полосы люди теряют здоровье. */
export const TEMP_COMFORT_MIN = 10;
export const TEMP_COMFORT_MAX = 35;
export const TEMP_AMBIENT = 21;
/** К чему стынет разгерметизированный отсек. */
export const TEMP_SPACE = -80;
export const TEMP_MIN = -120;
export const TEMP_MAX = 120;
/** Доля разницы с целью за секунду: корпус почти держит тепло, пробоина — нет. */
export const TEMP_HULL_LEAK = 0.015;
export const TEMP_VENT_LEAK = 0.35;
/** °C/с на всю комнату, пока модуль запитан. Делится на число клеток. */
export const HEATER_DEG_PER_SEC = 12;
export const COOLER_DEG_PER_SEC = 12;
/** Потеря здоровья в секунду за каждый градус вне комфорта. */
export const TEMP_HURT = 0.15;
/** Ниже этой концентрации экипаж задыхается. */
export const SUFFOCATE_BELOW = 0.25;
export const TRACTOR_RANGE = 320;
export const TRACTOR_SPEED = 160;
export const LOOT_TTL = 120;
export const MINING_CHUNK = 3;
// Баланс воды: стартовый корабль без вмешательства игрока держится ~30 минут (тест «баланс»).
export const O2_GEN_WATER = 0.03;
export const WATER_RECYCLE_RATE = 0.1;
export const HYDRO_GROW_SECONDS = 90;
export const HYDRO_WATER = 0.015;
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
  ice: 60,
  water: 40,
  crystals: 5,
  biomass: 10,
  food: 40,
  credits: 200,
};
export const STARTER_CREW = 3;

// ---------- Предупреждения ----------
/** Окно сглаживания скорости расхода ресурсов, секунды. */
export const RATE_WINDOW_SECONDS = 30;
/** Скачки сильнее этого (торговля, подбор груза) не считаются расходом, единиц в минуту. */
export const RATE_CLAMP_PER_MIN = 30;
/** Предупреждать, если запас кончится раньше чем через столько минут; «тревога» — ещё раньше. */
export const ALERT_ETA_WARN_MIN = 8;
export const ALERT_ETA_BAD_MIN = 3;

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

export const EXPEDITION_MAX_CREW = 4;

// ---------- Поверхность планет ----------
// Высадка — отдельная карта: команда сама добывает и отстреливается, игрок направляет.

export const SURFACE_W = 44;
export const SURFACE_H = 30;
/** Скорость шага на поверхности, клеток в секунду. */
export const SURFACE_CREW_SPEED = 2.5;
/** Сколько единиц ресурса даёт один цикл добычи. */
export const SURFACE_GATHER_CHUNK = 2;
/** Множитель времени цикла добычи (баланс: высадка выгодна, но не заменяет рынок). */
export const SURFACE_WORK_MULT = 2.5;
/** Множитель урона местной жизни (баланс). */
export const CREATURE_DAMAGE_MULT = 1.3;
/** Ручное оружие экипажа: урон = база + навык боя × множитель. */
export const CREW_GUN_DAMAGE = 4;
export const CREW_GUN_SKILL_MULT = 0.6;
export const CREW_GUN_RANGE = 4.5;
export const CREW_GUN_COOLDOWN = 1.2;
/** Ниже этого здоровья человек отходит к шаттлу и лечится там. */
export const SURFACE_FLEE_HEALTH = 40;
export const SURFACE_SHUTTLE_HEAL = 3;
/** Вокруг шаттла хищники не нападают (турели посадочного модуля). */
export const SHUTTLE_SAFE_RADIUS = 2.5;
/** Новые хищники приходят всё чаще: интервал = база / (угроза + 0.3), сжимается со временем до минимума. */
export const SURFACE_SPAWN_BASE = 25;
export const SURFACE_SPAWN_MIN = 12;
/** За сколько секунд на планете интервал прихода хищников сжимается вдвое. */
export const SURFACE_ESCALATION_SECONDS = 300;

export type CreatureType = 'vine' | 'stalker' | 'sporeling' | 'drone_scout' | 'ice_crawler' | 'magma_beetle' | 'beast';

export interface CreatureDef {
  name: string;
  hp: number;
  damage: number;
  cooldown: number;
  /** Клеток в секунду. */
  speed: number;
  /** С какой дистанции замечает людей, клеток. */
  aggro: number;
  loot: Partial<Record<Resource, [number, number]>>;
  color: string;
}

export const CREATURES: Record<CreatureType, CreatureDef> = {
  vine: { name: 'Хищная лиана', hp: 40, damage: 9, cooldown: 1.5, speed: 1.2, aggro: 5, loot: { biomass: [3, 6] }, color: '#7cb342' },
  stalker: { name: 'Рощевой охотник', hp: 30, damage: 7, cooldown: 1.1, speed: 2.6, aggro: 8, loot: { biomass: [2, 4], food: [1, 3] }, color: '#558b2f' },
  sporeling: { name: 'Спорник', hp: 22, damage: 6, cooldown: 1.3, speed: 1.8, aggro: 6, loot: { biomass: [2, 5] }, color: '#c0ca33' },
  drone_scout: { name: 'Сторожевой дрон', hp: 35, damage: 8, cooldown: 1.0, speed: 2.4, aggro: 9, loot: { metal: [3, 6], crystals: [0, 2] }, color: '#ef5350' },
  ice_crawler: { name: 'Ледяной ползун', hp: 45, damage: 7, cooldown: 1.6, speed: 1.4, aggro: 5, loot: { ice: [3, 6] }, color: '#81d4fa' },
  magma_beetle: { name: 'Магмовый жук', hp: 50, damage: 10, cooldown: 1.6, speed: 1.6, aggro: 6, loot: { crystals: [1, 3] }, color: '#ff7043' },
  beast: { name: 'Местный зверь', hp: 30, damage: 6, cooldown: 1.2, speed: 2.2, aggro: 5, loot: { food: [2, 5] }, color: '#a1887f' },
};

export interface SurfaceNodeDef {
  name: string;
  resource: Resource;
  amount: [number, number];
  /** Секунд работы на один цикл добычи при среднем навыке. */
  work: number;
  skill: 'botany' | 'engineering';
  weight: number;
}

export interface SurfaceBiomeDef {
  ground: string;
  rough: string;
  block: string;
  liquid: string;
  blockName: string;
  liquidName: string;
  /** Доля непроходимых клеток (скалы, заросли) и жидкости. */
  blockDensity: number;
  liquidDensity: number;
  nodes: SurfaceNodeDef[];
  nodeCount: number;
  creatures: CreatureType[];
}

export const SURFACE_BIOMES: Record<Biome, SurfaceBiomeDef> = {
  terran: {
    ground: '#2f4a2c', rough: '#3d5a34', block: '#5d6b5a', liquid: '#1f4f78', blockName: 'Скалы', liquidName: 'Озеро',
    blockDensity: 0.12, liquidDensity: 0.08, nodeCount: 14, creatures: ['beast'],
    nodes: [
      { name: 'Родник', resource: 'water', amount: [15, 30], work: 3, skill: 'engineering', weight: 3 },
      { name: 'Дикие злаки', resource: 'food', amount: [10, 20], work: 4, skill: 'botany', weight: 3 },
      { name: 'Рощица', resource: 'biomass', amount: [10, 20], work: 4, skill: 'botany', weight: 2 },
      { name: 'Рудный выход', resource: 'metal', amount: [10, 25], work: 6, skill: 'engineering', weight: 2 },
    ],
  },
  jungle: {
    ground: '#1f3a1d', rough: '#29492a', block: '#14301a', liquid: '#2b4d3a', blockName: 'Живые заросли', liquidName: 'Трясина',
    blockDensity: 0.22, liquidDensity: 0.06, nodeCount: 16, creatures: ['vine', 'stalker'],
    nodes: [
      { name: 'Плодовое дерево', resource: 'food', amount: [10, 25], work: 4, skill: 'botany', weight: 3 },
      { name: 'Живая древесина', resource: 'biomass', amount: [20, 40], work: 5, skill: 'botany', weight: 4 },
      { name: 'Семенной банк', resource: 'crystals', amount: [3, 8], work: 8, skill: 'botany', weight: 1 },
    ],
  },
  ice: {
    ground: '#5f7380', rough: '#6f8592', block: '#a9c2d0', liquid: '#1b3a55', blockName: 'Торосы', liquidName: 'Полынья',
    blockDensity: 0.15, liquidDensity: 0.07, nodeCount: 14, creatures: ['ice_crawler'],
    nodes: [
      { name: 'Чистый ледник', resource: 'ice', amount: [25, 50], work: 4, skill: 'engineering', weight: 5 },
      { name: 'Подлёдная руда', resource: 'metal', amount: [8, 18], work: 7, skill: 'engineering', weight: 1 },
    ],
  },
  desert: {
    ground: '#6a3e26', rough: '#7a4a2e', block: '#4a2c1c', liquid: '#3a2418', blockName: 'Ржавые скалы', liquidName: 'Зыбучий песок',
    blockDensity: 0.14, liquidDensity: 0.05, nodeCount: 14, creatures: ['beast', 'drone_scout'],
    nodes: [
      { name: 'Жила железа', resource: 'metal', amount: [20, 40], work: 6, skill: 'engineering', weight: 4 },
      { name: 'Обломки древнего корабля', resource: 'metal', amount: [15, 30], work: 5, skill: 'engineering', weight: 2 },
      { name: 'Кристаллы в песке', resource: 'crystals', amount: [3, 8], work: 8, skill: 'engineering', weight: 1 },
    ],
  },
  volcanic: {
    ground: '#2a1a16', rough: '#3a221c', block: '#14100e', liquid: '#c43c0c', blockName: 'Базальт', liquidName: 'Лава',
    blockDensity: 0.14, liquidDensity: 0.12, nodeCount: 12, creatures: ['magma_beetle'],
    nodes: [
      { name: 'Кристаллическая друза', resource: 'crystals', amount: [6, 14], work: 7, skill: 'engineering', weight: 3 },
      { name: 'Застывший металл', resource: 'metal', amount: [15, 30], work: 6, skill: 'engineering', weight: 2 },
    ],
  },
  ruins: {
    ground: '#2c3236', rough: '#363d42', block: '#1a1f22', liquid: '#2a1418', blockName: 'Руины', liquidName: 'Провал',
    blockDensity: 0.2, liquidDensity: 0.04, nodeCount: 12, creatures: ['drone_scout'],
    nodes: [
      { name: 'Склад машин', resource: 'credits', amount: [40, 90], work: 6, skill: 'engineering', weight: 2 },
      { name: 'Процессорный блок', resource: 'crystals', amount: [5, 12], work: 7, skill: 'engineering', weight: 2 },
      { name: 'Склад запчастей', resource: 'metal', amount: [20, 35], work: 5, skill: 'engineering', weight: 3 },
    ],
  },
  toxic: {
    ground: '#3a3d16', rough: '#474a1c', block: '#262810', liquid: '#7a8a12', blockName: 'Грибные столбы', liquidName: 'Кислотное болото',
    blockDensity: 0.15, liquidDensity: 0.12, nodeCount: 14, creatures: ['sporeling'],
    nodes: [
      { name: 'Мутировавшие грибы', resource: 'biomass', amount: [15, 30], work: 4, skill: 'botany', weight: 3 },
      { name: 'Кристаллы в иле', resource: 'crystals', amount: [4, 10], work: 7, skill: 'engineering', weight: 2 },
    ],
  },
};

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

// ---------- События в космосе: сигналы ----------
// Сигнал — точка интереса в системе. Радиосигнал слышен по всей системе, но что это — видно только вблизи
// (или с радаром). Подлетев, игрок выбирает вариант; исход случаен (по весам) и решается на сервере.

export type SignalKind = 'wreck' | 'distress' | 'trader' | 'anomaly';

export interface SignalOutcome {
  /** Вес исхода среди исходов варианта. */
  weight: number;
  text: string;
  level: 'info' | 'good' | 'warn' | 'bad';
  /** Добыча (каждое число случайно ±SIGNAL_GAIN_SPREAD). */
  gain?: Partial<Resources>;
  /** Засада: кто и сколько появляется рядом и сразу атакует. */
  ambush?: Partial<Record<NpcType, number>>;
  /** Урон корпусу (взрыв, мина). */
  damage?: number;
  /** Щит обнуляется. */
  drainShield?: boolean;
  /** Выживший вступает в команду (если нет места — благодарит кредитами SIGNAL_SURVIVOR_REWARD). */
  survivor?: boolean;
}

export interface SignalOption {
  label: string;
  hint: string;
  cost?: Partial<Resources>;
  /** Вариант доступен только с работающим радаром. */
  needsRadar?: boolean;
  outcomes: SignalOutcome[];
}

export interface SignalDef {
  name: string;
  text: string;
  /** Вес при выборе вида нового сигнала. */
  weight: number;
  options: SignalOption[];
}

/** Ближе этого расстояния можно принять решение по сигналу. */
export const SIGNAL_RANGE = 160;
/** Ближе этого расстояния (или с радаром в радиусе сенсоров) видно, что это за сигнал. */
export const SIGNAL_IDENT_RANGE = 600;
export const SIGNAL_TTL_SECONDS = 900;
export const SIGNAL_MAX_PER_SYSTEM = 3;
/** Шанс появления сигнала при проверке населения системы (раз в 5 с), пока их меньше максимума. */
export const SIGNAL_SPAWN_CHANCE = 0.04;
export const SIGNAL_GAIN_SPREAD = 0.3;
export const SIGNAL_SURVIVOR_REWARD = 100;
/** На каком расстоянии от сигнала появляется засада. */
export const SIGNAL_AMBUSH_DISTANCE: readonly [number, number] = [260, 420];

export const SIGNALS: Record<SignalKind, SignalDef> = {
  wreck: {
    name: 'Обломки ковчега',
    text: 'Разбитый корпус ковчега медленно вращается в пустоте. Реактор ещё тёплый — катастрофа случилась недавно.',
    weight: 4,
    options: [
      {
        label: 'Снять обшивку',
        hint: 'Немного металла, без риска.',
        outcomes: [{ weight: 1, text: 'Команда срезает уцелевшие листы обшивки.', level: 'good', gain: { metal: 35 } }],
      },
      {
        label: 'Вскрыть грузовой отсек',
        hint: 'Добыча богаче, но обломки могут быть приманкой.',
        outcomes: [
          { weight: 55, text: 'В отсеке — нетронутые контейнеры.', level: 'good', gain: { metal: 30, crystals: 8, food: 15 } },
          { weight: 30, text: 'Это приманка Машин! Из-за обломков выходят дроны.', level: 'bad', gain: { metal: 12 }, ambush: { drone: 2 } },
          { weight: 15, text: 'Отсек был заминирован. Взрыв задел корпус.', level: 'bad', damage: 30 },
        ],
      },
    ],
  },
  distress: {
    name: 'Сигнал бедствия',
    text: 'Спасательная капсула передаёт слабый сигнал. Датчики показывают: внутри кто-то жив.',
    weight: 3,
    options: [
      {
        label: 'Принять на борт',
        hint: 'Понадобятся еда и вода. Возможно, это ловушка.',
        cost: { food: 10, water: 10 },
        outcomes: [
          { weight: 60, text: 'Выживший приходит в себя и просится в команду.', level: 'good', survivor: true },
          { weight: 25, text: 'Спасённый инженер переводит вам свои сбережения и сойдёт на ближайшей станции.', level: 'good', gain: { credits: 140 } },
          { weight: 15, text: 'Капсула пуста. Сигнал — ловушка Машин!', level: 'bad', ambush: { drone: 1, sentinel: 1 } },
        ],
      },
      {
        label: 'Забрать аварийный запас',
        hint: 'Припасы капсулы — вам. Тому, кто внутри, они уже не помогут.',
        outcomes: [
          { weight: 70, text: 'Вы забираете аварийный запас. Сигнал затихает.', level: 'warn', gain: { food: 12, water: 8, credits: 30 } },
          { weight: 30, text: 'Капсула пуста — кто-то успел раньше.', level: 'info' },
        ],
      },
    ],
  },
  trader: {
    name: 'Бродячий торговец',
    text: 'Потрёпанный челнок без опознавательных знаков предлагает сделку — быстро и без лишних вопросов.',
    weight: 3,
    options: [
      {
        label: 'Купить кристаллы',
        hint: 'Дешевле, чем на станции. Качество — на его совести.',
        cost: { credits: 90 },
        outcomes: [
          { weight: 85, text: 'Кристаллы чистые. Хорошая сделка.', level: 'good', gain: { crystals: 12 } },
          { weight: 15, text: 'Половина «кристаллов» оказалась стекляшками. Торговец уже далеко.', level: 'warn', gain: { crystals: 4 } },
        ],
      },
      {
        label: 'Купить припасы',
        hint: 'Еда и вода с наценкой, зато здесь и сейчас.',
        cost: { credits: 60 },
        outcomes: [{ weight: 1, text: 'Ящики с пайками и канистры перегружены на борт.', level: 'good', gain: { food: 30, water: 20 } }],
      },
      {
        label: 'Продать металл',
        hint: 'Торговец берёт металл дороже станции.',
        cost: { metal: 40 },
        outcomes: [{ weight: 1, text: 'Торговец забирает металл и расплачивается не торгуясь.', level: 'good', gain: { credits: 110 } }],
      },
    ],
  },
  anomaly: {
    name: 'Аномалия',
    text: 'Пространство здесь мерцает, приборы фиксируют выбросы энергии. Корпус едва заметно гудит.',
    weight: 2,
    options: [
      {
        label: 'Войти в аномалию',
        hint: 'Никто не знает, что будет.',
        outcomes: [
          { weight: 45, text: 'Выброс прошёл сквозь корпус — на обшивке выросли кристаллы.', level: 'good', gain: { crystals: 10 } },
          { weight: 30, text: 'Выброс обнулил щиты.', level: 'warn', drainShield: true },
          { weight: 25, text: 'Разряд ударил в корпус. Зато часть энергии осела кристаллами.', level: 'bad', damage: 20, gain: { crystals: 5 } },
        ],
      },
      {
        label: 'Просканировать радаром',
        hint: 'Безопасно. Данные охотно купят на станции.',
        needsRadar: true,
        outcomes: [{ weight: 1, text: 'Радар записал структуру аномалии. За такие данные хорошо платят.', level: 'good', gain: { crystals: 5, credits: 70 } }],
      },
    ],
  },
};

export const SIGNAL_KINDS = Object.keys(SIGNALS) as SignalKind[];

// ---------- Настроение и черты характера (как в RimWorld: настроение складывается из «мыслей») ----------

export type TraitKind = 'hardworker' | 'glutton' | 'ascetic' | 'nightowl' | 'tough' | 'optimist' | 'gloomy' | 'fast';

export interface TraitDef {
  name: string;
  desc: string;
  /** Множитель скорости работы. */
  work?: number;
  /** Множитель расхода еды. */
  foodDecay?: number;
  /** Множитель урона от удушья, голода, холода и жары. */
  damage?: number;
  /** Множитель скорости ходьбы. */
  speed?: number;
  /** Темнота не мешает работать и не портит настроение. */
  ignoresDark?: boolean;
  /** Постоянная «мысль» этой черты. */
  thought?: ThoughtKind;
}

export const TRAITS: Record<TraitKind, TraitDef> = {
  hardworker: { name: 'Трудяга', desc: 'Работает на 20% быстрее.', work: 1.2 },
  glutton: { name: 'Обжора', desc: 'Ест на 40% больше.', foodDecay: 1.4 },
  ascetic: { name: 'Аскет', desc: 'Ест на 30% меньше.', foodDecay: 0.7 },
  nightowl: { name: 'Сова', desc: 'Темнота не мешает работать и не портит настроение.', ignoresDark: true },
  tough: { name: 'Крепкий', desc: 'Удушье, голод, холод и жара ранят на 40% слабее.', damage: 0.6 },
  optimist: { name: 'Оптимист', desc: 'Настроение всегда немного выше.', thought: 'optimist' },
  gloomy: { name: 'Мрачный', desc: 'Настроение всегда немного ниже.', thought: 'gloomy' },
  fast: { name: 'Шустрый', desc: 'Ходит на 20% быстрее.', speed: 1.2 },
};

export const TRAIT_KINDS = Object.keys(TRAITS) as TraitKind[];

export type ThoughtKind =
  | 'starving'
  | 'hungry'
  | 'fed'
  | 'exhausted'
  | 'tired'
  | 'rested'
  | 'hurt'
  | 'thinAir'
  | 'cold'
  | 'hot'
  | 'dark'
  | 'cozy'
  | 'grief'
  | 'optimist'
  | 'gloomy';

/** Мысль: что видит игрок и на сколько она сдвигает настроение. */
export const THOUGHTS: Record<ThoughtKind, { text: string; mood: number }> = {
  starving: { text: 'Умираю с голоду', mood: -20 },
  hungry: { text: 'Голоден', mood: -10 },
  fed: { text: 'Сыт', mood: 5 },
  exhausted: { text: 'Валюсь с ног', mood: -15 },
  tired: { text: 'Устал', mood: -8 },
  rested: { text: 'Выспался', mood: 5 },
  hurt: { text: 'Ранен', mood: -10 },
  thinAir: { text: 'Нечем дышать', mood: -12 },
  cold: { text: 'Холодно', mood: -8 },
  hot: { text: 'Жарко', mood: -8 },
  dark: { text: 'Сижу в темноте', mood: -5 },
  cozy: { text: 'Светло, тепло и есть чем дышать', mood: 6 },
  grief: { text: 'На борту погиб человек', mood: -15 },
  optimist: { text: 'Оптимист', mood: 8 },
  gloomy: { text: 'Мрачный', mood: -8 },
};

export const MOOD_BASE = 50;
/** Пунктов в секунду, с которыми настроение идёт к сумме мыслей. */
export const MOOD_RATE = 0.5;
/** Пороги потребностей для мыслей. */
export const MOOD_STARVING_BELOW = 5;
export const MOOD_HUNGRY_BELOW = 30;
export const MOOD_FED_ABOVE = 70;
export const MOOD_EXHAUSTED_BELOW = 5;
export const MOOD_TIRED_BELOW = 25;
export const MOOD_RESTED_ABOVE = 70;
export const MOOD_HURT_BELOW = 50;
export const MOOD_THIN_AIR_BELOW = 0.6;
/** Воодушевлён (≥) — работает быстрее; подавлен (<) — медленнее. */
export const MOOD_HIGH = 70;
export const MOOD_LOW = 30;
export const MOOD_HIGH_WORK = 1.15;
export const MOOD_LOW_WORK = 0.8;
/** Срыв: настроение ниже порога дольше MOOD_BREAK_AFTER секунд — человек бросает работу на MOOD_BREAK_SECONDS. */
export const MOOD_BREAK_BELOW = 15;
export const MOOD_BREAK_AFTER = 45;
export const MOOD_BREAK_SECONDS = 40;
/** После срыва становится легче. */
export const MOOD_BREAK_RELIEF = 25;
/** Сколько секунд команда переживает смерть на борту. */
export const GRIEF_SECONDS = 240;

// ---------- Прицельный огонь (как в FTL: бить не только по корпусу, но и по системам врага) ----------

export type AimKind = 'hull' | 'weapons' | 'engines' | 'shields';
export type SubsystemKind = Exclude<AimKind, 'hull'>;

export const AIM_KINDS: AimKind[] = ['hull', 'weapons', 'engines', 'shields'];
export const SUBSYSTEM_KINDS: SubsystemKind[] = ['weapons', 'engines', 'shields'];

export const AIM_NAMES: Record<AimKind, string> = { hull: 'Корпус', weapons: 'Оружие', engines: 'Двигатели', shields: 'Щиты' };
export const AIM_HINTS: Record<AimKind, string> = {
  hull: 'Весь урон идёт в корпус — быстрее всего уничтожает цель.',
  weapons: 'Выбитое оружие не стреляет, пока враг его не починит.',
  engines: 'С выбитыми двигателями враг едва ползёт — можно уйти или держать дистанцию.',
  shields: 'Выбитые щиты падают в ноль и не восстанавливаются.',
};

export const AIM_DOWN_TEXT: Record<SubsystemKind, string> = {
  weapons: 'оружие выведено из строя',
  engines: 'двигатели выведены из строя',
  shields: 'щиты выведены из строя',
};

/** Доля прошедшего щит урона, которая при прицельном огне идёт в систему (остальное — в корпус). */
export const AIM_SUB_SHARE = 0.7;
/** Прицельный выстрел лазера попадает реже. */
export const AIM_ACCURACY = 0.85;
/** Прочность каждой системы врага — доля от прочности его корпуса. */
export const NPC_SUB_HP_FRAC = 0.35;
/** На сколько секунд выбитая система выходит из строя (потом Машины её чинят). */
export const NPC_SUB_DOWN_SECONDS = 20;
/** Скорость врага с выбитыми двигателями. */
export const NPC_ENGINE_DOWN_SPEED = 0.25;
/** По каким модулям корабля игрока бьёт прицел. */
export const AIM_MODULES: Record<SubsystemKind, ModuleType[]> = {
  weapons: ['laser', 'missile'],
  engines: ['engine'],
  shields: ['shield_gen'],
};
/** Множитель урона по модулю при прицельном попадании (как и при случайном). */
export const AIM_MODULE_DAMAGE = 1.5;

// ---------- Задачи капитана: ввод в игру по шагам ----------

export type GuideStepId = 'move' | 'mine' | 'build' | 'signal' | 'land' | 'kill' | 'jump';

export interface GuideStep {
  id: GuideStepId;
  title: string;
  /** Что сделать и как — показывается игроку. */
  text: string;
  /** Награда в кредитах. */
  reward: number;
}

/** Шаги идут по порядку; условие выполнения каждого проверяет World.guideDone. */
export const GUIDE: GuideStep[] = [
  { id: 'move', title: 'Дать ход', text: 'Щёлкните по космосу — пилот поведёт корабль туда. Колесо мыши меняет масштаб, Tab переключает вид.', reward: 30 },
  { id: 'mine', title: 'Добыть руду', text: 'Найдите астероид (серые точки на мини-карте), щёлкните по нему и выберите, что добывать. Бур включится сам, когда подлетите.', reward: 60 },
  { id: 'build', title: 'Начать стройку', text: 'Нажмите B, выберите постройку и поставьте её на корабле. Команда принесёт материалы и построит сама.', reward: 60 },
  { id: 'signal', title: 'Проверить сигнал', text: 'Мигающий ромб на мини-карте — сигнал. Подлетите к нему вплотную и примите решение.', reward: 100 },
  { id: 'land', title: 'Высадиться на планету', text: 'Подлетите на орбиту планеты, щёлкните по ней, отметьте людей и нажмите «Высадить команду».', reward: 120 },
  { id: 'kill', title: 'Победить врага', text: 'Щёлкните по дрону Машин и нажмите «Атаковать». Клавиши 1–4 наводят орудия на корпус, оружие, двигатели или щиты.', reward: 150 },
  { id: 'jump', title: 'Совершить гиперпрыжок', text: 'Нажмите G, выберите соседнюю систему и прыгайте. Нужны 2 кристалла, пилот и работающий двигатель.', reward: 200 },
];
