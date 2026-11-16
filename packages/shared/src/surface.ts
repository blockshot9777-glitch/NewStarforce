// Поверхность планеты: генерация карты, работа команды, местная жизнь.
// Карта — обычная сетка, поэтому поиск пути общий с кораблём (findPath из grid.ts).
import {
  BIOMES,
  CREATURES,
  CREW_GUN_COOLDOWN,
  CREW_GUN_DAMAGE,
  CREW_GUN_RANGE,
  CREW_GUN_SKILL_MULT,
  SHUTTLE_SAFE_RADIUS,
  SURFACE_BIOMES,
  SURFACE_CREW_SPEED,
  SURFACE_ESCALATION_SECONDS,
  SURFACE_FLEE_HEALTH,
  SURFACE_GATHER_CHUNK,
  SURFACE_WORK_MULT,
  CREATURE_DAMAGE_MULT,
  SURFACE_H,
  SURFACE_SHUTTLE_HEAL,
  SURFACE_SPAWN_BASE,
  SURFACE_SPAWN_MIN,
  SURFACE_W,
  ROBOT_SPEED_MULT,
  type Biome,
  type CreatureType,
  type Resource,
  type Tile,
} from './defs';
import { findPath, type Grid } from './grid';
import type { Rng } from './rng';
import type { Crew, Expedition, LogEntry, Surface, SurfaceCreature, Vec } from './state';

export interface SurfaceContext {
  rng: Rng;
  nextId: () => number;
  log: (text: string, level?: LogEntry['level']) => void;
  biome: Biome;
  planetName: string;
}

export function isPassable(ch: string): boolean {
  return ch === '.' || ch === ',';
}

const gridCache = new WeakMap<Surface, Grid>();

/** Сетка проходимости для поиска пути (рельеф неизменен, поэтому кэшируется). */
export function surfaceGrid(s: Surface): Grid {
  let g = gridCache.get(s);
  if (!g) {
    g = { w: s.w, h: s.h, tiles: [...s.terrain].map((ch): Tile => (isPassable(ch) ? 'floor' : 'wall')) };
    gridCache.set(s, g);
  }
  return g;
}

export function passableAt(s: Surface, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.w && y < s.h && isPassable(s.terrain[y * s.w + x]);
}

// ---------- Генерация ----------

/** Гладкий шум из нескольких слоёв случайной решётки — пятна скал и озёр, а не «соль с перцем». */
function noiseField(rng: Rng, w: number, h: number, cell: number): number[] {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = Array.from({ length: gw * gh }, () => rng.next());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const fy = y / cell;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = smooth(fx - ix);
      const ty = smooth(fy - iy);
      const v = (i: number, j: number) => grid[j * gw + i];
      const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx;
      const b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
      out.push(a + (b - a) * ty);
    }
  }
  return out;
}

/** Порог, при котором доля клеток выше него равна density. */
function threshold(values: number[], density: number): number {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * density)))];
}

export function generateSurface(rng: Rng, biome: Biome, nextId: () => number): Surface {
  const def = SURFACE_BIOMES[biome];
  const w = SURFACE_W;
  const h = SURFACE_H;
  const block = noiseField(rng, w, h, 5);
  const liquid = noiseField(rng, w, h, 7);
  const rough = noiseField(rng, w, h, 3);
  const tb = threshold(block, def.blockDensity);
  const tl = threshold(liquid, def.liquidDensity);
  const shuttle = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  const chars: string[] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const nearShuttle = Math.abs(x - shuttle.x) <= 2 && Math.abs(y - shuttle.y) <= 2;
    if (!nearShuttle && liquid[i] > tl) chars.push('~');
    else if (!nearShuttle && block[i] > tb) chars.push('#');
    else chars.push(rough[i] > 0.62 ? ',' : '.');
  }
  // Всё, до чего нельзя дойти от шаттла, заваливаем скалами — на карте не бывает «островов» с ресурсами.
  const reach = new Uint8Array(w * h);
  const stack = [shuttle.y * w + shuttle.x];
  reach[stack[0]] = 1;
  while (stack.length) {
    const t = stack.pop()!;
    const x = t % w;
    const y = Math.floor(t / w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const n = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || reach[n] || !isPassable(chars[n])) continue;
      reach[n] = 1;
      stack.push(n);
    }
  }
  for (let i = 0; i < w * h; i++) if (isPassable(chars[i]) && !reach[i]) chars[i] = '#';

  const surface: Surface = {
    w,
    h,
    terrain: chars.join(''),
    shuttle,
    nodes: [],
    creatures: [],
    actors: [],
    marked: [],
    elapsed: 0,
    spawnTimer: 0,
  };
  const free = () => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = rng.int(1, w - 2);
      const y = rng.int(1, h - 2);
      const taken = surface.nodes.some((n) => Math.abs(n.x - x) + Math.abs(n.y - y) < 3);
      if (passableAt(surface, x, y) && !taken && Math.hypot(x - shuttle.x, y - shuttle.y) > 4) return { x, y };
    }
    return null;
  };
  const totalWeight = def.nodes.reduce((s, n) => s + n.weight, 0);
  for (let i = 0; i < def.nodeCount; i++) {
    let roll = rng.range(0, totalWeight);
    let kind = 0;
    for (let k = 0; k < def.nodes.length; k++) {
      roll -= def.nodes[k].weight;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    const p = free();
    if (!p) break;
    const [lo, hi] = def.nodes[kind].amount;
    surface.nodes.push({ id: nextId(), x: p.x, y: p.y, kind, amount: rng.int(lo, hi), work: 0 });
  }
  const initial = Math.round(BIOMES[biome].threat * 8);
  for (let i = 0; i < initial; i++) spawnCreature(surface, rng, biome, nextId, 8);
  surface.spawnTimer = spawnInterval(surface, biome);
  return surface;
}

