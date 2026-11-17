import { describe, expect, it } from 'vitest';
import { GUIDE, TICK_RATE, World, newClientCache, syncStored } from '../src';

function setup() {
  const w = World.create(42);
  const p = w.join('Тест', 'token-1');
  for (const s of w.state.systems) {
    s.npcs = [];
    s.belts = [];
    s.signals = [];
  }
  const ship = w.shipOf(p)!;
  return { w, p, ship };
}

const steps = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.step();
};
const guide = (w: World, id: number) => w.snapshotFor(id, newClientCache()).me.guide;

describe('задачи капитана', () => {
  it('новый игрок видит первую задачу; пока ничего не сделано — она не засчитывается', () => {
    const { w, p } = setup();
    expect(guide(w, p.id)).toMatchObject({ index: 0, total: GUIDE.length, title: GUIDE[0].title, reward: GUIDE[0].reward });
    steps(w, 5);
    expect(p.guide).toBe(0);
  });

  it('выполненный шаг даёт награду ровно один раз и открывает следующий', () => {
    const { w, p, ship } = setup();
    const credits = ship.res.credits;
    w.command(p.id, { c: 'move', x: ship.x + 600, y: ship.y });
    steps(w, 20);
    expect(p.guide).toBe(1);
    expect(ship.res.credits).toBe(credits + GUIDE[0].reward);
    expect(p.inbox.some((l) => l.text.includes(`Задача выполнена: ${GUIDE[0].title}`))).toBe(true);
    expect(guide(w, p.id)?.title).toBe(GUIDE[1].title);
    steps(w, 10);
    expect(ship.res.credits).toBe(credits + GUIDE[0].reward);
  });

  it('шаги идут строго по порядку: сделанное заранее засчитается, когда до него дойдёт очередь', () => {
    const { w, p, ship } = setup();
    p.stats.jumps = 1; // прыгнул раньше времени
    steps(w, 3);
    expect(p.guide).toBe(0);
    // Проходим всю цепочку, выполняя условия по одному.
    const sys = w.state.systems[ship.systemId];
    const act: Record<string, () => void> = {
      move: () => (ship.vx = 20),
      mine: () => {
        // Настоящая добыча: встаём у астероида и берём его в цель.
        const a = sys.asteroids[0];
        ship.x = a.x - 90;
        ship.y = a.y + 20;
        ship.vx = ship.vy = 0;
        ship.moveTarget = null;
        expect(w.command(p.id, { c: 'target', id: a.id })).toBe(null);
      },
      build: () => {
        syncStored(ship);
        // Первая свободная клетка пола, куда встаёт лампа.
        let placed = false;
        for (let y = 0; y < ship.h && !placed; y++) for (let x = 0; x < ship.w && !placed; x++) placed = w.command(p.id, { c: 'build', x, y, kind: 'lamp' }) === null;
        expect(placed).toBe(true);
      },
      signal: () => {
        const sg = w.spawnSignal(sys, 'wreck', { x: ship.x + 20, y: ship.y });
        expect(w.command(p.id, { c: 'signal', id: sg.id, option: 0 })).toBe(null);
      },
      land: () => (p.stats.landings = 1),
      kill: () => (p.kills = 1),
      jump: () => undefined,
    };
    let total = 0;
    for (let i = 0; i < GUIDE.length; i++) {
      expect(p.guide).toBe(i);
      act[GUIDE[i].id]();
      for (let t = 0; t < 8 * TICK_RATE && p.guide === i; t++) {
        if (GUIDE[i].id === 'move') ship.vx = 20;
        w.step();
      }
      total += GUIDE[i].reward;
    }
    expect(p.guide).toBe(GUIDE.length);
    // Журнал читаем до снимка: снимок забирает его себе.
    expect(p.inbox.some((l) => l.text.includes('Вы готовы, капитан'))).toBe(true);
    expect(guide(w, p.id)).toBe(null);
    expect(total).toBe(GUIDE.reduce((s, g) => s + g.reward, 0));
  });

  it('старое сохранение без задач начинает с первой и не падает', () => {
    const { w } = setup();
    const old = JSON.parse(w.toJSON());
    for (const p of old.players) {
      delete p.guide;
      delete p.stats;
    }
    const copy = World.fromJSON(JSON.stringify(old));
    expect(copy.state.players[0].guide).toBe(0);
    expect(copy.state.players[0].stats).toEqual({ signals: 0, landings: 0, jumps: 0 });
    for (let i = 0; i < 30; i++) copy.step();
  });
});
