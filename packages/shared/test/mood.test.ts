import { describe, expect, it } from 'vitest';
import {
  FOOD_DECAY,
  GRIEF_SECONDS,
  MOOD_BASE,
  MOOD_BREAK_AFTER,
  MOOD_BREAK_BELOW,
  MOOD_BREAK_SECONDS,
  MOOD_HIGH_WORK,
  MOOD_LOW_WORK,
  THOUGHTS,
  TICK_RATE,
  TRAITS,
  TRAIT_KINDS,
  World,
  crewThoughts,
  makeRobot,
  moodTarget,
  moodWorkMult,
  newClientCache,
  placeCrewOnBoard,
  setStored,
  shipAlerts,
} from '../src';

function world(seed = 42) {
  const w = World.create(seed);
  const p = w.join('Тест', 'token-1');
  for (const s of w.state.systems) {
    s.npcs = [];
    s.belts = [];
    s.signals = [];
  }
  return { w, p, ship: w.shipOf(p)! };
}

const steps = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.step();
};

describe('настроение', () => {
  it('у каждого человека есть черта и стартовое настроение; у робота — нет мыслей и черты', () => {
    const { w, ship } = world();
    for (const c of ship.crew) {
      expect(TRAIT_KINDS).toContain(c.trait);
      expect(c.mood).toBe(MOOD_BASE);
    }
    const robot = makeRobot(w.rng, w.nextId(), 0, 0);
    placeCrewOnBoard(ship, robot);
    expect(robot.trait).toBe(null);
    expect(crewThoughts(ship, robot)).toEqual([]);
    steps(w, 30);
    expect(robot.mood).toBe(MOOD_BASE);
    expect(moodWorkMult(robot)).toBe(1);
  });

  it('мысли следуют за нуждами, настроение идёт к их сумме', () => {
    const { w, ship } = world();
    const c = ship.crew[0];
    c.trait = null;
    c.food = 90;
    c.rest = 90;
    // До первого тика лампы ещё не запитаны: в темноте уюта нет.
    expect(crewThoughts(ship, c)).toContain('dark');
    steps(w, 2);
    const lamp = ship.modules.find((m) => m.type === 'lamp')!;
    c.x = lamp.x;
    c.y = lamp.y;
    c.path = [];
    c.food = 90;
    c.rest = 90;
    expect(crewThoughts(ship, c)).toEqual(expect.arrayContaining(['fed', 'rested', 'cozy']));
    expect(crewThoughts(ship, c)).not.toContain('dark');
    const good = moodTarget(crewThoughts(ship, c));
    expect(good).toBe(MOOD_BASE + THOUGHTS.fed.mood + THOUGHTS.rested.mood + THOUGHTS.cozy.mood);

    c.food = 20;
    c.health = 40;
    const t = crewThoughts(ship, c);
    expect(t).toEqual(expect.arrayContaining(['hungry', 'hurt']));
    expect(t).not.toContain('fed');
    expect(moodTarget(t)).toBeLessThan(good);

    // В обычной жизни сытая выспавшаяся команда в хорошем настроении.
    for (const x of ship.crew) {
      x.food = 90;
      x.rest = 90;
      x.health = 100;
    }
    steps(w, 60);
    for (const x of ship.crew) expect(x.mood).toBeGreaterThan(MOOD_BASE);
  });

  it('настроение меняет скорость работы', () => {
    const { ship } = world();
    const c = ship.crew[0];
    c.mood = 90;
    expect(moodWorkMult(c)).toBe(MOOD_HIGH_WORK);
    c.mood = 50;
    expect(moodWorkMult(c)).toBe(1);
    c.mood = 10;
    expect(moodWorkMult(c)).toBe(MOOD_LOW_WORK);
  });

  it('долго на дне — срыв: бросает работу, тревога, потом берёт себя в руки', () => {
    const { w, p, ship } = world();
    setStored(ship, 'food', 0, w.nextId);
    ship.crew = ship.crew.slice(0, 1);
    const c = ship.crew[0];
    c.trait = null;
    c.mood = 5;
    const keepLow = () => {
      // Голод, усталость, рана и горе держат настроение ниже порога, что бы человек ни делал.
      c.food = 0;
      c.rest = 0;
      c.health = 45;
      ship.grief = GRIEF_SECONDS;
    };
    let broke = false;
    for (let s = 0; s < MOOD_BREAK_AFTER + 20 && !broke; s++) {
      keepLow();
      steps(w, 1);
      broke = c.breakdown > 0;
    }
    expect(broke).toBe(true);
    expect(c.mood).toBeLessThan(MOOD_BREAK_BELOW);
    expect(p.inbox.some((l) => /бросает работу/.test(l.text))).toBe(true);
    expect(shipAlerts(ship).some((a) => a.id === `break:${c.id}`)).toBe(true);
    const view = w.snapshotFor(p.id, newClientCache()).ship!.crew[0];
    expect(view.breakdown).toBe(true);
    expect(view.thoughts).toEqual(expect.arrayContaining(['starving', 'hurt', 'grief']));

    // Во время срыва работу не берёт, даже если она есть (мостик ждёт пилота).
    w.command(p.id, { c: 'move', x: ship.x + 500, y: ship.y });
    for (let s = 0; s < 10; s++) {
      keepLow();
      steps(w, 1);
      expect(c.job).toBe(null);
    }
    const before = c.mood;
    for (let s = 0; s < MOOD_BREAK_SECONDS && c.breakdown > 0; s++) {
      keepLow();
      steps(w, 1);
    }
    expect(c.breakdown).toBe(0);
    expect(c.mood).toBeGreaterThan(before);
    expect(p.inbox.some((l) => /взял\(а\) себя в руки/.test(l.text))).toBe(true);
  });

  it('черты: обжора ест больше аскета, крепкий дольше держится без воздуха', () => {
    const { w, ship } = world();
    const [a, b] = ship.crew;
    a.trait = 'glutton';
    b.trait = 'ascetic';
    a.food = b.food = 100;
    setStored(ship, 'food', 0, w.nextId);
    steps(w, 60);
    expect(100 - a.food).toBeCloseTo(FOOD_DECAY * 60 * TRAITS.glutton.foodDecay!, 0);
    expect(100 - b.food).toBeCloseTo(FOOD_DECAY * 60 * TRAITS.ascetic.foodDecay!, 0);

    const v = world(7);
    const [t, n] = v.ship.crew;
    t.trait = 'tough';
    n.trait = null;
    t.health = n.health = 100;
    v.ship.air.fill(0);
    for (const m of v.ship.modules) m.enabled = false;
    steps(v.w, 5);
    expect(100 - t.health).toBeGreaterThan(0);
    expect(100 - t.health).toBeLessThan((100 - n.health) * 0.75);
  });

  it('смерть на борту огорчает выживших', () => {
    const { w, ship } = world();
    ship.crew[0].health = -1;
    steps(w, 1);
    expect(ship.crew).toHaveLength(2);
    for (const c of ship.crew) expect(crewThoughts(ship, c)).toContain('grief');
    steps(w, GRIEF_SECONDS + 2);
    for (const c of ship.crew) expect(crewThoughts(ship, c)).not.toContain('grief');
  });

  it('старое сохранение без настроения загружается', () => {
    const { w } = world();
    const old = JSON.parse(w.toJSON());
    for (const s of old.ships) {
      delete s.grief;
      for (const c of s.crew) {
        delete c.mood;
        delete c.trait;
        delete c.stress;
        delete c.breakdown;
      }
    }
    const copy = World.fromJSON(JSON.stringify(old));
    const c = copy.state.ships[0].crew[0];
    expect([c.mood, c.stress, c.breakdown, copy.state.ships[0].grief]).toEqual([MOOD_BASE, 0, 0, 0]);
    // Черта выдаётся по id — одна и та же при каждой загрузке.
    expect(c.trait).toBe(TRAIT_KINDS[c.id % TRAIT_KINDS.length]);
    expect(World.fromJSON(JSON.stringify(old)).state.ships[0].crew[0].trait).toBe(c.trait);
    for (let i = 0; i < 100; i++) copy.step();
    expect(Number.isFinite(copy.state.ships[0].crew[0].mood)).toBe(true);
  });
});