function spawnInterval(s: Surface, biome: Biome): number {
  const base = SURFACE_SPAWN_BASE / (BIOMES[biome].threat + 0.3);
  const squeeze = Math.pow(0.5, s.elapsed / SURFACE_ESCALATION_SECONDS);
  return Math.max(SURFACE_SPAWN_MIN, base * squeeze);
}

/** Новый хищник — в проходимой клетке подальше от шаттла (с краёв карты, если получится). */
function spawnCreature(s: Surface, rng: Rng, biome: Biome, nextId: () => number, minDist: number): SurfaceCreature | null {
  const types = SURFACE_BIOMES[biome].creatures;
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = rng.int(0, s.w - 1);
    const y = rng.int(0, s.h - 1);
    if (!passableAt(s, x, y) || Math.hypot(x - s.shuttle.x, y - s.shuttle.y) < minDist) continue;
    const type: CreatureType = rng.pick(types);
    const c: SurfaceCreature = { id: nextId(), type, x, y, path: [], hp: CREATURES[type].hp, cooldown: 0, repath: 0, targetCrewId: null };
    s.creatures.push(c);
    return c;
  }
  return null;
}

// ---------- Высадка ----------

export function landCrew(s: Surface, crew: Crew[]): void {
  crew.forEach((c, i) => {
    const spot = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ][i % 4];
    c.x = s.shuttle.x + spot[0];
    c.y = s.shuttle.y + spot[1];
    c.path = [];
    s.actors.push({ crewId: c.id, task: 'idle', nodeId: null, moveTo: null, cooldown: 0 });
  });
}

