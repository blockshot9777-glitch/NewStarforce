// Настроение экипажа: складывается из «мыслей» (голод, усталость, воздух, свет, горе…), влияет на скорость
// работы, а на дне приводит к срыву. Черта характера даёт человеку постоянную особенность.
import {
  GRIEF_SECONDS,
  MOOD_BASE,
  MOOD_BREAK_AFTER,
  MOOD_BREAK_BELOW,
  MOOD_BREAK_SECONDS,
  MOOD_EXHAUSTED_BELOW,
  MOOD_FED_ABOVE,
  MOOD_HIGH,
  MOOD_HIGH_WORK,
  MOOD_HUNGRY_BELOW,
  MOOD_HURT_BELOW,
  MOOD_LOW,
  MOOD_LOW_WORK,
  MOOD_RATE,
  MOOD_RESTED_ABOVE,
  MOOD_STARVING_BELOW,
  MOOD_THIN_AIR_BELOW,
  MOOD_TIRED_BELOW,
  TEMP_COMFORT_MAX,
  TEMP_COMFORT_MIN,
  THOUGHTS,
  TRAITS,
  TRAIT_KINDS,
  type ThoughtKind,
  type TraitDef,
} from './defs';
import type { Crew, LogEntry, Ship } from './state';
import { airAt, isLit } from './ship';
import { tempAt } from './temp';

const NO_TRAIT: TraitDef = { name: '', desc: '' };

export function traitOf(c: Crew): TraitDef {
  return c.trait ? TRAITS[c.trait] : NO_TRAIT;
}

/** Что сейчас на уме у человека. У роботов мыслей нет. */
export function crewThoughts(ship: Ship, c: Crew): ThoughtKind[] {
  if (c.robot) return [];
  const out: ThoughtKind[] = [];
  const trait = traitOf(c);
  if (c.food < MOOD_STARVING_BELOW) out.push('starving');
  else if (c.food < MOOD_HUNGRY_BELOW) out.push('hungry');
  else if (c.food > MOOD_FED_ABOVE) out.push('fed');
  if (c.rest < MOOD_EXHAUSTED_BELOW) out.push('exhausted');
  else if (c.rest < MOOD_TIRED_BELOW) out.push('tired');
  else if (c.rest > MOOD_RESTED_ABOVE) out.push('rested');
  if (c.health < MOOD_HURT_BELOW) out.push('hurt');
  const thin = airAt(ship, c.x, c.y) < MOOD_THIN_AIR_BELOW;
  if (thin) out.push('thinAir');
  const degrees = tempAt(ship, c.x, c.y);
  const cold = degrees < TEMP_COMFORT_MIN;
  const hot = degrees > TEMP_COMFORT_MAX;
  if (cold) out.push('cold');
  if (hot) out.push('hot');
  // Спящему темнота не мешает.
  const dark = !isLit(ship, c.x, c.y) && !trait.ignoresDark && c.state !== 'sleeping';
  if (dark) out.push('dark');
  if (!thin && !cold && !hot && !dark && c.state !== 'sleeping') out.push('cozy');
  if ((ship.grief ?? 0) > 0) out.push('grief');
  if (trait.thought) out.push(trait.thought);
  return out;
}

/** К какому настроению ведут мысли (0..100). */
export function moodTarget(thoughts: ThoughtKind[]): number {
  let m = MOOD_BASE;
  for (const t of thoughts) m += THOUGHTS[t].mood;
  return Math.max(0, Math.min(100, m));
}

/** Множитель скорости работы от настроения. */
export function moodWorkMult(c: Crew): number {
  if (c.robot) return 1;
  return c.mood >= MOOD_HIGH ? MOOD_HIGH_WORK : c.mood < MOOD_LOW ? MOOD_LOW_WORK : 1;
}

/** Шаг настроения одного человека: движение к цели, накопление стресса, начало срыва. */
export function stepMood(ship: Ship, c: Crew, dt: number, log: (text: string, level?: LogEntry['level']) => void): void {
  if (c.robot) return;
  const target = moodTarget(crewThoughts(ship, c));
  const step = MOOD_RATE * dt;
  c.mood = Math.abs(target - c.mood) <= step ? target : c.mood + Math.sign(target - c.mood) * step;
  if (c.breakdown > 0) return;
  if (c.mood < MOOD_BREAK_BELOW) c.stress += dt;
  else c.stress = Math.max(0, c.stress - dt);
  if (c.stress >= MOOD_BREAK_AFTER) {
    c.stress = 0;
    c.breakdown = MOOD_BREAK_SECONDS;
    log(`${c.name} не выдерживает и бросает работу. Дайте человеку прийти в себя.`, 'warn');
  }
}

/** Смерть на борту: команда какое-то время горюет. */
export function startGrief(ship: Ship): void {
  ship.grief = GRIEF_SECONDS;
}

/** Поля настроения для старых сохранений и новых людей. */
export function normalizeMind(c: Crew): void {
  if (typeof c.mood !== 'number' || !Number.isFinite(c.mood)) c.mood = MOOD_BASE;
  // Люди из старых сохранений получают черту по своему id — без случайности, одинаково при каждой загрузке.
  if (!c.trait || !TRAIT_KINDS.includes(c.trait)) c.trait = c.robot ? null : TRAIT_KINDS[c.id % TRAIT_KINDS.length];
  if (typeof c.stress !== 'number') c.stress = 0;
  if (typeof c.breakdown !== 'number') c.breakdown = 0;
}
