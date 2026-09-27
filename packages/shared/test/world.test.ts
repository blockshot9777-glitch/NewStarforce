import { describe, expect, it } from 'vitest';
import { NPCS, STAR_SYSTEMS, TICK_RATE, World, newClientCache, shipRadius, systemDistance, type Ship } from '../src';

function stepSeconds(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.step();
}

function newWorld() {
  const w = World.create(42);
  const p = w.join('Тест', 'token-1');
  const ship = w.shipOf(p)!;
  return { w, p, ship };
}

/** Убираем врагов и метеориты, чтобы тест проверял одну механику. */
function pacify(w: World) {
  for (const sys of w.state.systems) {
    sys.npcs = [];
    sys.belts = [];
  }
}

function stepUntil(w: World, cond: () => boolean, maxSeconds: number) {
  for (let i = 0; i < maxSeconds * TICK_RATE; i++) {
    if (cond()) return true;
    w.step();
  }
  return cond();
}

describe('мир', () => {
  it('генерирует все звёздные системы со станциями, планетами и поясами', () => {
    const w = World.create(1);
    expect(w.state.systems.length).toBe(STAR_SYSTEMS.length);
    const home = w.state.systems[0];
    expect(home.stations.length).toBe(1);
    expect(home.planets.filter((p) => p.colony).map((p) => p.name)).toEqual(['Новая Земля', 'Красный Марс']);
    expect(home.markets.length).toBe(3);
    expect(home.asteroids.length).toBe(STAR_SYSTEMS[0].asteroids);
  });

  it('новый игрок появляется в безопасной зоне у станции', () => {
    const { w, ship } = newWorld();
    expect(w.inSafeZone(w.state.systems[0], ship)).toBe(true);
    expect(ship.crew.length).toBe(3);
  });

  it('повторный вход по тому же токену возвращает к тому же кораблю', () => {
    const { w, p, ship } = newWorld();
    w.leave(p.id);
    expect(w.activeShips().length).toBe(0);
    const again = w.join('Другое имя', 'token-1');
    expect(again.id).toBe(p.id);
    expect(w.shipOf(again)).toBe(ship);
  });

  it('корабль летит к точке, только когда пилот сел за мостик', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    const start = { x: ship.x, y: ship.y };
    expect(w.command(p.id, { c: 'move', x: start.x + 400, y: start.y })).toBeNull();
    w.step();
    expect(ship.stats.piloted).toBe(false);
    stepSeconds(w, 30);
    expect(Math.hypot(ship.x - start.x - 400, ship.y - start.y)).toBeLessThan(30);
    expect(ship.moveTarget).toBeNull();
  });

  it('бур откалывает контейнеры, тяговый луч затягивает их в трюм', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    const sys = w.state.systems[0];
    const a = sys.asteroids[0];
    a.res = { ice: 30 };
    ship.x = a.x + a.r + shipRadius(ship) + 60;
    ship.y = a.y;
    const ice = ship.res.ice;
    expect(w.command(p.id, { c: 'target', id: a.id })).toBeNull();
    expect(w.command(p.id, { c: 'mineResource', resource: 'ice' })).toBeNull();
    stepSeconds(w, 15);
    expect(ship.res.ice).toBeGreaterThan(ice + 5);
    expect(a.res.ice!).toBeLessThan(30);
  });

  it('выбранного ресурса нет в астероиде — бур не работает', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    const a = w.state.systems[0].asteroids[0];
    a.res = { metal: 30 };
    ship.x = a.x + a.r + shipRadius(ship) + 60;
    ship.y = a.y;
    w.command(p.id, { c: 'target', id: a.id });
    w.command(p.id, { c: 'mineResource', resource: 'crystals' });
    stepSeconds(w, 10);
    expect(a.res.metal).toBe(30);
  });

  it('дрон атакует корабль вне безопасной зоны, турель отстреливается, трофеи выпадают', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    const sys = w.state.systems[0];
    ship.x = 3000;
    ship.y = 3000;
    // Без щита, чтобы увидеть урон по корпусу.
    for (const m of ship.modules) if (m.type === 'shield_gen') m.enabled = false;
    ship.shield = 0;
    sys.npcs.push({
      id: 999999,
      type: 'drone',
      x: 3300,
      y: 3000,
      vx: 0,
      vy: 0,
      heading: 0,
      hp: NPCS.drone.maxHp,
      shield: NPCS.drone.maxShield,
      cooldown: 0,
      targetShipId: null,
      wander: { x: 3300, y: 3000 },
    });
    const kills = p.kills;
    stepUntil(w, () => !sys.npcs.some((n) => n.id === 999999), 120);
    expect(sys.npcs.some((n) => n.id === 999999)).toBe(false);
    expect(p.kills).toBe(kills + 1);
    expect(ship.hp).toBeLessThan(200);
    expect(w.state.ships).toContain(ship);
  });

  it('гибель корабля: груз выпадает, игрок получает новый корабль', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    const sys = w.state.systems[0];
    w.damageShip(sys, ship, 10_000, 1, null);
    expect(w.shipOf(p)).toBeUndefined();
    expect(p.deaths).toBe(1);
    expect(sys.loot.length).toBeGreaterThan(0);
    stepSeconds(w, 6);
    const next = w.shipOf(p)!;
    expect(next).toBeDefined();
    expect(next.id).not.toBe(ship.id);
  });

  it('PvP: нельзя стрелять в безопасной зоне, можно — за её пределами', () => {
    const { w, p: a, ship: sa } = newWorld();
    pacify(w);
    const b = w.join('Враг', 'token-2');
    const sb = w.shipOf(b)!;
    sa.x = 0;
    sa.y = 0;
    const home = w.state.systems[0].stations[0];
    sb.x = home.x;
    sb.y = home.y;
    w.command(a.id, { c: 'target', id: sb.id });
    sa.x = home.x + 200;
    sa.y = home.y;
    stepSeconds(w, 3);
    expect(sb.hp).toBe(200); // не изменилось: полный корпус скаута
    // Выводим обоих в открытый космос.
    sa.x = 3500;
    sa.y = -3500;
    sb.x = 3700;
    sb.y = -3500;
    sb.shield = 0;
    stepSeconds(w, 5);
    expect(sb.hp).toBeLessThan(200);
  });

  it('торговля у станции: покупка и продажа меняют кредиты и склад', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    const market = w.marketNear(ship)!;
    expect(market).not.toBeNull();
    const credits = ship.res.credits;
    const stock = market.stock.ice!;
    expect(w.command(p.id, { c: 'trade', resource: 'ice', amount: 10 })).toBeNull();
    expect(ship.res.credits).toBeLessThan(credits);
    expect(market.stock.ice).toBe(stock - 10);
    const afterBuy = ship.res.credits;
    expect(w.command(p.id, { c: 'trade', resource: 'metal', amount: -20 })).toBeNull();
    expect(ship.res.credits).toBeGreaterThan(afterBuy);
    expect(w.command(p.id, { c: 'trade', resource: 'credits', amount: 5 })).toMatch(/не торгуют/);
    expect(w.command(p.id, { c: 'trade', resource: 'ice', amount: 1.5 })).toMatch(/количество/);
  });

  it('вдали от станции торговать нельзя', () => {
    const { w, p, ship } = newWorld();
    ship.x = 3900;
    ship.y = 3900;
    expect(w.command(p.id, { c: 'trade', resource: 'ice', amount: 1 })).toMatch(/станции/);
  });

  it('найм человека и робота у станции', () => {
    const { w, p, ship } = newWorld();
    ship.res.credits = 1000;
    // У скаута 4 места: трое на старте + робот.
    expect(w.command(p.id, { c: 'recruit', robot: true })).toBeNull();
    expect(ship.crew.length).toBe(4);
    expect(ship.crew.filter((c) => c.robot).length).toBe(1);
    expect(ship.res.credits).toBe(1000 - 320);
    expect(w.command(p.id, { c: 'recruit', robot: false })).toMatch(/переполнен/);
  });

  it('смена корпуса сохраняет постройку и экипаж', () => {
    const { w, p, ship } = newWorld();
    ship.res.credits = 1000;
    ship.res.metal = 300;
    const modules = ship.modules.length;
    expect(w.command(p.id, { c: 'upgrade' })).toBeNull();
    expect(ship.hull).toBe('frigate');
    expect(ship.w).toBe(24);
    expect(ship.modules.length).toBe(modules);
    expect(ship.crew.length).toBe(3);
    expect(ship.hp).toBe(500);
  });

  it('гиперпрыжок: дальность, топливо, зарядка и прибытие', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    expect(systemDistance(0, 3)).toBeGreaterThan(7);
    expect(w.command(p.id, { c: 'jump', systemId: 3 })).toMatch(/далеко/);
    const crystals = ship.res.crystals;
    expect(w.command(p.id, { c: 'jump', systemId: 1 })).toBeNull();
    expect(ship.res.crystals).toBe(crystals - 2);
    stepUntil(w, () => ship.systemId === 1, 60);
    expect(ship.systemId).toBe(1);
    expect(ship.jump).toBeNull();
  });

  it('экспедиция на планету возвращается с добычей', () => {
    const { w, p, ship } = newWorld();
    pacify(w);
    const planet = w.state.systems[0].planets.find((pl) => pl.biome === 'ice')!;
    ship.x = planet.x + planet.r + 50;
    ship.y = planet.y;
    const crew = [ship.crew[0].id];
    expect(w.command(p.id, { c: 'expedition', planetId: planet.id, crewIds: crew })).toBeNull();
    expect(ship.crew.length).toBe(2);
    expect(w.command(p.id, { c: 'expedition', planetId: planet.id, crewIds: ship.crew.map((c) => c.id) })).toMatch(/остаться/);
    stepUntil(w, () => w.state.expeditions.length === 0, 60);
    expect(w.state.expeditions.length).toBe(0);
    // Ледяная пустошь опасна слабо, но член экипажа мог погибнуть — тогда корабль всё равно цел.
    expect(ship.crew.length).toBeGreaterThanOrEqual(2);
  });

  it('метеориты бьют корабль в поясе астероидов', () => {
    const { w, ship } = newWorld();
    for (const sys of w.state.systems) sys.npcs = [];
    const belt = w.state.systems[0].belts[0];
    ship.x = belt.x;
    ship.y = belt.y;
    ship.shield = 0;
    const hp = ship.hp;
    stepSeconds(w, 120);
    expect(ship.hp).toBeLessThan(hp);
  });

  it('офлайн-корабль заморожен и невидим', () => {
    const { w, p } = newWorld();
    const other = w.join('Другой', 'token-2');
    w.leave(p.id);
    const snap = w.snapshotFor(other.id, newClientCache());
    expect(snap.contacts.some((c) => c.k === 'ship')).toBe(false);
  });

  it('снимок: планировка отправляется один раз, пока не изменится', () => {
    const { w, p, ship } = newWorld();
    const cache = newClientCache();
    const s1 = w.snapshotFor(p.id, cache);
    expect(s1.layouts[ship.id]).toBeDefined();
    expect(s1.ship!.roomAir.length).toBe(3);
    const s2 = w.snapshotFor(p.id, cache);
    expect(s2.layouts[ship.id]).toBeUndefined();
    ship.layoutVersion++;
    expect(w.snapshotFor(p.id, cache).layouts[ship.id]).toBeDefined();
  });

  it('детерминизм и сохранение: мир из JSON продолжает жить точно так же', () => {
    const a = World.create(7);
    a.join('A', 't');
    stepSeconds(a, 20);
    const saved = a.toJSON();
    const b = World.fromJSON(saved);
    stepSeconds(a, 20);
    stepSeconds(b, 20);
    expect(b.toJSON()).toBe(a.toJSON());
  });

  it('приоритет работы ставится командой', () => {
    const { w, p, ship } = newWorld();
    const id = ship.crew[0].id;
    expect(w.command(p.id, { c: 'setPriority', crewId: id, kind: 'build', value: 1 })).toBeNull();
    expect(ship.crew[0].priorities.build).toBe(1);
    expect(w.snapshotFor(p.id, newClientCache()).ship!.crew[0].priorities.build).toBe(1);
    expect(w.command(p.id, { c: 'setPriority', crewId: id, kind: 'build', value: 5 })).toMatch(/0 до 4/);
    expect(w.command(p.id, { c: 'setPriority', crewId: id, kind: 'dance', value: 1 })).toMatch(/работ/);
    expect(ship.crew[0].priorities.build).toBe(1);
  });

  it('старое сохранение без приоритетов получает значения по умолчанию', () => {
    const w = World.create(3);
    w.join('A', 'tok');
    const raw = JSON.parse(w.toJSON()) as { ships: { crew: { priorities?: unknown }[] }[] };
    for (const c of raw.ships[0].crew) delete c.priorities;
    const loaded = World.fromJSON(JSON.stringify(raw));
    const crew = loaded.state.ships[0].crew[0];
    expect(crew.priorities).toEqual({ extinguish: 1, pilot: 2, repair: 3, harvest: 4, build: 4, cryo: 1 });
  });

  it('мусорные команды не роняют сервер', () => {
    const { w, p } = newWorld();
    const junk: unknown[] = [null, 5, 'x', {}, { c: 1 }, { c: 'move', x: 'a' }, { c: 'build', x: 1.5, y: 2, kind: 'floor' }, { c: 'build', x: 1, y: 1, kind: '__proto__' }, { c: 'target', id: {} }, { c: 'jump', systemId: 99 }, { c: 'nope' }, { c: 'setPriority', crewId: 1.5, kind: 'build', value: 1 }, { c: 'setPriority', crewId: 1, kind: 5, value: 1 }];
    for (const j of junk) expect(typeof w.command(p.id, j)).toBe('string');
    stepSeconds(w, 1);
  });
});

describe('долгий прогон', () => {
  it('10 игровых минут с тремя игроками без исключений и NaN', () => {
    const w = World.create(99);
    const ps = ['A', 'B', 'C'].map((n) => w.join(n, `tok-${n}`));
    for (let minute = 0; minute < 10; minute++) {
      for (const p of ps) {
        const s = w.shipOf(p);
        if (s) w.command(p.id, { c: 'move', x: s.x + 300 * Math.cos(minute + p.id), y: s.y + 300 * Math.sin(minute + p.id) });
      }
      stepSeconds(w, 60);
    }
    const bad = (s: Ship) => [s.x, s.y, s.hp, s.oxygen, s.battery, ...Object.values(s.res)].some((v) => !Number.isFinite(v));
    expect(w.state.ships.some(bad)).toBe(false);
    for (const p of ps) expect(w.snapshotFor(p.id, newClientCache()).t).toBe('snap');
  });
});