function moveAlong(p: { x: number; y: number; path: Vec[] }, speed: number, dt: number): boolean {
  let budget = speed * dt;
  while (budget > 0 && p.path.length) {
    const n = p.path[0];
    const dx = n.x - p.x;
    const dy = n.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      p.x = n.x;
      p.y = n.y;
      budget -= d;
      p.path.shift();
    } else {
      p.x += (dx / d) * budget;
      p.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return p.path.length === 0;
}

function round(v: { x: number; y: number }): Vec {
  return { x: Math.round(v.x), y: Math.round(v.y) };
}

function pathTo(s: Surface, from: { x: number; y: number }, to: Vec): Vec[] | null {
  return findPath(surfaceGrid(s), round(from), to);
}

function atShuttle(s: Surface, c: { x: number; y: number }): boolean {
  return Math.hypot(c.x - s.shuttle.x, c.y - s.shuttle.y) < 0.6;
}

function nearShuttle(s: Surface, c: { x: number; y: number }): boolean {
  return Math.hypot(c.x - s.shuttle.x, c.y - s.shuttle.y) <= SHUTTLE_SAFE_RADIUS;
}

/** Все живые в шаттле — можно улетать. */
export function allBoarded(e: Expedition): boolean {
  return e.surface.actors.every((a) => a.task === 'boarded');
}

/** Один шаг высадки. Возвращает погибших (уже убранных из e.crew). */
export function stepSurface(e: Expedition, dt: number, ctx: SurfaceContext): Crew[] {
  const s = e.surface;
  const def = SURFACE_BIOMES[ctx.biome];
  s.elapsed += dt;

  // Новые хищники — всё чаще, чем дольше команда на планете.
  if (!e.returning) {
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      const c = spawnCreature(s, ctx.rng, ctx.biome, ctx.nextId, 12);
      if (c) ctx.log(`${ctx.planetName}: новая угроза — ${CREATURES[c.type].name.toLowerCase()}.`, 'warn');
      s.spawnTimer = spawnInterval(s, ctx.biome);
    }
  }

  const reservedNodes = new Set(s.actors.filter((a) => a.task === 'gather' && a.nodeId !== null).map((a) => a.nodeId!));

  for (const c of e.crew) {
    const a = s.actors.find((x) => x.crewId === c.id);
    if (!a) continue;
    a.cooldown = Math.max(0, a.cooldown - dt);
    const speed = SURFACE_CREW_SPEED * (c.robot ? ROBOT_SPEED_MULT * 1.4 : 1);

    if (a.task === 'boarded') {
      c.health = Math.min(100, c.health + SURFACE_SHUTTLE_HEAL * dt);
      continue;
    }

    // Стрельба — параллельно с любым делом: ближайший хищник в радиусе.
    if (a.cooldown <= 0) {
      let best: SurfaceCreature | null = null;
      for (const cr of s.creatures) {
        const d = Math.hypot(cr.x - c.x, cr.y - c.y);
        if (d <= CREW_GUN_RANGE && (!best || d < Math.hypot(best.x - c.x, best.y - c.y))) best = cr;
      }
      if (best) {
        best.hp -= CREW_GUN_DAMAGE + c.skills.combat * CREW_GUN_SKILL_MULT;
        a.cooldown = CREW_GUN_COOLDOWN;
        if (best.targetCrewId === null) best.targetCrewId = c.id;
      }
    }

    // Выбор занятия: отзыв → ранение → приказ игрока → добыча.
    if (e.returning) {
      if (a.task !== 'board') {
        a.task = 'board';
        c.path = pathTo(s, c, s.shuttle) ?? [];
      }
    } else if (c.health < SURFACE_FLEE_HEALTH && a.task !== 'flee') {
      a.task = 'flee';
      a.nodeId = null;
      c.path = pathTo(s, c, s.shuttle) ?? [];
      ctx.log(`${ctx.planetName}: ${c.name} ранен(а) и отходит к шаттлу.`, 'warn');
    } else if (a.moveTo && a.task !== 'move' && a.task !== 'flee') {
      a.task = 'move';
      a.nodeId = null;
      c.path = pathTo(s, c, a.moveTo) ?? [];
    }

    switch (a.task) {
      case 'board':
        if (moveAlong(c, speed, dt) && atShuttle(s, c)) a.task = 'boarded';
        else if (!c.path.length) c.path = pathTo(s, c, s.shuttle) ?? [];
        continue;
      case 'flee':
        if (moveAlong(c, speed, dt) && atShuttle(s, c)) {
          c.health = Math.min(100, c.health + SURFACE_SHUTTLE_HEAL * dt);
          if (c.health >= 80) a.task = 'idle';
        } else if (!c.path.length) c.path = pathTo(s, c, s.shuttle) ?? [];
        continue;
      case 'move':
        if (moveAlong(c, speed, dt)) {
          a.moveTo = null;
          a.task = 'idle';
        }
        continue;
      default:
        break;
    }

    let node = a.nodeId !== null ? s.nodes.find((n) => n.id === a.nodeId) : undefined;
    // Помеченная игроком точка важнее текущей неотмеченной.
    const markedFree = s.nodes.filter((n) => s.marked.includes(n.id) && (!reservedNodes.has(n.id) || n.id === a.nodeId));
    if (!node || (!s.marked.includes(node.id) && markedFree.length)) {
      if (node) reservedNodes.delete(node.id);
      const pool = markedFree.length ? markedFree : s.nodes.filter((n) => !reservedNodes.has(n.id));
      const sorted = [...pool].sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y));
      node = undefined;
      for (const n of sorted.slice(0, 6)) {
        const path = pathTo(s, c, { x: n.x, y: n.y });
        if (!path) continue;
        node = n;
        c.path = path;
        break;
      }
      a.nodeId = node?.id ?? null;
      a.task = node ? 'gather' : 'idle';
      if (node) reservedNodes.add(node.id);
    }
    if (!node) continue;
    if (!moveAlong(c, speed, dt)) continue;
    const nd = def.nodes[node.kind];
    node.work += (0.5 + c.skills[nd.skill] / 10) * dt;
    if (node.work >= nd.work * SURFACE_WORK_MULT) {
      node.work = 0;
      const got = Math.min(SURFACE_GATHER_CHUNK, node.amount);
      node.amount -= got;
      e.loot[nd.resource] = (e.loot[nd.resource] ?? 0) + got;
      if (node.amount <= 0) {
        s.nodes = s.nodes.filter((n) => n !== node);
        s.marked = s.marked.filter((id) => id !== node!.id);
        a.nodeId = null;
        a.task = 'idle';
        ctx.log(`${ctx.planetName}: выработано — ${nd.name.toLowerCase()}.`, 'info');
      }
    }
  }

  // Хищники.
  for (const cr of [...s.creatures]) {
    const cd = CREATURES[cr.type];
    if (cr.hp <= 0) {
      s.creatures = s.creatures.filter((x) => x !== cr);
      for (const [res, [lo, hi]] of Object.entries(cd.loot) as [Resource, [number, number]][]) {
        e.loot[res] = (e.loot[res] ?? 0) + ctx.rng.int(lo, hi);
      }
      ctx.log(`${ctx.planetName}: угроза устранена — ${cd.name.toLowerCase()}.`, 'good');
      continue;
    }
    cr.cooldown = Math.max(0, cr.cooldown - dt);
    cr.repath -= dt;
    const exposed = e.crew.filter((c) => {
      const a = s.actors.find((x) => x.crewId === c.id);
      return a && a.task !== 'boarded' && !nearShuttle(s, c);
    });
    let target = exposed.find((c) => c.id === cr.targetCrewId);
    if (!target) {
      target = exposed
        .filter((c) => Math.hypot(c.x - cr.x, c.y - cr.y) <= cd.aggro)
        .sort((p, q) => Math.hypot(p.x - cr.x, p.y - cr.y) - Math.hypot(q.x - cr.x, q.y - cr.y))[0];
    }
    cr.targetCrewId = target?.id ?? null;
    if (target) {
      const d = Math.hypot(target.x - cr.x, target.y - cr.y);
      if (d <= 1.3) {
        cr.path = [];
        if (cr.cooldown <= 0) {
          cr.cooldown = cd.cooldown;
          target.health -= cd.damage * CREATURE_DAMAGE_MULT * (1 - target.skills.combat * 0.03);
          if (ctx.rng.chance(0.25)) {
            ctx.log(`${ctx.planetName}: ${ctx.rng.pick(BIOMES[ctx.biome].dangers).replace('{name}', target.name)}.`, 'warn');
          }
        }
        continue;
      }
      if (cr.repath <= 0 || !cr.path.length) {
        cr.path = pathTo(s, cr, round(target)) ?? [];
        cr.repath = 1;
      }
    } else if (!cr.path.length && ctx.rng.chance(0.02)) {
      const goal = { x: Math.round(cr.x) + ctx.rng.int(-5, 5), y: Math.round(cr.y) + ctx.rng.int(-5, 5) };
      if (passableAt(s, goal.x, goal.y) && Math.hypot(goal.x - s.shuttle.x, goal.y - s.shuttle.y) > SHUTTLE_SAFE_RADIUS + 1) {
        cr.path = pathTo(s, cr, goal) ?? [];
      }
    }
    moveAlong(cr, cd.speed * (target ? 1 : 0.5), dt);
  }

  const dead = e.crew.filter((c) => c.health <= 0);
  for (const c of dead) ctx.log(`${c.name} погиб(ла) на планете ${ctx.planetName}.`, 'bad');
  e.crew = e.crew.filter((c) => c.health > 0);
  s.actors = s.actors.filter((a) => e.crew.some((c) => c.id === a.crewId));
  return dead;
}

/** Приказ «иди сюда». Возвращает текст ошибки или null. */
export function orderSurfaceMove(e: Expedition, crewId: number, x: number, y: number): string | null {
  const a = e.surface.actors.find((o) => o.crewId === crewId);
  if (!a) return 'Нет такого человека на планете';
  if (a.task === 'boarded' && !e.returning) a.task = 'idle';
  if (e.returning) return 'Команда возвращается к шаттлу';
  if (!passableAt(e.surface, x, y)) return 'Туда не пройти';
  a.moveTo = { x, y };
  a.task = 'idle';
  return null;
}

export function toggleSurfaceMark(e: Expedition, nodeId: number): string | null {
  const s = e.surface;
  if (!s.nodes.some((n) => n.id === nodeId)) return 'Нет такой точки';
  s.marked = s.marked.includes(nodeId) ? s.marked.filter((id) => id !== nodeId) : [...s.marked, nodeId];
  return null;
}

