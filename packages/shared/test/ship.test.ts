import { describe, expect, it } from 'vitest';
import {
  MODULES,
  Rng,
  blueprintAt,
  buildCost,
  completeBlueprint,
  moduleAt,
  moduleSize,
  setStored,
  airAt,
  availableJobs,
  breachHull,
  computeRooms,
  createStarterShip,
  distributePower,
  findPath,
  igniteTile,
  isOuterWall,
  setPriority,
  lifeSupport,
  makeModule,
  makeRobot,
  orderCryo,
  placeBlueprint,
  shipRooms,
  stepAir,
  stepTemp,
  tempAt,
  TEMP_AMBIENT,
  toggleUrgent,
  updateCrew,
  updateFires,
  validateBuild,
  type Ship,
  type ShipContext,
  type Tile,
} from '../src';

function setup(seed = 1) {
  const rng = new Rng(seed);
  let id = 1000;
  const nextId = () => id++;
  const logs: string[] = [];
  const ship = createStarterShip({ id: 1, ownerId: 1, systemId: 0, name: 'Тест', x: 0, y: 0, rng, nextId });
  const ctx: ShipContext = {
    rng,
    nextId,
    log: (t) => logs.push(t),
    wantsPilot: false,
    miningActive: false,
    moving: false,
    solar: 1,
  };
  return { ship, ctx, rng, logs, nextId };
}

/** Прогон систем корабля так же, как это делает мир. */
function run(ship: Ship, ctx: ShipContext, seconds: number) {
  const dt = 0.1;
  for (let i = 0; i < seconds * 10; i++) {
    distributePower(ship, dt, ctx);
    lifeSupport(ship, dt, ctx.nextId);
    updateFires(ship, dt, ctx.rng);
    updateCrew(ship, dt, ctx);
  }
}

function findModule(ship: Ship, type: string) {
  return ship.modules.find((m) => m.type === type)!;
}

