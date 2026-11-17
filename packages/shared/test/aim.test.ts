import { describe, expect, it } from 'vitest';
import {
  AIM_MODULES,
  AIM_SUB_SHARE,
  NPCS,
  NPC_ENGINE_DOWN_SPEED,
  NPC_SUB_DOWN_SECONDS,
  NPC_SUB_HP_FRAC,
  TICK_RATE,
  World,
  makeModule,
  newClientCache,
  type AimKind,
  type Npc,
  type Ship,
  type StarSystem,
} from '../src';

type Hit = { damageNpc(sys: StarSystem, npc: Npc, damage: number, pierce: number, attacker: Ship | null, aim?: AimKind): void };

function setup(seed = 42) {
  const w = World.create(seed);
  const p = w.join('Тест', 'token-1');
  for (const s of w.state.systems) {
    s.npcs = [];
    s.belts = [];
    s.signals = [];
  }
  const ship = w.shipOf(p)!;
  const sys = w.state.systems[ship.systemId];
  ship.x = 3000;
  ship.y = 3000;
  const npc: Npc = { id: 999999, type: 'sentinel', x: 3250, y: 3000, vx: 0, vy: 0, heading: 0, hp: NPCS.sentinel.maxHp, shield: 0, cooldown: 0, targetShipId: null, wander: { x: 3250, y: 3000 } };
  sys.npcs.push(npc);
  return { w, p, ship, sys, npc, hit: w as unknown as Hit };
}

const steps = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.step();
};

