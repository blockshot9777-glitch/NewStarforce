import { describe, expect, it } from 'vitest';
import {
  CREATURES,
  FOOD_DECAY,
  REST_DECAY,
  SURFACE_HAZARDS,
  SURFACE_STARVE_DAMAGE,
  Rng,
  SURFACE_BIOMES,
  TICK_RATE,
  World,
  findPath,
  generateSurface,
  newClientCache,
  passableAt,
  surfaceGrid,
  type Expedition,
} from '../src';

const steps = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.step();
};

/** Мир с высадкой на планету заданного биома; враги в космосе убраны. */
function landing(biome = 'ice', crewCount = 2) {
  const w = World.create(21);
  const p = w.join('Тест', 'surface-token-1');
  for (const sys of w.state.systems) {
    sys.npcs = [];
    sys.belts = [];
  }
  const ship = w.shipOf(p)!;
  ship.res.credits = 1000;
  w.command(p.id, { c: 'recruit', robot: false }); // четвёртый человек: кто-то должен остаться на борту
  const planet = w.state.systems[0].planets.find((pl) => pl.biome === biome)!;
  ship.x = planet.x + planet.r + 50;
  ship.y = planet.y;
  const ids = ship.crew.slice(0, crewCount).map((c) => c.id);
  expect(w.command(p.id, { c: 'expedition', planetId: planet.id, crewIds: ids })).toBeNull();
  const e = w.state.expeditions[0];
  return { w, p, ship, planet, e };
}

function pacifySurface(e: Expedition) {
  e.surface.creatures = [];
  e.surface.spawnTimer = Infinity;
}

describe('поверхность: генерация', () => {
  it('детерминирована, шаттл на свободной площадке, до каждой ресурсной точки можно дойти', () => {
    for (const biome of Object.keys(SURFACE_BIOMES) as (keyof typeof SURFACE_BIOMES)[]) {
      let id = 1;
      const a = generateSurface(new Rng(5), biome, () => id++);
      id = 1;
      const b = generateSurface(new Rng(5), biome, () => id++);
      expect(b).toEqual(a);
      expect(a.terrain.length).toBe(a.w * a.h);
      expect(passableAt(a, a.shuttle.x, a.shuttle.y)).toBe(true);
      expect(a.nodes.length).toBeGreaterThan(5);
      for (const n of a.nodes) expect(findPath(surfaceGrid(a), a.shuttle, { x: n.x, y: n.y })).not.toBeNull();
    }
  });
});

describe('поверхность: работа команды', () => {
  it('без хищников команда добывает ресурсы биома', () => {
    const { w, e } = landing('ice');
    pacifySurface(e);
    steps(w, 60);
    expect(e.loot.ice ?? 0).toBeGreaterThanOrEqual(10);
  });

  it('помеченная точка берётся в работу первой', () => {
    const { w, p, e } = landing('ice', 1);
    pacifySurface(e);
    const s = e.surface;
    const far = [...s.nodes].sort((a, b) => Math.hypot(b.x - s.shuttle.x, b.y - s.shuttle.y) - Math.hypot(a.x - s.shuttle.x, a.y - s.shuttle.y))[0];
    expect(w.command(p.id, { c: 'landMark', expeditionId: e.id, nodeId: far.id })).toBeNull();
    steps(w, 1);
    expect(s.actors[0].nodeId).toBe(far.id);
  });

  it('приказ «иди сюда»: в непроходимую клетку нельзя, в проходимую — дошёл', () => {
    const { w, p, e } = landing('ice', 1);
    pacifySurface(e);
    const s = e.surface;
    const c = e.crew[0];
    const wall = [...s.terrain].findIndex((ch) => ch === '#' || ch === '~');
    expect(w.command(p.id, { c: 'landMove', expeditionId: e.id, crewId: c.id, x: wall % s.w, y: Math.floor(wall / s.w) })).toMatch(/не пройти/);
    const goal = { x: s.shuttle.x + 3, y: s.shuttle.y };
    while (!passableAt(s, goal.x, goal.y)) goal.y++;
    expect(w.command(p.id, { c: 'landMove', expeditionId: e.id, crewId: c.id, x: goal.x, y: goal.y })).toBeNull();
    // Дойдя до точки, человек возвращается к добыче — проверяем, что он там побывал.
    let reached = false;
    for (let t = 0; t < 8 * TICK_RATE && !reached; t++) {
      w.step();
      reached = Math.hypot(c.x - goal.x, c.y - goal.y) < 0.01;
    }
    expect(reached).toBe(true);
  });

  it('отзыв: все идут к шаттлу, ресурсы и люди возвращаются на корабль', () => {
    const { w, p, ship, e } = landing('ice');
    pacifySurface(e);
    // Водоочиститель корабля не должен тратить лёд, иначе сравнение «до/после» неточно.
    for (const m of ship.modules) if (m.type === 'water_recycler') m.enabled = false;
    steps(w, 40);
    const loot = e.loot.ice ?? 0;
    expect(loot).toBeGreaterThan(0);
    const iceBefore = ship.res.ice;
    w.command(p.id, { c: 'recall', expeditionId: e.id });
    steps(w, 40);
    expect(w.state.expeditions.length).toBe(0);
    expect(ship.crew.length).toBe(4);
    expect(ship.res.ice).toBeGreaterThanOrEqual(iceBefore + loot - 0.01);
  });

  it('если корабль улетел из системы, шаттл ждёт его на планете', () => {
    const { w, p, ship, e } = landing('ice');
    pacifySurface(e);
    w.command(p.id, { c: 'recall', expeditionId: e.id });
    ship.systemId = 1;
    steps(w, 30);
    expect(w.state.expeditions.length).toBe(1);
    expect(w.snapshotFor(p.id, newClientCache()).expeditions[0].waitingForShip).toBe(true);
    ship.systemId = 0;
    steps(w, 1);
    expect(w.state.expeditions.length).toBe(0);
  });
});

