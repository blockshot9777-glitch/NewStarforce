// ИИ экипажа в духе RimWorld: потребности → задачи → перемещение по сетке корабля.
import { CREW_SPEED, EAT_RESTORE, EAT_SECONDS, FOOD_DECAY, HYDRO_YIELD, MODULES, REST_DECAY, ROBOT_SPEED_MULT, SUFFOCATE_BELOW, DARK_WORK_MULT, TEMP_COMFORT_MAX, TEMP_COMFORT_MIN, TEMP_HURT } from './defs';
import { findPath, inBounds, isWalkable, neighbors4, tileAt } from './grid';
import { dropCarry, dropLoose, materialsReady, planHaulJobs, removeStored, stepHaul } from './items';
import { JOB_KINDS, defaultPriorities, type Crew, type Job, type JobKind, type Ship, type ShipModule, type Vec, type WorkPriority } from './state';
import { airAt, blueprintAt, completeBlueprint, functional, isLit, moduleAt, walkableTiles, type ShipContext } from './ship';
import { tempAt } from './temp';

/** Запасной порядок, когда личные приоритеты совпали: пожар, мостик, ремонт, переноска, урожай, стройка. */
const JOB_PRIORITY: JobKind[] = ['extinguish', 'pilot', 'repair', 'haul', 'harvest', 'build'];

function priorityOf(c: Crew, kind: JobKind): WorkPriority {
  const v = c.priorities?.[kind];
  return typeof v === 'number' && v >= 0 && v <= 4 ? (v as WorkPriority) : defaultPriorities()[kind];
}

/**
 * Чем меньше число, тем раньше берут задачу.
 * 0 в приоритете человека — работу пропускает.
 * Пометка «важно», пожар и пробоина обгоняют обычные дела, если человек их не запретил.
 */
function jobRank(ship: Ship, c: Crew, j: Job, urgent: Set<string>): number | null {
  if (j.kind !== 'cryo' && priorityOf(c, j.kind) === 0) return null;
  const p = priorityOf(c, j.kind);
  if (urgent.has(jobKey(j))) return p;
  if (j.kind === 'extinguish') return 10 + p;
  const breach = j.kind === 'build' && !!ship.blueprints.find((b) => b.id === j.targetId)?.free;
  if (breach) return 20 + p;
  if (j.kind === 'haul' && j.haul?.blueprintId != null) return 25 + p;
  return 30 + p * 10 + Math.max(0, JOB_PRIORITY.indexOf(j.kind));
}

/** Дописывает приоритеты старому сохранению, где поля ещё не было. */
export function normalizePriorities(c: Crew): void {
  const next = defaultPriorities();
  const raw = c.priorities;
  if (raw) {
    for (const k of JOB_KINDS) {
      const v = raw[k];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4) next[k] = v as WorkPriority;
    }
  }
  c.priorities = next;
  if (typeof c.draft !== 'boolean') c.draft = false;
  const order = c.order;
  if (!order || !Number.isInteger(order.x) || !Number.isInteger(order.y)) c.order = null;
}

export function jobKey(j: Pick<Job, 'kind' | 'targetId'>): string {
  return `${j.kind}:${j.targetId}`;
}

function roundVec(v: Vec): Vec {
  return { x: Math.round(v.x), y: Math.round(v.y) };
}

function workSpeed(ship: Ship, c: Crew, skill: keyof Crew['skills']): number {
  const tired = c.rest <= 0 ? 0.5 : 1;
  const dark = isLit(ship, c.x, c.y) ? 1 : DARK_WORK_MULT;
  return (0.5 + c.skills[skill] / 10) * tired * dark;
}

/** Путь до клетки, с которой можно работать над (x, y): сама клетка, если проходима, иначе соседняя. */
function workSpot(ship: Ship, from: Vec, x: number, y: number): Vec[] | null {
  const spots = isWalkable(tileAt(ship, x, y)) ? [{ x, y }] : [];
  for (const n of neighbors4(x, y)) if (isWalkable(tileAt(ship, n.x, n.y))) spots.push(n);
  let best: Vec[] | null = null;
  for (const s of spots) {
    const p = findPath(ship, roundVec(from), s);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best;
}

function findBreathableSpot(ship: Ship, c: Crew): Vec[] | null {
  const from = roundVec(c);
  const candidates = walkableTiles(ship)
    .filter((p) => (ship.air[p.y * ship.w + p.x] ?? 0) > 0.6)
    .sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)));
  for (const p of candidates.slice(0, 12)) {
    const path = findPath(ship, from, p);
    if (path) return path;
  }
  return null;
}