describe('прицельный огонь', () => {
  it('команда aim: принимает четыре цели, мусор отклоняет, прицел виден в снимке', () => {
    const { w, p, ship } = setup();
    expect(ship.aim).toBe('hull');
    for (const aim of ['weapons', 'engines', 'shields', 'hull']) {
      expect(w.command(p.id, { c: 'aim', aim })).toBe(null);
      expect(w.snapshotFor(p.id, newClientCache()).ship!.aim).toBe(aim);
    }
    for (const bad of [{ c: 'aim' }, { c: 'aim', aim: 'reactor' }, { c: 'aim', aim: 5 }, { c: 'aim', aim: null }, { c: 'aim', aim: '__proto__' }]) {
      expect(typeof w.command(p.id, bad)).toBe('string');
    }
    expect(ship.aim).toBe('hull');
  });

  it('по системе идёт большая часть урона, корпусу — остаток; выбитую систему не добивают', () => {
    const { sys, npc, ship, hit, w } = setup();
    const max = NPCS.sentinel.maxHp;
    hit.damageNpc(sys, npc, 10, 0, ship, 'weapons');
    expect(max - npc.hp).toBeCloseTo(10 * (1 - AIM_SUB_SHARE));
    expect(w.npcSub(npc).weapons.hp).toBeCloseTo(max * NPC_SUB_HP_FRAC - 10 * AIM_SUB_SHARE);
    // Добиваем систему: дальше весь урон идёт в корпус.
    hit.damageNpc(sys, npc, 1000, 0, ship, 'weapons');
    expect(w.npcSub(npc).weapons.down).toBe(NPC_SUB_DOWN_SECONDS);
    if (sys.npcs.includes(npc)) throw new Error('цель должна была погибнуть от 1000 урона');
    const b = setup();
    b.hit.damageNpc(b.sys, b.npc, max * NPC_SUB_HP_FRAC / AIM_SUB_SHARE + 1, 0, b.ship, 'weapons');
    const hp = b.npc.hp;
    b.hit.damageNpc(b.sys, b.npc, 10, 0, b.ship, 'weapons');
    expect(hp - b.npc.hp).toBeCloseTo(10);
  });

  it('выбитое оружие молчит и чинится через положенное время', () => {
    const { w, p, sys, npc, ship, hit } = setup();
    // Свои орудия выключены: смотрим только на огонь врага.
    for (const m of ship.modules) if (m.type === 'laser' || m.type === 'missile' || m.type === 'shield_gen') m.enabled = false;
    ship.shield = 0;
    npc.targetShipId = ship.id;
    hit.damageNpc(sys, npc, NPCS.sentinel.maxHp * NPC_SUB_HP_FRAC / AIM_SUB_SHARE + 1, 0, ship, 'weapons');
    expect(w.npcSub(npc).weapons.down).toBeGreaterThan(0);
    expect(p.inbox.some((l) => /оружие выведено из строя/.test(l.text))).toBe(true);
    const c = w.snapshotFor(p.id, newClientCache()).contacts.find((x) => x.k === 'npc');
    expect(c && c.k === 'npc' && c.sub[0]).toBe(0);
    const hp = ship.hp;
    steps(w, NPC_SUB_DOWN_SECONDS - 2);
    expect(ship.hp).toBe(hp);
    // Починилось — снова стреляет.
    steps(w, 30);
    expect(w.npcSub(npc).weapons.down).toBe(0);
    expect(ship.hp).toBeLessThan(hp);
  });

  it('выбитые двигатели замедляют врага', () => {
    const run = (down: boolean) => {
      const { w, sys, npc, ship, hit } = setup();
      for (const m of ship.modules) if (m.type === 'laser' || m.type === 'missile') m.enabled = false;
      npc.x = ship.x + 2000;
      npc.wander = { x: ship.x, y: ship.y };
      if (down) hit.damageNpc(sys, npc, NPCS.sentinel.maxHp * NPC_SUB_HP_FRAC / AIM_SUB_SHARE + 1, 0, ship, 'engines');
      const x0 = npc.x;
      steps(w, 10);
      return Math.abs(npc.x - x0);
    };
    const normal = run(false);
    const slowed = run(true);
    expect(normal).toBeGreaterThan(20);
    expect(slowed).toBeLessThan(normal * (NPC_ENGINE_DOWN_SPEED + 0.15));
  });

  it('выбитые щиты падают в ноль и не восстанавливаются, пока система не починена', () => {
    const { w, sys, npc, ship, hit } = setup();
    for (const m of ship.modules) if (m.type === 'laser' || m.type === 'missile') m.enabled = false;
    npc.x = ship.x + 3000; // далеко, чтобы никто ни в кого не стрелял
    npc.wander = { x: npc.x, y: npc.y };
    npc.shield = 0;
    hit.damageNpc(sys, npc, NPCS.sentinel.maxHp * NPC_SUB_HP_FRAC / AIM_SUB_SHARE + 1, 1, ship, 'shields');
    steps(w, NPC_SUB_DOWN_SECONDS - 2);
    expect(npc.shield).toBe(0);
    steps(w, 10);
    expect(npc.shield).toBeGreaterThan(0);
  });

  it('по кораблю игрока прицел бьёт в модули нужной системы', () => {
    const { w, sys, ship } = setup();
    ship.shield = 0;
    for (const m of ship.modules) if (m.type === 'shield_gen') m.enabled = false;
    if (!ship.modules.some((m) => m.type === 'laser')) ship.modules.push(makeModule(w.nextId(), 'laser', 1, 1));
    const guns = ship.modules.filter((m) => AIM_MODULES.weapons.includes(m.type));
    const others = ship.modules.filter((m) => !AIM_MODULES.weapons.includes(m.type));
    const gunHp = guns.reduce((s, m) => s + m.hp, 0);
    const otherHp = others.reduce((s, m) => s + m.hp, 0);
    const hull = ship.hp;
    w.damageShip(sys, ship, 10, 1, null, 'weapons');
    expect(guns.reduce((s, m) => s + m.hp, 0)).toBeLessThan(gunHp);
    expect(others.reduce((s, m) => s + m.hp, 0)).toBe(otherHp);
    expect(hull - ship.hp).toBeCloseTo(10 * (1 - AIM_SUB_SHARE));
  });

  it('старое сохранение без прицела и систем загружается и живёт', () => {
    const { w } = setup();
    const old = JSON.parse(w.toJSON());
    for (const s of old.ships) delete s.aim;
    for (const s of old.systems) for (const n of s.npcs) delete n.sub;
    const copy = World.fromJSON(JSON.stringify(old));
    expect(copy.state.ships[0].aim).toBe('hull');
    for (let i = 0; i < 50; i++) copy.step();
    expect(copy.state.systems[0].npcs[0]?.sub?.weapons.down).toBe(0);
  });
});