describe('поверхность: местная жизнь', () => {
  it('команда отстреливает хищника и забирает трофей', () => {
    const { w, e } = landing('desert');
    pacifySurface(e);
    const s = e.surface;
    const c = e.crew[0];
    c.x = s.shuttle.x + 1;
    c.y = s.shuttle.y + 1;
    s.creatures.push({ id: 999001, type: 'beast', x: c.x + 3, y: c.y, path: [], hp: CREATURES.beast.hp, cooldown: 0, repath: 0, targetCrewId: null });
    steps(w, 15);
    expect(s.creatures.some((x) => x.id === 999001)).toBe(false);
    expect(e.loot.food ?? 0).toBeGreaterThan(0);
  });

  it('раненый отходит к шаттлу и лечится; у шаттла хищники не нападают', () => {
    const { w, e } = landing('ice', 1);
    pacifySurface(e);
    const s = e.surface;
    const c = e.crew[0];
    steps(w, 5);
    c.health = 30;
    steps(w, 30);
    expect(c.health).toBeGreaterThan(60);
    expect(s.actors[0].task === 'flee' || s.actors[0].task === 'idle' || s.actors[0].task === 'gather').toBe(true);
  });

  it('чем дольше на планете, тем чаще приходят хищники', () => {
    const { w, e } = landing('jungle');
    e.surface.creatures = [];
    // Неуязвимая команда в шаттле: считаем только приход хищников.
    for (const a of e.surface.actors) a.task = 'boarded';
    let early = 0;
    let late = 0;
    let seen = new Set<number>();
    for (let t = 0; t < 900 * TICK_RATE; t++) {
      w.step();
      for (const cr of e.surface.creatures) {
        if (seen.has(cr.id)) continue;
        seen.add(cr.id);
        if (t < 300 * TICK_RATE) early++;
        else if (t >= 600 * TICK_RATE) late++;
      }
    }
    expect(late).toBeGreaterThan(early);
    seen = new Set();
  });
});

describe('поверхность: сеть и сохранения', () => {
  it('рельеф отправляется клиенту один раз', () => {
    const { w, p } = landing('ice');
    const cache = newClientCache();
    expect(w.snapshotFor(p.id, cache).expeditions[0].surface.terrain).not.toBeNull();
    expect(w.snapshotFor(p.id, cache).expeditions[0].surface.terrain).toBeNull();
  });

  it('высадка сохраняется и продолжается после загрузки', () => {
    const { w, e } = landing('jungle');
    steps(w, 10);
    const loaded = World.fromJSON(w.toJSON());
    steps(w, 10);
    steps(loaded, 10);
    expect(loaded.toJSON()).toBe(w.toJSON());
    expect(loaded.state.expeditions[0].id).toBe(e.id);
  });

  it('старое сохранение с таймерной экспедицией: команда сразу возвращается на корабль', () => {
    const { w, ship, e } = landing('ice');
    const state = JSON.parse(w.toJSON());
    const legacy = state.expeditions[0];
    delete legacy.surface;
    delete legacy.returning;
    legacy.timeLeft = 12;
    legacy.loot = { ice: 7 };
    const loaded = World.fromJSON(JSON.stringify(state));
    expect(loaded.state.expeditions.length).toBe(0);
    const s2 = loaded.state.ships.find((s) => s.id === ship.id)!;
    expect(s2.crew.length).toBe(4);
    expect(s2.res.ice).toBeGreaterThanOrEqual(ship.res.ice + 7 - 0.01);
    void e;
  });

  it('мусорные приказы высадки не роняют мир', () => {
    const { w, p, e } = landing('ice');
    const junk: unknown[] = [
      { c: 'landMove', expeditionId: e.id, crewId: 'x', x: 1, y: 1 },
      { c: 'landMove', expeditionId: e.id, crewId: e.crew[0].id, x: -5, y: 9999 },
      { c: 'landMove', expeditionId: 424242, crewId: 1, x: 1, y: 1 },
      { c: 'landMark', expeditionId: e.id, nodeId: 1.5 },
      { c: 'landMark', expeditionId: e.id, nodeId: 123456789 },
    ];
    for (const j of junk) expect(typeof w.command(p.id, j)).toBe('string');
    steps(w, 1);
  });
});