describe('сетка и поиск пути', () => {
  it('обходит стены и возвращает null, если цель замурована', () => {
    const g = { w: 5, h: 3, tiles: ['floor', 'floor', 'wall', 'floor', 'floor', 'floor', 'floor', 'wall', 'floor', 'floor', 'floor', 'floor', 'floor', 'floor', 'floor'] as Tile[] };
    const path = findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(path.at(-1)).toEqual({ x: 4, y: 0 });
    expect(path.length).toBe(8); // вниз под стеной и обратно наверх
    g.tiles[2 * 5 + 2] = 'wall';
    expect(findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });
});

describe('комнаты и воздух', () => {
  it('стартовый корабль разделён на три герметичные комнаты с дверями', () => {
    const { ship } = setup();
    const rooms = computeRooms(ship);
    expect(rooms.rooms.length).toBe(3);
    expect(rooms.rooms.every((r) => !r.vented)).toBe(true);
    expect(rooms.doors.length).toBe(3);
    expect(rooms.doors.every((d) => d.rooms.length === 2)).toBe(true);
  });

  it('генератор кислорода восполняет воздух, а через дверь он перетекает в соседние комнаты', () => {
    const { ship, ctx } = setup();
    ship.crew = [];
    ship.air = ship.air.map(() => 0);
    run(ship, ctx, 60);
    const rooms = shipRooms(ship);
    const o2room = rooms.roomOf[findModule(ship, 'o2gen').y * ship.w + findModule(ship, 'o2gen').x];
    const air = rooms.rooms.map((r) => ship.air[r.tiles[0]]);
    expect(air[o2room]).toBeGreaterThan(0.2);
    for (let i = 0; i < air.length; i++) if (i !== o2room) expect(air[i]).toBeGreaterThan(0.02);
  });

  it('пробоина выпускает воздух из комнаты и выдаёт бесплатный чертёж заделки', () => {
    const { ship, ctx, rng, nextId } = setup();
    const p = breachHull(ship, rng, nextId())!;
    expect(p).not.toBeNull();
    const bp = ship.blueprints.find((b) => b.x === p.x && b.y === p.y)!;
    expect(bp.kind).toBe('wall');
    expect(bp.free).toBe(true);
    const rooms = shipRooms(ship);
    const room = rooms.rooms[rooms.roomOf[p.y * ship.w + p.x]];
    expect(room.vented).toBe(true);
    const before = ship.air[room.tiles[0]];
    ship.crew = [];
    distributePower(ship, 0.1, ctx);
    for (let i = 0; i < 30; i++) lifeSupport(ship, 0.1, nextId);
    expect(ship.air[room.tiles[0]]).toBeLessThan(before * 0.3);
  });

  it('экипаж заделывает пробоину, и комната снова наполняется воздухом', () => {
    const { ship, ctx, rng, nextId } = setup();
    const p = breachHull(ship, rng, nextId())!;
    run(ship, ctx, 60);
    expect(ship.tiles[p.y * ship.w + p.x]).toBe('wall');
    expect(computeRooms(ship).rooms.every((r) => !r.vented)).toBe(true);
    expect(ship.crew.length).toBe(3);
  });
});

describe('жизнь на борту', () => {
  it('стартовый корабль устойчив: 5 минут без вмешательства никто не умирает, энергии хватает', () => {
    const { ship, ctx } = setup();
    const water0 = ship.res.water + ship.res.ice;
    run(ship, ctx, 300);
    expect(ship.crew.length).toBe(3);
    expect(ship.crew.every((c) => c.health > 80)).toBe(true);
    expect(ship.stats.powerOutput).toBeGreaterThan(0);
    expect(findModule(ship, 'o2gen').powered).toBe(true);
    expect(ship.res.water + ship.res.ice).toBeLessThan(water0);
    expect(ship.oxygen / ship.stats.oxygenCap).toBeGreaterThan(0.8);
  });

  it('гидропоника растёт, экипаж собирает урожай', () => {
    const { ship, ctx, nextId } = setup();
    setStored(ship, 'food', 0, nextId);
    for (const c of ship.crew) c.food = 100;
    run(ship, ctx, 150);
    expect(ship.res.food).toBeGreaterThan(0);
  });

  it('без еды экипаж голодает, а робот — нет', () => {
    const { ship, ctx, rng, nextId } = setup();
    setStored(ship, 'food', 0, nextId);
    ship.modules = ship.modules.filter((m) => m.type !== 'hydroponics');
    ship.crew.push(makeRobot(rng, nextId(), 3, 3));
    run(ship, ctx, 600);
    const humans = ship.crew.filter((c) => !c.robot);
    const robot = ship.crew.find((c) => c.robot)!;
    expect(humans.every((c) => c.food === 0 && c.health < 100)).toBe(true);
    expect(robot.food).toBe(100);
    expect(robot.health).toBe(100);
  });
});

describe('строительство', () => {
  it('чертёж ждёт доставку, потом экипаж строит модуль', () => {
    const { ship, ctx, nextId } = setup();
    setStored(ship, 'metal', 100, nextId);
    const spot = { x: 7, y: 3 };
    expect(validateBuild(ship, spot.x, spot.y, 'lamp')).toBeNull();
    expect(placeBlueprint(ship, 5000, spot.x, spot.y, 'lamp')).toBeNull();
    expect(ship.res.metal).toBe(100);
    expect(ship.blueprints[0].delivered.metal ?? 0).toBe(0);
    run(ship, ctx, 45);
    expect(ship.modules.some((m) => m.type === 'lamp' && m.x === spot.x && m.y === spot.y)).toBe(true);
    expect(ship.blueprints.length).toBe(0);
    expect(ship.res.metal).toBe(100 - MODULES.lamp.cost.metal!);
  });

  it('турель ставится только у внешней стены', () => {
    const { ship } = setup();
    ship.res.metal = 500;
    ship.res.crystals = 500;
    // (7,3) — середина центральной комнаты, до внешней стены далеко.
    expect(validateBuild(ship, 7, 3, 'laser')).toMatch(/внешней стене/);
    // (7,6): снизу внешняя стена (ряд 7).
    expect(isOuterWall(ship, 7, 7)).toBe(true);
    expect(validateBuild(ship, 7, 6, 'laser')).toBeNull();
  });

  it('чертёж без металла ждёт, занятая клетка отклоняется', () => {
    const { ship, ctx, nextId } = setup();
    setStored(ship, 'metal', 0, nextId);
    expect(validateBuild(ship, 7, 3, 'lamp')).toBeNull();
    expect(placeBlueprint(ship, 5000, 7, 3, 'lamp')).toBeNull();
    run(ship, ctx, 10);
    expect(ship.blueprints.some((b) => b.id === 5000)).toBe(true);
    expect(ship.modules.some((m) => m.type === 'lamp' && m.x === 7 && m.y === 3)).toBe(false);
    setStored(ship, 'metal', 100, nextId);
    run(ship, ctx, 45);
    expect(ship.modules.some((m) => m.type === 'lamp' && m.x === 7 && m.y === 3)).toBe(true);
    const m = ship.modules[0];
    expect(validateBuild(ship, m.x, m.y, 'lamp')).toMatch(/занята/);
  });

  it('медотсек занимает 2×2, панель — 2×1 у стены', () => {
    const { ship, ctx } = setup();
    expect(moduleSize('lamp')).toEqual([1, 1]);
    expect(moduleSize('medbay')).toEqual([2, 2]);
    expect(moduleSize('solar_panel')).toEqual([2, 1]);
    expect(validateBuild(ship, 7, 3, 'solar_panel')).toMatch(/внешней стене/);
    expect(validateBuild(ship, 11, 6, 'solar_panel')).toBeNull();
    expect(validateBuild(ship, 13, 6, 'solar_panel')).toMatch(/пол/);
    expect(validateBuild(ship, 11, 5, 'medbay')).toBeNull();
    expect(placeBlueprint(ship, 5000, 11, 5, 'medbay')).toBeNull();
    expect(blueprintAt(ship, 12, 6)?.id).toBe(5000);
    expect(validateBuild(ship, 12, 5, 'lamp')).toMatch(/чертёж/);
    ship.blueprints[0].delivered = { ...buildCost('medbay') };
    completeBlueprint(ship, 5000, ctx);
    const bay = moduleAt(ship, 11, 5);
    expect(bay?.type).toBe('medbay');
    expect(moduleAt(ship, 12, 6)).toBe(bay);
    expect(moduleAt(ship, 13, 6)).toBeUndefined();
    expect(validateBuild(ship, 12, 6, 'lamp')).toMatch(/занята/);
  });

  it('вентиляция в стене выравнивает воздух закрытых отсеков', () => {
    const { ship, ctx } = setup();
    expect(validateBuild(ship, 7, 3, 'vent')).toMatch(/стену/);
    let spot: { x: number; y: number } | null = null;
    for (let y = 0; y < ship.h && !spot; y++) {
      for (let x = 0; x < ship.w; x++) {
        if (validateBuild(ship, x, y, 'vent') === null) spot = { x, y };
      }
    }
    expect(spot).not.toBeNull();
    const map = shipRooms(ship);
    const ids: number[] = [];
    for (const n of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const r = map.roomOf[(spot!.y + n.y) * ship.w + (spot!.x + n.x)];
      if (r >= 0 && !ids.includes(r)) ids.push(r);
    }
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const fill = (va: number, vb: number) => {
      for (const t of map.rooms[ids[0]].tiles) ship.air[t] = va;
      for (const t of map.rooms[ids[1]].tiles) ship.air[t] = vb;
    };
    const sample = () => ship.air[map.rooms[ids[1]].tiles[0]];
    fill(1, 0);
    for (let i = 0; i < 20; i++) stepAir(ship, ship.air, map, { deltas: new Map(), openDoors: new Set() }, 0.1);
    const leaked = sample();
    fill(1, 0);
    for (let i = 0; i < 20; i++) stepAir(ship, ship.air, map, { deltas: new Map(), openDoors: new Set(), vents: [[ids[0], ids[1]]] }, 0.1);
    expect(sample()).toBeGreaterThan(leaked + 0.2);
    expect(placeBlueprint(ship, 7000, spot!.x, spot!.y, 'vent')).toBeNull();
    ship.blueprints[0].delivered = { metal: 8 };
    completeBlueprint(ship, 7000, ctx);
    expect(moduleAt(ship, spot!.x, spot!.y)?.type).toBe('vent');
    expect(ship.tiles[spot!.y * ship.w + spot!.x]).toBe('wall');
  });
});

describe('пожары', () => {
  it('экипаж тушит пожар', () => {
    const { ship, ctx } = setup();
    igniteTile(ship, 7, 3, 0.5);
    expect(availableJobs(ship, ctx).some((j) => j.kind === 'extinguish')).toBe(true);
    run(ship, ctx, 30);
    expect(Object.keys(ship.fires).length).toBe(0);
  });

  it('без воздуха огонь гаснет сам', () => {
    const { ship, rng } = setup();
    igniteTile(ship, 7, 3, 1);
    ship.air = ship.air.map(() => 0);
    for (let i = 0; i < 30; i++) updateFires(ship, 0.1, rng);
    expect(Object.keys(ship.fires).length).toBe(0);
  });
});

describe('криокапсулы и важные задачи', () => {
  it('в криосне не голодают и не дышат; без питания капсула будит', () => {
    const { ship, ctx, nextId } = setup();
    ship.modules.push(makeModule(nextId(), 'cryopod', 7, 3));
    distributePower(ship, 0.1, ctx);
    const c = ship.crew[0];
    expect(orderCryo(ship, c.id)).toBeNull();
    run(ship, ctx, 20);
    expect(c.state).toBe('cryo');
    const food = c.food;
    run(ship, ctx, 60);
    expect(c.food).toBe(food);
    ship.modules.find((m) => m.type === 'cryopod')!.enabled = false;
    run(ship, ctx, 1);
    expect(c.state).not.toBe('cryo');
  });

  it('личный приоритет берёт стройку и может запретить урожай и пожар', () => {
    const { ship, ctx } = setup();
    const hydro = findModule(ship, 'hydroponics');
    hydro.growth = 1;
    expect(placeBlueprint(ship, 5000, 7, 3, 'lamp')).toBeNull();
    ship.blueprints.find((b) => b.id === 5000)!.delivered = { ...buildCost('lamp') };
    for (const c of ship.crew) {
      c.food = 100;
      c.rest = 100;
      c.health = 100;
      expect(setPriority(ship, c.id, 'build', 1)).toBeNull();
      expect(setPriority(ship, c.id, 'harvest', 0)).toBeNull();
    }
    run(ship, ctx, 0.5);
    expect(ship.crew.some((c) => c.job?.kind === 'build' && c.job.targetId === 5000)).toBe(true);
    expect(ship.crew.every((c) => c.job?.kind !== 'harvest')).toBe(true);

    for (const c of ship.crew) {
      expect(setPriority(ship, c.id, 'extinguish', 0)).toBeNull();
      c.job = null;
      c.path = [];
      c.state = 'idle';
    }
    expect(igniteTile(ship, 6, 4)).toBe(true);
    run(ship, ctx, 2);
    expect(ship.crew.every((c) => c.job?.kind !== 'extinguish')).toBe(true);
    expect(ship.fires[4 * ship.w + 6]).toBeGreaterThan(0);
    expect(setPriority(ship, ship.crew[0].id, 'build', 5)).toMatch(/0 до 4/);
  });

  it('важная задача срывает работника с текущего дела', () => {
    const { ship, ctx } = setup();
    ship.res.metal = 500;
    ship.res.crystals = 100;
    placeBlueprint(ship, 5001, 7, 6, 'laser');
    ship.blueprints.find((b) => b.id === 5001)!.delivered = { ...buildCost('laser') };
    run(ship, ctx, 1);
    placeBlueprint(ship, 5002, 11, 6, 'lamp');
    ship.blueprints.find((b) => b.id === 5002)!.delivered = { ...buildCost('lamp') };
    expect(toggleUrgent(ship, 11, 6)).toBeNull();
    run(ship, ctx, 1);
    expect(ship.crew.some((c) => c.job?.kind === 'build' && c.job.targetId === 5002)).toBe(true);
  });
});

describe('экипаж спасается от удушья', () => {
  it('уходит из комнаты без воздуха', () => {
    const { ship, ctx } = setup();
    const rooms = shipRooms(ship);
    const c = ship.crew[0];
    const room = rooms.roomOf[Math.round(c.y) * ship.w + Math.round(c.x)];
    for (const t of rooms.rooms[room].tiles) ship.air[t] = 0;
    run(ship, ctx, 8);
    expect(airAt(ship, c.x, c.y)).toBeGreaterThan(0.35);
    expect(c.health).toBeGreaterThan(50);
  });
});

describe('температура отсеков', () => {
  function support(ship: Ship, ctx: ShipContext, seconds: number) {
    const dt = 0.1;
    for (let i = 0; i < seconds * 10; i++) {
      distributePower(ship, dt, ctx);
      lifeSupport(ship, dt, ctx.nextId);
    }
  }

  it('обогреватель поднимает температуру, охладитель снижает, холод бьёт человека и не бьёт робота', () => {
    const { ship, ctx, rng } = setup();
    const rooms = shipRooms(ship);
    let spot: { x: number; y: number; room: number } | null = null;
    for (const [ri, room] of rooms.rooms.entries()) {
      if (room.vented) continue;
      for (const t of room.tiles) {
        const x = t % ship.w;
        const y = Math.floor(t / ship.w);
        if (validateBuild(ship, x, y, 'heater') === null) {
          spot = { x, y, room: ri };
          break;
        }
      }
      if (spot) break;
    }
    expect(spot).not.toBeNull();
    ship.modules.push(makeModule(9000, 'heater', spot!.x, spot!.y));
    ship.battery = 500;
    const tile = spot!.y * ship.w + spot!.x;
    const before = ship.temp[tile];
    support(ship, ctx, 25);
    expect(ship.temp[tile]).toBeGreaterThan(before + 4);

    ship.modules.find((m) => m.id === 9000)!.type = 'cooler';
    for (const t of rooms.rooms[spot!.room].tiles) ship.temp[t] = TEMP_AMBIENT;
    support(ship, ctx, 25);
    expect(ship.temp[tile]).toBeLessThan(TEMP_AMBIENT - 4);

    const human = ship.crew.find((c) => !c.robot)!;
    human.x = spot!.x;
    human.y = spot!.y;
    human.food = 80;
    human.health = 100;
    human.job = null;
    human.state = 'idle';
    for (const t of rooms.rooms[spot!.room].tiles) ship.temp[t] = -20;
    updateCrew(ship, 2, ctx);
    expect(human.health).toBeLessThan(95);
    expect(tempAt(ship, human.x, human.y)).toBe(-20);

    const robot = makeRobot(rng, ctx.nextId(), spot!.x, spot!.y);
    robot.health = 100;
    ship.crew.push(robot);
    updateCrew(ship, 2, ctx);
    expect(robot.health).toBe(100);

    human.health = 80;
    for (const t of rooms.rooms[spot!.room].tiles) ship.temp[t] = TEMP_AMBIENT;
    updateCrew(ship, 2, ctx);
    expect(human.health).toBeGreaterThanOrEqual(80);
  });

  it('открытая дверь смешивает температуру соседних отсеков', () => {
    const { ship } = setup();
    const map = shipRooms(ship);
    const door = map.doors.find((d) => d.rooms.length >= 2);
    expect(door).toBeTruthy();
    const [a, b] = door!.rooms;
    for (const t of map.rooms[a].tiles) ship.temp[t] = 40;
    for (const t of map.rooms[b].tiles) ship.temp[t] = 0;
    const cold = map.rooms[b].tiles[0];
    for (let i = 0; i < 30; i++) {
      stepTemp(ship, ship.temp, map, { roomDelta: new Map(), openDoors: new Set([door!.tile]) }, 0.1);
    }
    expect(ship.temp[cold]).toBeGreaterThan(8);
    expect(ship.temp[map.rooms[a].tiles[0]]).toBeLessThan(32);
  });
});
