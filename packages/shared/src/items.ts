// Стопки на полу, зона склада и доставка к чертежам — как переноска в RimWorld.
import { CARRY_MAX, PHYSICAL, STACK_MAX, buildCost, type Physical, type Resource, type Resources } from './defs';
import { findPath, inBounds, isWalkable, neighbors4, tileAt } from './grid';
import type { Blueprint, ItemStack, Job, Ship, Vec } from './state';

const DUST = 1e-6;

export function isPhysical(resource: string): resource is Physical {
  return (PHYSICAL as readonly string[]).includes(resource);
}

export function inStockpile(ship: Ship, x: number, y: number): boolean {
  return ship.stockpile.includes(y * ship.w + x);
}

export function syncStored(ship: Ship): void {
  const totals: Record<Physical, number> = { metal: 0, ice: 0, water: 0, crystals: 0, biomass: 0, food: 0 };
  for (const s of ship.stacks) {
    if (s.amount <= DUST || !inStockpile(ship, s.x, s.y)) continue;
    totals[s.resource] += s.amount;
  }
  for (const r of PHYSICAL) ship.res[r] = totals[r];
  ship.stacks = ship.stacks.filter((s) => s.amount > DUST);
}

function stackAt(ship: Ship, x: number, y: number, resource: Physical): ItemStack | undefined {
  return ship.stacks.find((s) => s.x === x && s.y === y && s.resource === resource);
}

function roomOn(ship: Ship, x: number, y: number, resource: Physical): number {
  const same = stackAt(ship, x, y, resource);
  if (same) return Math.max(0, STACK_MAX - same.amount);
  if (ship.stacks.some((s) => s.x === x && s.y === y)) return 0;
  return STACK_MAX;
}

function pour(ship: Ship, x: number, y: number, resource: Physical, amount: number, nextId: () => number): number {
  let left = amount;
  const space = roomOn(ship, x, y, resource);
  const put = Math.min(space, left);
  if (put <= DUST) return left;
  const existing = stackAt(ship, x, y, resource);
  if (existing) existing.amount += put;
  else ship.stacks.push({ id: nextId(), x, y, resource, amount: put });
  left -= put;
  return left;
}

function floors(ship: Ship): Vec[] {
  const out: Vec[] = [];
  for (let y = 0; y < ship.h; y++) {
    for (let x = 0; x < ship.w; x++) {
      const tile = ship.tiles[y * ship.w + x];
      if (tile === 'floor' || tile === 'door') out.push({ x, y });
    }
  }
  return out;
}

/** Кладёт ресурс в зону склада. Что не влезло — остаётся лежать где придётся. */
export function putInStockpile(ship: Ship, resource: Physical, amount: number, nextId: () => number): void {
  let left = amount;
  const zone = ship.stockpile.map((t) => ({ x: t % ship.w, y: Math.floor(t / ship.w) }));
  for (const cell of zone) {
    if (left <= DUST) break;
    left = pour(ship, cell.x, cell.y, resource, left, nextId);
  }
  if (left > DUST) dropLoose(ship, resource, left, zone[0]?.x ?? 0, zone[0]?.y ?? 0, nextId);
  syncStored(ship);
}

/** Бросает стопку на клетку или на ближайший пол. */
export function dropLoose(ship: Ship, resource: Physical, amount: number, x: number, y: number, nextId: () => number): void {
  let left = amount;
  const spots = [{ x, y }, ...neighbors4(x, y), ...floors(ship)];
  const seen = new Set<string>();
  for (const p of spots) {
    const key = `${p.x},${p.y}`;
    if (seen.has(key) || !inBounds(ship, p.x, p.y) || !isWalkable(tileAt(ship, p.x, p.y))) continue;
    seen.add(key);
    left = pour(ship, p.x, p.y, resource, left, nextId);
    if (left <= DUST) break;
  }
  if (left > DUST) ship.stacks.push({ id: nextId(), x, y, resource, amount: left });
  syncStored(ship);
}

/** Забирает из зоны склада (еда, вода, топливо, торговля). */
export function removeStored(ship: Ship, resource: Physical, amount: number): number {
  let left = amount;
  for (const s of ship.stacks) {
    if (left <= DUST) break;
    if (s.resource !== resource || !inStockpile(ship, s.x, s.y)) continue;
    const take = Math.min(s.amount, left);
    s.amount -= take;
    left -= take;
  }
  syncStored(ship);
  return amount - left;
}

export function giveShip(ship: Ship, loot: Partial<Resources>, nextId: () => number): void {
  for (const [k, v] of Object.entries(loot)) {
    const amount = v ?? 0;
    if (amount === 0) continue;
    if (k === 'credits') ship.res.credits += amount;
    else if (isPhysical(k)) putInStockpile(ship, k, amount, nextId);
  }
}

