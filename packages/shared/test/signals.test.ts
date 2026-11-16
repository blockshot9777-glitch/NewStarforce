import { describe, expect, it } from 'vitest';
import {
  HULLS,
  SIGNALS,
  SIGNAL_IDENT_RANGE,
  SIGNAL_MAX_PER_SYSTEM,
  SIGNAL_RANGE,
  SIGNAL_SURVIVOR_REWARD,
  SIGNAL_TTL_SECONDS,
  TICK_RATE,
  World,
  newClientCache,
  randomCrew,
  placeCrewOnBoard,
  setStored,
  syncStored,
  type SignalKind,
} from '../src';

function stepSeconds(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.step();
}

/** Мир без врагов и метеоритов, корабль далеко от станции, рядом — сигнал нужного вида. */
function setup(kind: SignalKind, seed = 42) {
  const w = World.create(seed);
  const p = w.join('Тест', 'token-1');
  const ship = w.shipOf(p)!;
  for (const s of w.state.systems) {
    s.npcs = [];
    s.belts = [];
    s.signals = [];
  }
  const sys = w.state.systems[ship.systemId];
  ship.x = 2500;
  ship.y = -2500;
  const signal = w.spawnSignal(sys, kind, { x: ship.x + 50, y: ship.y });
  p.inbox = [];
  return { w, p, ship, sys, signal };
}

const snap = (w: World, id: number) => w.snapshotFor(id, newClientCache());