describe('поверхность: нужды и опасности биомов', () => {
  it('на планете уходят сытость и силы; на морозе силы уходят быстрее, чем в мягком климате', () => {
    const drop = (biome: string) => {
      const { w, e } = landing(biome);
      pacifySurface(e);
      const c = e.crew[0];
      c.trait = null;
      c.food = 100;
      c.rest = 100;
      steps(w, 60);
      return { food: 100 - c.food, rest: 100 - c.rest };
    };
    const mild = drop('terran');
    const cold = drop('ice');
    expect(mild.food).toBeCloseTo(FOOD_DECAY * 60, 0);
    expect(mild.rest).toBeCloseTo(REST_DECAY * 60, 0);
    expect(cold.rest / mild.rest).toBeCloseTo(SURFACE_HAZARDS.ice.rest, 1);
    expect(cold.food / mild.food).toBeCloseTo(SURFACE_HAZARDS.ice.food, 1);
  });

  it('голодный ест из добытого; без еды — предупреждение один раз, потом теряет здоровье', () => {
    const { w, p, e } = landing('terran');
    pacifySurface(e);
    const c = e.crew[0];
    c.food = 10;
    e.loot.food = 3;
    steps(w, 1);
    expect(c.food).toBeGreaterThan(50);
    expect(e.loot.food).toBe(2);

    e.loot.food = 0;
    // Еду на этой планете не собираем: убираем точки, чтобы добыча не мешала проверке.
    e.surface.nodes = [];
    c.food = 20;
    p.inbox = [];
    steps(w, 30);
    expect(p.inbox.filter((l) => l.text.includes('голодает')).length).toBe(1);
    c.food = 0;
    const hp = c.health;
    steps(w, 10);
    expect(hp - c.health).toBeCloseTo(SURFACE_STARVE_DAMAGE * 10, 0);
  });

  it('ядовитый воздух ранит вдали от шаттла, а робота и тех, кто в шаттле, не трогает', () => {
    const { w, p, e } = landing('toxic');
    pacifySurface(e);
    e.surface.nodes = [];
    const [a, b] = e.crew;
    a.trait = b.trait = null;
    b.robot = true;
    const far = { x: e.surface.shuttle.x + 6, y: e.surface.shuttle.y };
    // Ставим обоих подальше от шаттла на проходимую клетку.
    const spot = [far, { x: far.x, y: far.y + 1 }, { x: far.x, y: far.y - 1 }, { x: far.x - 1, y: far.y }].find((v) => passableAt(e.surface, v.x, v.y))!;
    for (const c of [a, b]) {
      c.x = spot.x;
      c.y = spot.y;
      c.path = [];
      c.health = 100;
    }
    steps(w, 20);
    expect(100 - a.health).toBeCloseTo(SURFACE_HAZARDS.toxic.health * 20, 0);
    expect(b.health).toBe(100);

    // Отзываем: в шаттле яд не действует, силы восстанавливаются.
    w.command(p.id, { c: 'recall', expeditionId: e.id });
    const ship = w.shipOf(p)!;
    ship.systemId = 1; // корабль «улетел» — команда ждёт в шаттле
    steps(w, 30);
    const hp = a.health;
    const rest = a.rest;
    steps(w, 10);
    expect(a.health).toBeGreaterThanOrEqual(hp);
    expect(a.rest).toBeGreaterThanOrEqual(rest);
  });

  it('нужды видны в снимке высадки', () => {
    const { w, p, e } = landing('ice');
    e.crew[0].food = 42.4;
    e.crew[0].rest = 17.6;
    const v = w.snapshotFor(p.id, newClientCache()).expeditions[0].surface.crew.find((c) => c.id === e.crew[0].id)!;
    expect([v.food, v.rest]).toEqual([42, 18]);
  });
});