export function takeShip(ship: Ship, cost: Partial<Resources>): boolean {
  syncStored(ship);
  const affordable = Object.entries(cost).every(([k, v]) => ship.res[k as Resource] >= (v ?? 0) - 1e-9);
  if (!affordable) return false;
  for (const [k, v] of Object.entries(cost)) {
    const amount = v ?? 0;
    if (amount === 0) continue;
    if (k === 'credits') ship.res.credits -= amount;
    else if (isPhysical(k)) removeStored(ship, k, amount);
  }
  return true;
}

/** Выставляет запас ресурса на складе. Нужно тестам и миграции сохранений. */
export function setStored(ship: Ship, resource: Physical, amount: number, nextId: () => number): void {
  ship.stacks = ship.stacks.filter((s) => s.resource !== resource);
  if (ship.stockpile.length === 0) {
    const spot = floors(ship).find((p) => !ship.stacks.some((s) => s.x === p.x && s.y === p.y));
    if (spot) ship.stockpile.push(spot.y * ship.w + spot.x);
  }
  if (amount > 0) putInStockpile(ship, resource, amount, nextId);
  else syncStored(ship);
}

export function takeFromStack(ship: Ship, stackId: number, amount: number): number {
  const s = ship.stacks.find((o) => o.id === stackId);
  if (!s) return 0;
  const take = Math.min(s.amount, amount);
  s.amount -= take;
  syncStored(ship);
  return take;
}

export function materialsReady(bp: Blueprint): boolean {
  if (bp.free || bp.remove) return true;
  const cost = buildCost(bp.kind);
  return Object.entries(cost).every(([k, v]) => (bp.delivered[k as Resource] ?? 0) + DUST >= (v ?? 0));
}

export function refundDelivered(ship: Ship, bp: Blueprint, nextId: () => number): void {
  for (const [k, v] of Object.entries(bp.delivered)) {
    if (!v || !isPhysical(k)) continue;
    dropLoose(ship, k, v, bp.x, bp.y, nextId);
  }
  bp.delivered = {};
}

function reservedOnStack(ship: Ship, stackId: number): number {
  let n = 0;
  for (const c of ship.crew) {
    if (c.carry || c.job?.kind !== 'haul' || c.job.targetId !== stackId) continue;
    n += c.job.haul?.amount ?? 0;
  }
  return n;
}

function incoming(ship: Ship, blueprintId: number, resource: Physical): number {
  let n = 0;
  for (const c of ship.crew) {
    const h = c.job?.kind === 'haul' ? c.job.haul : undefined;
    if (!h || h.blueprintId !== blueprintId || h.resource !== resource) continue;
    n += c.carry?.resource === resource ? c.carry.amount : h.amount;
  }
  return n;
}