describe('сигналы в космосе', () => {
  it('со временем появляются сами, не больше максимума и вне безопасных зон', () => {
    const w = World.create(7);
    w.join('Тест', 'token-1');
    let seen = 0;
    for (let minute = 0; minute < 20; minute++) {
      stepSeconds(w, 60);
      for (const s of w.state.systems) {
        seen = Math.max(seen, s.signals.length);
        expect(s.signals.length).toBeLessThanOrEqual(SIGNAL_MAX_PER_SYSTEM);
        for (const sg of s.signals) expect(w.inSafeZone(s, sg)).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('слышен по всей системе, но опознаётся только вблизи; событие — только в упор', () => {
    const { w, p, ship, signal } = setup('wreck');
    ship.x = signal.x - SIGNAL_IDENT_RANGE - 500;
    let s = snap(w, p.id);
    let c = s.contacts.find((x) => x.k === 'signal');
    expect(c && c.k === 'signal' && c.kind).toBe(null);
    expect(s.ship!.event).toBe(null);

    ship.x = signal.x - SIGNAL_IDENT_RANGE + 50;
    s = snap(w, p.id);
    c = s.contacts.find((x) => x.k === 'signal');
    expect(c && c.k === 'signal' && c.kind).toBe('wreck');
    expect(s.ship!.event).toBe(null);

    ship.x = signal.x - SIGNAL_RANGE + 10;
    s = snap(w, p.id);
    expect(s.ship!.event?.signalId).toBe(signal.id);
    expect(s.ship!.event?.options.map((o) => o.label)).toEqual(SIGNALS.wreck.options.map((o) => o.label));
  });

  it('издалека решить нельзя; неверный вариант и мусор отклоняются, сигнал остаётся', () => {
    const { w, p, ship, sys, signal } = setup('wreck');
    ship.x = signal.x - SIGNAL_RANGE - 100;
    expect(w.command(p.id, { c: 'signal', id: signal.id, option: 0 })).toMatch(/ближе/);
    ship.x = signal.x - 20;
    for (const bad of [{ c: 'signal', id: signal.id, option: 99 }, { c: 'signal', id: signal.id, option: -1 }, { c: 'signal', id: signal.id, option: 0.5 }, { c: 'signal', id: 'x', option: 0 }, { c: 'signal', id: 123456, option: 0 }, { c: 'signal' }]) {
      expect(typeof w.command(p.id, bad)).toBe('string');
    }
    expect(sys.signals).toHaveLength(1);
  });

  it('безопасный вариант даёт добычу, пишет в журнал и убирает сигнал', () => {
    const { w, p, ship, sys, signal } = setup('wreck');
    syncStored(ship);
    const before = ship.res.metal;
    expect(w.command(p.id, { c: 'signal', id: signal.id, option: 0 })).toBe(null);
    syncStored(ship);
    expect(ship.res.metal).toBeGreaterThan(before);
    expect(sys.signals).toHaveLength(0);
    expect(p.inbox.some((l) => l.text.startsWith('Обломки ковчега:'))).toBe(true);
    // Второй раз тот же сигнал уже не разыграть.
    expect(w.command(p.id, { c: 'signal', id: signal.id, option: 0 })).toMatch(/пропал/);
  });

  it('цена списывается; не хватает — отказ без потерь, и вариант помечен недоступным', () => {
    const { w, p, ship, sys, signal } = setup('trader');
    ship.res.credits = 10;
    const ev = snap(w, p.id).ship!.event!;
    expect(ev.options[0].ok).toBe(false);
    expect(ev.options[0].why).toMatch(/Нужно/);
    expect(w.command(p.id, { c: 'signal', id: signal.id, option: 0 })).toMatch(/Нужно/);
    expect(ship.res.credits).toBe(10);
    expect(sys.signals).toHaveLength(1);

    ship.res.credits = 200;
    syncStored(ship);
    const crystals = ship.res.crystals;
    expect(w.command(p.id, { c: 'signal', id: signal.id, option: 0 })).toBe(null);
    syncStored(ship);
    expect(ship.res.credits).toBe(200 - SIGNALS.trader.options[0].cost!.credits!);
    expect(ship.res.crystals).toBeGreaterThan(crystals);
  });

  it('вариант с радаром закрыт без радара', () => {
    const { w, p, ship, signal } = setup('anomaly');
    ship.modules = ship.modules.filter((m) => m.type !== 'radar');
    const ev = snap(w, p.id).ship!.event!;
    expect(ev.options[1].ok).toBe(false);
    expect(w.command(p.id, { c: 'signal', id: signal.id, option: 1 })).toMatch(/радар/);
  });

  it('рискованный вариант: за много попыток случаются все исходы, засада — это дроны, идущие на корабль', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const { w, p, ship, sys, signal } = setup('wreck', seed);
      const hp = ship.hp;
      expect(w.command(p.id, { c: 'signal', id: signal.id, option: 1 })).toBe(null);
      const text = p.inbox.map((l) => l.text).join(' ');
      if (text.includes('приманка')) {
        seen.add('ambush');
        expect(sys.npcs.filter((n) => n.type === 'drone' && n.targetShipId === ship.id)).toHaveLength(2);
      } else if (text.includes('заминирован')) {
        seen.add('mine');
        expect(ship.hp).toBeLessThan(hp);
        expect(sys.npcs).toHaveLength(0);
      } else {
        seen.add('loot');
        expect(ship.hp).toBe(hp);
        expect(sys.npcs).toHaveLength(0);
      }
    }
    expect([...seen].sort()).toEqual(['ambush', 'loot', 'mine']);
  });

  it('выживший вступает в команду; если мест нет — оставляет кредиты', () => {
    let joined = false;
    let paid = false;
    for (let seed = 1; seed <= 40 && !(joined && paid); seed++) {
      for (const full of [false, true]) {
        const { w, p, ship, signal } = setup('distress', seed);
        setStored(ship, 'food', 50, w.nextId);
        setStored(ship, 'water', 50, w.nextId);
        if (full) while (ship.crew.length < HULLS[ship.hull].crewCap) placeCrewOnBoard(ship, randomCrew(w.rng, w.nextId(), 0, 0));
        const crew = ship.crew.length;
        const credits = ship.res.credits;
        expect(w.command(p.id, { c: 'signal', id: signal.id, option: 0 })).toBe(null);
        if (!p.inbox.some((l) => l.text.includes('просится в команду'))) continue;
        if (full) {
          expect(ship.crew.length).toBe(crew);
          expect(ship.res.credits).toBe(credits + SIGNAL_SURVIVOR_REWARD);
          paid = true;
        } else {
          expect(ship.crew.length).toBe(crew + 1);
          joined = true;
        }
      }
    }
    expect(joined && paid).toBe(true);
  });

  it('один и тот же мир даёт один и тот же исход (детерминизм), сигналы переживают сохранение', () => {
    const run = () => {
      const { w, p, signal } = setup('anomaly', 5);
      w.command(p.id, { c: 'signal', id: signal.id, option: 0 });
      return p.inbox.map((l) => l.text).join('|');
    };
    expect(run()).toBe(run());

    const { w, sys } = setup('distress');
    const copy = World.fromJSON(w.toJSON());
    expect(copy.state.systems[sys.id].signals).toEqual(sys.signals);
    // Старое сохранение без поля signals загружается.
    const old = JSON.parse(w.toJSON());
    for (const s of old.systems) delete s.signals;
    expect(World.fromJSON(JSON.stringify(old)).state.systems[0].signals).toEqual([]);
  });

  it('сигнал, к которому никто не прилетел, со временем затухает', () => {
    const { w, sys, ship } = setup('trader');
    ship.x = -9000; // далеко, чтобы ничего не мешало
    expect(sys.signals.some((s) => s.kind === 'trader')).toBe(true);
    const id = sys.signals[0].id;
    stepSeconds(w, SIGNAL_TTL_SECONDS + 2);
    expect(sys.signals.some((s) => s.id === id)).toBe(false);
  });
});