export function availableJobs(ship: Ship, ctx: Pick<ShipContext, 'wantsPilot'>): Job[] {
  const jobs: Job[] = [];
  for (const key of Object.keys(ship.fires)) {
    const t = Number(key);
    jobs.push({ kind: 'extinguish', targetId: t, x: t % ship.w, y: Math.floor(t / ship.w) });
  }
  if (ctx.wantsPilot) {
    for (const m of ship.modules) if (m.type === 'bridge' && m.hp > 0) jobs.push({ kind: 'pilot', targetId: m.id, x: m.x, y: m.y });
  }
  for (const m of ship.modules) {
    if (m.hp < MODULES[m.type].maxHp) jobs.push({ kind: 'repair', targetId: m.id, x: m.x, y: m.y });
    if (m.type === 'hydroponics' && m.growth >= 1 && m.hp > 0) jobs.push({ kind: 'harvest', targetId: m.id, x: m.x, y: m.y });
  }
  for (const b of ship.blueprints) {
    if (materialsReady(b)) jobs.push({ kind: 'build', targetId: b.id, x: b.x, y: b.y });
  }
  jobs.push(...planHaulJobs(ship));
  return jobs;
}

function podOccupant(ship: Ship, pod: ShipModule, except?: Crew): Crew | undefined {
  return ship.crew.find(
    (o) => o !== except && ((o.state === 'cryo' && Math.round(o.x) === pod.x && Math.round(o.y) === pod.y) || (o.job?.kind === 'cryo' && o.job.targetId === pod.id)),
  );
}

function jobStillValid(ship: Ship, c: Crew, job: Job, ctx: ShipContext): boolean {
  switch (job.kind) {
    case 'pilot':
      return ctx.wantsPilot && ship.modules.some((m) => m.id === job.targetId && m.hp > 0);
    case 'harvest':
      return ship.modules.some((m) => m.id === job.targetId && m.growth >= 1 && m.hp > 0);
    case 'repair':
      return ship.modules.some((m) => m.id === job.targetId && m.hp < MODULES[m.type].maxHp);
    case 'build':
      return ship.blueprints.some((b) => b.id === job.targetId && materialsReady(b));
    case 'haul': {
      if (!job.haul) return false;
      if (c.carry) {
        if (job.haul.blueprintId === null) return true;
        return ship.blueprints.some((b) => b.id === job.haul!.blueprintId);
      }
      return ship.stacks.some((s) => s.id === job.targetId && s.amount > 1e-6);
    }
    case 'extinguish':
      return ship.fires[job.targetId] !== undefined;
    case 'cryo': {
      const pod = ship.modules.find((m) => m.id === job.targetId);
      return !!pod && functional(pod) && pod.powered && !podOccupant(ship, pod, c);
    }
  }
}

function freeBed(ship: Ship, c: Crew): ShipModule | undefined {
  const taken = new Set(ship.crew.filter((o) => o !== c && o.state === 'sleeping').map((o) => `${Math.round(o.x)},${Math.round(o.y)}`));
  return ship.modules.find((m) => m.type === 'bed' && m.hp > 0 && !taken.has(`${m.x},${m.y}`));
}