function closest(from: Vec, cells: Vec[]): Vec | null {
  let best: Vec | null = null;
  let bestD = Infinity;
  for (const c of cells) {
    const d = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function stockpileDest(ship: Ship, resource: Physical, from: Vec, amount: number): Vec | null {
  const zone = ship.stockpile
    .map((t) => ({ x: t % ship.w, y: Math.floor(t / ship.w) }))
    .filter((p) => roomOn(ship, p.x, p.y, resource) >= Math.min(amount, 1));
  return closest(from, zone);
}

function freeOn(ship: Ship, stack: ItemStack, extra: Map<number, number>): number {
  return stack.amount - reservedOnStack(ship, stack.id) - (extra.get(stack.id) ?? 0);
}

/** Задачи переноски: сначала материалы к чертежам, потом всё лишнее на склад. Одна стопка — один носильщик. */
export function planHaulJobs(ship: Ship): Job[] {
  const jobs: Job[] = [];
  const extra = new Map<number, number>();
  for (const bp of ship.blueprints) {
    if (bp.free || bp.remove) continue;
    const cost = buildCost(bp.kind);
    for (const [k, needRaw] of Object.entries(cost)) {
      if (!isPhysical(k)) continue;
      const need = (needRaw ?? 0) - (bp.delivered[k] ?? 0) - incoming(ship, bp.id, k);
      if (need <= DUST) continue;
      const stack = ship.stacks
        .filter((s) => s.resource === k && freeOn(ship, s, extra) > DUST)
        .sort((a, b) => Math.abs(a.x - bp.x) + Math.abs(a.y - bp.y) - (Math.abs(b.x - bp.x) + Math.abs(b.y - bp.y)))[0];
      if (!stack) continue;
      const amount = Math.min(freeOn(ship, stack, extra), need, CARRY_MAX);
      extra.set(stack.id, (extra.get(stack.id) ?? 0) + amount);
      jobs.push({
        kind: 'haul',
        targetId: stack.id,
        x: stack.x,
        y: stack.y,
        haul: { resource: k, amount, destX: bp.x, destY: bp.y, blueprintId: bp.id },
      });
    }
  }
  for (const stack of ship.stacks) {
    if (inStockpile(ship, stack.x, stack.y)) continue;
    const free = freeOn(ship, stack, extra);
    if (free <= DUST) continue;
    const amount = Math.min(free, CARRY_MAX);
    const dest = stockpileDest(ship, stack.resource, stack, amount);
    if (!dest) continue;
    extra.set(stack.id, (extra.get(stack.id) ?? 0) + amount);
    jobs.push({
      kind: 'haul',
      targetId: stack.id,
      x: stack.x,
      y: stack.y,
      haul: { resource: stack.resource, amount, destX: dest.x, destY: dest.y, blueprintId: null },
    });
  }
  return jobs;
}

function pathTo(ship: Ship, from: Vec, x: number, y: number): Vec[] | null {
  if (isWalkable(tileAt(ship, x, y))) {
    if (from.x === x && from.y === y) return [];
    return findPath(ship, from, { x, y });
  }
  let best: Vec[] | null = null;
  for (const n of neighbors4(x, y)) {
    if (!isWalkable(tileAt(ship, n.x, n.y))) continue;
    const p = from.x === n.x && from.y === n.y ? [] : findPath(ship, from, n);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best;
}

/** Человек дошёл до груза или до места, куда его класть. */
export function stepHaul(ship: Ship, crewId: number, nextId: () => number): 'moving' | 'done' | 'drop' {
  const c = ship.crew.find((o) => o.id === crewId);
  const job = c?.job?.kind === 'haul' ? c.job : undefined;
  const haul = job?.haul;
  if (!c || !job || !haul) return 'drop';
  if (!c.carry) {
    const got = takeFromStack(ship, job.targetId, haul.amount);
    if (got <= DUST) return 'drop';
    c.carry = { resource: haul.resource, amount: got };
    haul.amount = got;
    const path = pathTo(ship, { x: Math.round(c.x), y: Math.round(c.y) }, haul.destX, haul.destY);
    if (!path) return 'drop';
    if (path.length === 0) return deliver(ship, c, nextId);
    c.path = path;
    c.state = 'idle';
    return 'moving';
  }
  return deliver(ship, c, nextId);
}

function deliver(ship: Ship, c: Ship['crew'][number], nextId: () => number): 'done' | 'drop' {
  const haul = c.job?.haul;
  const carry = c.carry;
  if (!haul || !carry) return 'drop';
  if (haul.blueprintId !== null) {
    const bp = ship.blueprints.find((b) => b.id === haul.blueprintId);
    if (!bp) {
      dropLoose(ship, carry.resource, carry.amount, Math.round(c.x), Math.round(c.y), nextId);
    } else {
      bp.delivered[carry.resource] = (bp.delivered[carry.resource] ?? 0) + carry.amount;
      syncStored(ship);
    }
  } else {
    const left = pour(ship, haul.destX, haul.destY, carry.resource, carry.amount, nextId);
    if (left > DUST) dropLoose(ship, carry.resource, left, haul.destX, haul.destY, nextId);
    else syncStored(ship);
  }
  c.carry = null;
  return 'done';
}

export function dropCarry(ship: Ship, c: Ship['crew'][number], nextId: () => number): void {
  if (!c.carry) return;
  dropLoose(ship, c.carry.resource, c.carry.amount, Math.round(c.x), Math.round(c.y), nextId);
  c.carry = null;
}

/** Пустые поля старого сохранения: стопки из чисел в ship.res и склад на свободном полу. */
export function normalizeStorage(ship: Ship, nextId: () => number): void {
  if (!Array.isArray(ship.stacks)) ship.stacks = [];
  if (!Array.isArray(ship.stockpile)) ship.stockpile = [];
  for (const bp of ship.blueprints) if (!bp.delivered) bp.delivered = {};
  for (const c of ship.crew) if (c.carry === undefined) c.carry = null;
  if (ship.stacks.length === 0) {
    if (ship.stockpile.length === 0) {
      ship.stockpile = floors(ship)
        .filter((p) => !ship.modules.some((m) => m.x === p.x && m.y === p.y))
        .slice(0, 8)
        .map((p) => p.y * ship.w + p.x);
    }
    for (const r of PHYSICAL) {
      const amount = ship.res[r] ?? 0;
      if (amount > DUST) putInStockpile(ship, r, amount, nextId);
    }
  }
  syncStored(ship);
}
