import { describe, expect, it } from 'vitest';
import { Rng, createStarterShip, dropLoose, materialsReady, placeBlueprint, planHaulJobs, removeStored, setStored, syncStored } from '../src';

function ship() {
  const rng = new Rng(1);
  let id = 1000;
  const nextId = () => id++;
  return { nextId, ship: createStarterShip({ id: 1, ownerId: 1, systemId: 0, name: 'Тест', x: 0, y: 0, rng, nextId }) };
}

describe('склад и переноска', () => {
  it('в запасе только то, что лежит в зоне склада', () => {
    const { ship: s } = ship();
    const metal = s.res.metal;
    const stack = s.stacks.find((st) => st.resource === 'metal')!;
    const cell = stack.y * s.w + stack.x;
    expect(s.stockpile.includes(cell)).toBe(true);
    s.stockpile = s.stockpile.filter((t) => t !== cell);
    syncStored(s);
    expect(s.res.metal).toBeCloseTo(metal - stack.amount, 5);
  });

  it('еда и топливо списываются со стопок склада', () => {
    const { ship: s, nextId } = ship();
    setStored(s, 'food', 10, nextId);
    expect(removeStored(s, 'food', 1)).toBe(1);
    expect(s.res.food).toBe(9);
  });

  it('чертёж без материалов получает задачу переноски, готовый — нет', () => {
    const { ship: s, nextId } = ship();
    setStored(s, 'metal', 20, nextId);
    placeBlueprint(s, 5000, 7, 3, 'lamp');
    const haul = planHaulJobs(s).find((j) => j.haul?.blueprintId === 5000);
    expect(haul?.haul?.resource).toBe('metal');
    expect(haul?.haul?.amount).toBe(3);
    const bp = s.blueprints[0];
    bp.delivered = { metal: 3 };
    expect(materialsReady(bp)).toBe(true);
    expect(planHaulJobs(s).some((j) => j.haul?.blueprintId === 5000)).toBe(false);
  });

  it('урожай вне склада становится задачей на склад', () => {
    const { ship: s, nextId } = ship();
    let spot = { x: 1, y: 1 };
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const tile = s.tiles[y * s.w + x];
        if ((tile === 'floor' || tile === 'door') && !s.stockpile.includes(y * s.w + x)) spot = { x, y };
      }
    }
    dropLoose(s, 'food', 4, spot.x, spot.y, nextId);
    const loose = s.stacks.find((st) => st.resource === 'food' && st.x === spot.x && st.y === spot.y)!;
    expect(s.stockpile.includes(spot.y * s.w + spot.x)).toBe(false);
    const job = planHaulJobs(s).find((j) => j.targetId === loose.id);
    expect(job?.haul?.blueprintId).toBeNull();
    expect(s.stockpile.includes(job!.haul!.destY * s.w + job!.haul!.destX)).toBe(true);
  });
});