function moveAlong(c: Crew, dt: number): boolean {
  let budget = CREW_SPEED * (c.robot ? ROBOT_SPEED_MULT : 1) * (c.rest <= 0 ? 0.6 : 1) * dt;
  while (budget > 0 && c.path.length) {
    const n = c.path[0];
    const dx = n.x - c.x;
    const dy = n.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      c.x = n.x;
      c.y = n.y;
      budget -= d;
      c.path.shift();
    } else {
      c.x += (dx / d) * budget;
      c.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return c.path.length === 0;
}

function goTo(ship: Ship, c: Crew, target: Vec): boolean {
  const p = findPath(ship, roundVec(c), target);
  if (!p) return false;
  c.path = p;
  return true;
}

function releaseJob(ship: Ship, c: Crew, reserved: Set<string>, nextId: () => number): void {
  dropCarry(ship, c, nextId);
  if (c.job) reserved.delete(jobKey(c.job));
  c.job = null;
  c.path = [];
  c.state = 'idle';
}

// ---------- Приказы игрока ----------

/** Отправить в криокапсулу или разбудить. */
export function orderCryo(ship: Ship, crewId: number): string | null {
  const c = ship.crew.find((o) => o.id === crewId);
  if (!c) return 'Нет такого члена экипажа на борту';
  if (c.state === 'cryo') {
    c.state = 'idle';
    c.draft = false;
    return null;
  }
  if (c.robot) return 'Роботу криосон не нужен';
  const pods = ship.modules.filter((m) => m.type === 'cryopod' && functional(m) && m.powered && !podOccupant(ship, m, c));
  for (const pod of pods) {
    const path = findPath(ship, roundVec(c), { x: pod.x, y: pod.y });
    if (!path) continue;
    c.draft = false;
    c.order = null;
    c.job = { kind: 'cryo', targetId: pod.id, x: pod.x, y: pod.y };
    c.path = path;
    c.state = 'idle';
    return null;
  }
  return 'Нет свободной запитанной криокапсулы';
}

/** Повести пешку в клетку. Текущую работу бросает и кладёт груз. */
export function orderMove(ship: Ship, crewId: number, x: number, y: number, nextId: () => number): string | null {
  const c = ship.crew.find((o) => o.id === crewId);
  if (!c) return 'Нет такого члена экипажа на борту';
  if (c.state === 'cryo') return 'Сначала разбудите';
  if (!inBounds(ship, x, y) || !isWalkable(tileAt(ship, x, y))) return 'Сюда не пройти';
  if (c.job || c.carry) dropCarry(ship, c, nextId);
  c.job = null;
  c.state = 'idle';
  c.timer = 0;
  if (Math.round(c.x) === x && Math.round(c.y) === y) {
    c.order = null;
    c.path = [];
    return null;
  }
  const path = findPath(ship, roundVec(c), { x, y });
  if (!path) return 'Сюда не пройти';
  c.order = { x, y };
  c.path = path;
  return null;
}

/** Прямое управление: пешка бросает работу и стоит, пока игрок не отправит её в клетку. */
export function setDraft(ship: Ship, crewId: number, on: boolean, nextId: () => number): string | null {
  const c = ship.crew.find((o) => o.id === crewId);
  if (!c) return 'Нет такого члена экипажа на борту';
  if (c.state === 'cryo') return 'Сначала разбудите';
  c.draft = on;
  if (!on) return null;
  if (c.job || c.carry) dropCarry(ship, c, nextId);
  c.job = null;
  c.order = null;
  c.path = [];
  c.state = 'idle';
  c.timer = 0;
  return null;
}

/** Снять приказ идти. Работу, если она уже есть, не трогает. */
export function clearOrder(ship: Ship, crewId: number): string | null {
  const c = ship.crew.find((o) => o.id === crewId);
  if (!c) return 'Нет такого члена экипажа на борту';
  c.order = null;
  if (!c.job) c.path = [];
  return null;
}

/** Идёт к клетке приказа. Приказ снимается, когда пешка дошла. */
function followOrder(ship: Ship, c: Crew, dt: number): void {
  const goal = c.order;
  if (!goal) return;
  const at = Math.round(c.x) === goal.x && Math.round(c.y) === goal.y;
  if (at && c.path.length === 0) {
    c.order = null;
    return;
  }
  const last = c.path[c.path.length - 1];
  if (!last || last.x !== goal.x || last.y !== goal.y) {
    const path = findPath(ship, roundVec(c), goal);
    if (!path) {
      c.order = null;
      c.path = [];
      return;
    }
    c.path = path;
  }
  moveAlong(c, dt);
  if (c.order && c.path.length === 0 && Math.round(c.x) === c.order.x && Math.round(c.y) === c.order.y) c.order = null;
}

/** Поставить личный приоритет работы: 1 важнее всего, 4 — в конце, 0 — не делать. */
export function setPriority(ship: Ship, crewId: number, kind: string, value: number, nextId?: () => number): string | null {
  const c = ship.crew.find((o) => o.id === crewId);
  if (!c) return 'Нет такого члена экипажа на борту';
  if (!JOB_KINDS.includes(kind as JobKind)) return 'Нет такой работы';
  if (!Number.isInteger(value) || value < 0 || value > 4) return 'Приоритет от 0 до 4';
  if (!c.priorities) c.priorities = defaultPriorities();
  c.priorities[kind as JobKind] = value as WorkPriority;
  if (c.job?.kind === kind && value === 0 && kind !== 'cryo') {
    if (c.carry && nextId) dropCarry(ship, c, nextId);
    c.job = null;
    c.path = [];
    if (c.state === 'working') c.state = 'idle';
  }
  return null;
}

/** Пометить задачу на клетке как важную (или снять пометку). */
export function toggleUrgent(ship: Ship, x: number, y: number): string | null {
  const t = y * ship.w + x;
  const bp = blueprintAt(ship, x, y);
  const m = moduleAt(ship, x, y);
  let key: string | null = null;
  if (ship.fires[t] !== undefined) key = jobKey({ kind: 'extinguish', targetId: t });
  else if (bp) key = jobKey({ kind: 'build', targetId: bp.id });
  else if (m && m.hp < MODULES[m.type].maxHp) key = jobKey({ kind: 'repair', targetId: m.id });
  else if (m && m.type === 'hydroponics' && m.growth >= 1) key = jobKey({ kind: 'harvest', targetId: m.id });
  if (!key) return 'Здесь нет задачи';
  ship.urgent = ship.urgent.includes(key) ? ship.urgent.filter((k) => k !== key) : [...ship.urgent, key];
  return null;
}

// ---------- Тик экипажа ----------

export function updateCrew(ship: Ship, dt: number, ctx: ShipContext): void {
  for (const c of ship.crew) {
    if (c.state === 'cryo') continue;
    if (!c.robot) {
      c.food = Math.max(0, c.food - FOOD_DECAY * dt);
      if (c.state !== 'sleeping') c.rest = Math.max(0, c.rest - REST_DECAY * dt);
      const suffocating = airAt(ship, c.x, c.y) < SUFFOCATE_BELOW;
      if (suffocating) c.health -= 4 * dt;
      if (c.food <= 0) c.health -= 0.5 * dt;
      // Холод и жара бьют в жилом воздухе. В вакууме урон уже даёт удушье.
      const degrees = tempAt(ship, c.x, c.y);
      const comfortable = degrees >= TEMP_COMFORT_MIN && degrees <= TEMP_COMFORT_MAX;
      if (!suffocating && degrees < TEMP_COMFORT_MIN) c.health -= TEMP_HURT * (TEMP_COMFORT_MIN - degrees) * dt;
      else if (!suffocating && degrees > TEMP_COMFORT_MAX) c.health -= TEMP_HURT * (degrees - TEMP_COMFORT_MAX) * dt;
      if (!suffocating && c.food > 20 && comfortable) c.health = Math.min(100, c.health + 0.2 * dt);
    }
  }
  for (const c of ship.crew) {
    if (c.health > 0) continue;
    dropCarry(ship, c, ctx.nextId);
    ctx.log(`${c.name} погиб(ла) на борту.`, 'bad');
  }
  ship.crew = ship.crew.filter((c) => c.health > 0);

  const jobs = availableJobs(ship, ctx);
  const existing = new Set(jobs.map(jobKey));
  ship.urgent = ship.urgent.filter((k) => {
    if (existing.has(k)) return true;
    if (!k.startsWith('build:')) return false;
    const id = Number(k.slice('build:'.length));
    return ship.blueprints.some((b) => b.id === id);
  });
  const urgent = new Set(ship.urgent);
  const reserved = new Set(ship.crew.filter((c) => c.job).map((c) => jobKey(c.job!)));
  // Сколько человек можно сорвать с текущих дел ради важных задач, которые ещё никто не взял.
  let preemptBudget = ship.urgent.filter((k) => !reserved.has(k)).length;

  for (const c of ship.crew) {
    if (c.state === 'cryo') {
      const pod = ship.modules.find((m) => m.type === 'cryopod' && m.x === Math.round(c.x) && m.y === Math.round(c.y));
      if (!pod || !functional(pod) || !pod.powered) {
        c.state = 'idle';
        ctx.log(`${c.name} проснулся(лась): криокапсула обесточена.`, 'warn');
      }
      continue;
    }

    // Заделка пробоины — аварийная работа: ради неё идут в вакуум, задержав дыхание.
    const emergency = !!c.job && c.job.kind === 'build' && !!ship.blueprints.find((b) => b.id === c.job!.targetId)?.free;
    const lowAir = !c.robot && !emergency && airAt(ship, c.x, c.y) < 0.35;
    const critical = !c.robot && (c.food < 15 || c.rest < 5 || (emergency ? c.health < 25 : c.health < 35) || lowAir);
    if (c.job) {
      const isCryo = c.job.kind === 'cryo';
      const forbidden = !isCryo && priorityOf(c, c.job.kind) === 0;
      if (forbidden || (!isCryo && critical) || !jobStillValid(ship, c, c.job, ctx)) releaseJob(ship, c, reserved, ctx.nextId);
      else if (preemptBudget > 0 && !isCryo && c.job.kind !== 'pilot' && !urgent.has(jobKey(c.job))) {
        releaseJob(ship, c, reserved, ctx.nextId);
        preemptBudget--;
      }
    }

    // Прямое управление: пешка не ест, не спит и не берёт работу, пока игрок её не отпустит.
    if (c.draft) {
      if (c.job) releaseJob(ship, c, reserved, ctx.nextId);
      if (c.state !== 'idle') c.state = 'idle';
      if (c.order) followOrder(ship, c, dt);
      else if (lowAir) {
        const last = c.path[c.path.length - 1];
        if (!last || airAt(ship, last.x, last.y) <= 0.6) c.path = findBreathableSpot(ship, c) ?? [];
        moveAlong(c, dt);
      } else c.path = [];
      continue;
    }

    switch (c.state) {
      case 'eating':
        c.timer -= dt;
        if (c.timer <= 0) {
          c.food = Math.min(100, c.food + EAT_RESTORE);
          c.state = 'idle';
        }
        continue;
      case 'sleeping': {
        if (lowAir) {
          c.state = 'idle';
          break;
        }
        const inBed = ship.modules.some((m) => m.type === 'bed' && m.hp > 0 && m.x === Math.round(c.x) && m.y === Math.round(c.y));
        c.rest = Math.min(100, c.rest + (inBed ? 2 : 1) * dt);
        if (c.rest >= 100 || (c.food < 10 && ship.res.food >= 1)) c.state = 'idle';
        continue;
      }
      case 'healing': {
        if (c.path.length) {
          moveAlong(c, dt);
          continue;
        }
        const bay = ship.modules.find((m) => m.type === 'medbay' && m.powered && m.x === Math.round(c.x) && m.y === Math.round(c.y));
        if (!bay) {
          c.state = 'idle';
          continue;
        }
        c.health = Math.min(100, c.health + 3 * dt);
        if (c.health >= 95) c.state = 'idle';
        continue;
      }
      default:
        break;
    }

    if (c.state !== 'working' && !c.job) {
      c.state = 'idle';
      // 0. Нечем дышать — бежать туда, где есть воздух.
      if (lowAir) {
        const last = c.path[c.path.length - 1];
        if (!last || airAt(ship, last.x, last.y) <= 0.6) c.path = findBreathableSpot(ship, c) ?? [];
        moveAlong(c, dt);
        continue;
      }
      // 1. Лечение.
      if (c.health < 50) {
        const bay = ship.modules.find((m) => m.type === 'medbay' && m.powered);
        if (bay && goTo(ship, c, { x: bay.x, y: bay.y })) {
          c.state = 'healing';
          continue;
        }
      }
      if (!c.robot) {
        // 2. Еда.
        if (c.food < 35 && ship.res.food >= 1) {
          removeStored(ship, 'food', 1);
          c.path = [];
          c.state = 'eating';
          c.timer = EAT_SECONDS;
          continue;
        }
        // 3. Сон.
        if (c.rest < 20) {
          if (c.path.length === 0) {
            const bed = freeBed(ship, c);
            const atBed = bed && bed.x === Math.round(c.x) && bed.y === Math.round(c.y);
            if (atBed || !bed || !goTo(ship, c, { x: bed.x, y: bed.y })) {
              c.state = 'sleeping';
              continue;
            }
          }
          moveAlong(c, dt);
          continue;
        }
      }
      // 3.5. Приказ «иди сюда» важнее работы, но не воздуха, еды и сна.
      if (c.order) {
        followOrder(ship, c, dt);
        continue;
      }
      // 4. Работа: важные, пожары и пробоины впереди, остальное — по личному приоритету, внутри — ближайшая.
      const free = jobs.filter((j) => !reserved.has(jobKey(j)));
      const dist = (j: Job) => Math.abs(j.x - c.x) + Math.abs(j.y - c.y);
      const ordered = free
        .flatMap((j) => {
          const rank = jobRank(ship, c, j, urgent);
          return rank === null ? [] : [{ j, rank }];
        })
        .sort((a, b) => a.rank - b.rank || dist(a.j) - dist(b.j))
        .map((x) => x.j);
      let taken = false;
      for (const j of ordered) {
        const path = workSpot(ship, c, j.x, j.y);
        if (!path) continue;
        c.job = j;
        c.path = path;
        c.timer = 0;
        reserved.add(jobKey(j));
        taken = true;
        break;
      }
      if (!taken && c.path.length === 0 && ctx.rng.chance(0.02)) {
        const spots = walkableTiles(ship);
        if (spots.length) goTo(ship, c, ctx.rng.pick(spots));
      }
    }

    const arrived = moveAlong(c, dt);
    if (!c.job || !arrived) continue;

    const job = c.job;
    c.state = 'working';
    switch (job.kind) {
      case 'pilot':
        break;
      case 'cryo':
        c.x = job.x;
        c.y = job.y;
        c.job = null;
        c.state = 'cryo';
        break;
      case 'extinguish': {
        const left = (ship.fires[job.targetId] ?? 0) - 0.6 * workSpeed(ship, c, 'engineering') * dt;
        if (left <= 0) {
          delete ship.fires[job.targetId];
          c.job = null;
          c.state = 'idle';
        } else ship.fires[job.targetId] = left;
        break;
      }
      case 'harvest': {
        const m = ship.modules.find((o) => o.id === job.targetId)!;
        c.timer += dt * workSpeed(ship, c, 'botany');
        if (c.timer >= 3) {
          m.growth = 0;
          dropLoose(ship, 'food', Math.round(HYDRO_YIELD * (0.8 + c.skills.botany / 20)), m.x, m.y, ctx.nextId);
          c.timer = 0;
          c.job = null;
          c.state = 'idle';
        }
        break;
      }
      case 'repair': {
        const m = ship.modules.find((o) => o.id === job.targetId)!;
        m.hp = Math.min(MODULES[m.type].maxHp, m.hp + 15 * workSpeed(ship, c, 'engineering') * dt);
        if (m.hp >= MODULES[m.type].maxHp) {
          c.job = null;
          c.state = 'idle';
        }
        break;
      }
      case 'build': {
        const bp = ship.blueprints.find((b) => b.id === job.targetId)!;
        bp.work -= workSpeed(ship, c, 'engineering') * dt;
        if (bp.work <= 0) {
          completeBlueprint(ship, bp.id, ctx);
          c.job = null;
          c.state = 'idle';
        }
        break;
      }
      case 'haul': {
        const result = stepHaul(ship, c.id, ctx.nextId);
        if (result === 'moving') {
          c.state = 'idle';
          break;
        }
        if (result === 'drop') dropCarry(ship, c, ctx.nextId);
        reserved.delete(jobKey(job));
        c.job = null;
        c.path = [];
        c.state = 'idle';
        break;
      }
    }
  }
}

export function isPiloted(ship: Ship): boolean {
  return ship.crew.some((c) => {
    if (c.job?.kind !== 'pilot' || c.state !== 'working' || c.path.length) return false;
    const bridge = ship.modules.find((m) => m.id === c.job!.targetId);
    return !!bridge && bridge.hp > 0 && Math.abs(bridge.x - c.x) + Math.abs(bridge.y - c.y) <= 1.01;
  });
}

/** Возвращает члена экипажа на борт (после экспедиции или найма) — на клетку рядом с мостиком. */
export function placeCrewOnBoard(ship: Ship, c: Crew): void {
  const bridge = ship.modules.find((m) => m.type === 'bridge');
  const spots = walkableTiles(ship).filter((p) => !moduleAt(ship, p.x, p.y));
  const all = spots.length ? spots : walkableTiles(ship);
  const spot = bridge
    ? all.sort((a, b) => Math.abs(a.x - bridge.x) + Math.abs(a.y - bridge.y) - (Math.abs(b.x - bridge.x) + Math.abs(b.y - bridge.y)))[0]
    : all[0];
  c.x = spot?.x ?? 0;
  c.y = spot?.y ?? 0;
  c.path = [];
  c.job = null;
  c.carry = c.carry ?? null;
  c.draft = false;
  c.order = null;
  c.state = 'idle';
  c.timer = 0;
  ship.crew.push(c);
}
