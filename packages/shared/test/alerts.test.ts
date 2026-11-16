import { describe, expect, it } from 'vitest';
import { TICK_RATE, World, breachHull, igniteTile, newClientCache, shipAlerts } from '../src';

function idleWorld() {
  const w = World.create(11);
  const p = w.join('Тест', 'alerts-token-1');
  for (const sys of w.state.systems) {
    sys.npcs = [];
    sys.belts = [];
  }
  return { w, p, ship: w.shipOf(p)! };
}

const steps = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.step();
};

describe('баланс выживания', () => {
  it('стартовый корабль без вмешательства игрока живёт не меньше 30 минут', () => {
    const { w, p, ship } = idleWorld();
    steps(w, 30 * 60);
    expect(p.deaths).toBe(0);
    expect(w.shipOf(p)).toBe(ship);
    expect(ship.crew.filter((c) => c.health > 50).length).toBe(3);
  });
});

describe('предупреждения', () => {
  it('у свежего корабля предупреждений нет', () => {
    const { w, ship } = idleWorld();
    steps(w, 60);
    expect(shipAlerts(ship)).toEqual([]);
  });

  it('прогноз воды: предупреждение заранее, с подсказкой, и в снимке', () => {
    const { w, p, ship } = idleWorld();
    // Первое появление предупреждения: заранее (экипаж ещё жив и здоров), сначала уровнем «внимание».
    let minute = 0;
    while (minute < 40 && !shipAlerts(ship).some((a) => a.id === 'water')) {
      steps(w, 60);
      minute++;
    }
    expect(minute).toBeGreaterThanOrEqual(15);
    expect(minute).toBeLessThanOrEqual(35);
    expect(ship.crew.filter((c) => c.health > 50).length).toBe(3);
    const water = shipAlerts(ship).find((a) => a.id === 'water');
    expect(water?.level).toBe('warn');
    expect(water?.text).toMatch(/Вода кончится через ~\d+ мин/);
    expect(water?.hint).toMatch(/лёд/i);
    const snap = w.snapshotFor(p.id, newClientCache());
    expect(snap.ship!.alerts.some((a) => a.id === 'water')).toBe(true);
  });

  it('продажа льда не вызывает ложную тревогу о воде', () => {
    const { w, p, ship } = idleWorld();
    steps(w, 60);
    expect(w.command(p.id, { c: 'trade', resource: 'ice', amount: -40 })).toBeNull();
    steps(w, 1);
    expect(shipAlerts(ship).some((a) => a.id === 'water')).toBe(false);
  });

  it('пожар, пробоина и отсутствие пилота поднимают тревогу', () => {
    const { w, p, ship } = idleWorld();
    steps(w, 5);
    igniteTile(ship, 7, 3, 0.5);
    breachHull(ship, w.rng, w.nextId());
    ship.crew.forEach((c) => (c.priorities.pilot = 0));
    w.command(p.id, { c: 'move', x: ship.x + 500, y: ship.y });
    steps(w, 1);
    const ids = shipAlerts(ship).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['fire', 'breach', 'pilot']));
  });

  it('старое сохранение без скоростей расхода загружается', () => {
    const { w } = idleWorld();
    const state = JSON.parse(w.toJSON());
    for (const s of state.ships) delete s.stats.rates;
    const loaded = World.fromJSON(JSON.stringify(state));
    steps(loaded, 2);
    expect(loaded.state.ships[0].stats.rates).toBeDefined();
  });
});
