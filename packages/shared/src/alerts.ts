// Предупреждения капитану в духе RimWorld: что вот-вот убьёт экипаж и что с этим сделать.
// Считаются из состояния корабля при сборке снимка; хранится только сглаженная скорость расхода ресурсов.
import {
  ALERT_ETA_BAD_MIN,
  ALERT_ETA_WARN_MIN,
  RATE_CLAMP_PER_MIN,
  RATE_WINDOW_SECONDS,
  RESOURCES,
  HULLS,
  type Resources,
} from './defs';
import { airAt, shipRooms } from './ship';
import type { Ship } from './state';

export interface Alert {
  /** Стабильный ключ — клиент по нему не мигает списком. */
  id: string;
  level: 'warn' | 'bad';
  text: string;
  /** Что делать — показывается подсказкой. */
  hint: string;
}

/**
 * Сглаженная скорость изменения ресурсов, единиц в минуту. Скачки от торговли и подбора груза
 * обрезаются, чтобы продажа льда не поднимала ложную тревогу «вода кончается».
 */
export function trackRates(ship: Ship, before: Resources, dt: number): void {
  const rates = (ship.stats.rates ??= {});
  const k = Math.min(1, dt / RATE_WINDOW_SECONDS);
  for (const r of RESOURCES) {
    const perMin = ((ship.res[r] - before[r]) / dt) * 60;
    const clamped = Math.max(-RATE_CLAMP_PER_MIN, Math.min(RATE_CLAMP_PER_MIN, perMin));
    const prev = rates[r] ?? 0;
    rates[r] = prev + (clamped - prev) * k;
  }
}

/** Через сколько минут кончится запас при текущем расходе (Infinity — не кончится). */
function eta(amount: number, ratePerMin: number): number {
  return ratePerMin < -0.05 ? amount / -ratePerMin : Infinity;
}

function fmtMin(m: number): string {
  return m < 1 ? 'меньше чем через минуту' : `через ~${Math.round(m)} мин`;
}

export function shipAlerts(ship: Ship): Alert[] {
  const out: Alert[] = [];
  const rates = ship.stats.rates ?? {};
  const living = ship.crew.filter((c) => !c.robot && c.state !== 'cryo');

  // Вода: считаем лёд запасом воды — водоочиститель его растопит.
  const water = ship.res.water + ship.res.ice;
  const waterEta = eta(water, (rates.water ?? 0) + (rates.ice ?? 0));
  const waterHint = 'Купите лёд на рынке станции или добудьте его из астероида: выберите астероид → «Лёд».';
  if (water < 0.5 && ship.modules.some((m) => m.type === 'o2gen')) {
    out.push({ id: 'water', level: 'bad', text: 'Нет воды — генератор кислорода стоит', hint: waterHint });
  } else if (waterEta < ALERT_ETA_WARN_MIN) {
    out.push({ id: 'water', level: waterEta < ALERT_ETA_BAD_MIN ? 'bad' : 'warn', text: `Вода кончится ${fmtMin(waterEta)}`, hint: waterHint });
  }

  const foodEta = eta(ship.res.food, rates.food ?? 0);
  const foodHint = 'Постройте гидропонику (Еда), проверьте, что работа «Урожай» кому-то разрешена, или купите еду.';
  if (living.length && ship.res.food < 1 && living.some((c) => c.food < 35)) {
    out.push({ id: 'food', level: 'bad', text: 'Нет еды — экипаж голодает', hint: foodHint });
  } else if (living.length && foodEta < ALERT_ETA_WARN_MIN) {
    out.push({ id: 'food', level: foodEta < ALERT_ETA_BAD_MIN ? 'bad' : 'warn', text: `Еда кончится ${fmtMin(foodEta)}`, hint: foodHint });
  }

  const suffocating = living.filter((c) => airAt(ship, c.x, c.y) < 0.4);
  if (suffocating.length) {
    out.push({
      id: 'air',
      level: 'bad',
      text: `Мало воздуха: ${suffocating.map((c) => c.name.split(' ')[0]).join(', ')}`,
      hint: 'Проверьте воду и питание генератора O₂, заделайте пробоины, включите вентиляцию между отсеками.',
    });
  } else if (ship.stats.oxygenCap > 0 && ship.oxygen / ship.stats.oxygenCap < 0.5) {
    out.push({ id: 'air', level: 'warn', text: 'Кислорода на борту меньше половины', hint: 'Генератору O₂ нужны вода и энергия.' });
  }

  if (shipRooms(ship).rooms.some((r) => r.vented)) {
    out.push({ id: 'breach', level: 'bad', text: 'Пробоина: отсек теряет воздух', hint: 'Экипаж заделает её сам, если работа «Аварии» кому-то разрешена.' });
  }

  const fires = Object.keys(ship.fires).length;
  if (fires) {
    out.push({ id: 'fire', level: 'bad', text: `Пожар на борту (${fires})`, hint: 'Тушат люди с разрешённой работой «Аварии». Без воздуха огонь гаснет сам.' });
  }

  if (ship.stats.powerDemand > ship.stats.powerOutput + 0.01 && ship.battery < ship.stats.batteryCap * 0.25 + 1e-9) {
    out.push({
      id: 'power',
      level: 'warn',
      text: 'Нехватка энергии — часть модулей отключена',
      hint: 'Постройте реактор или солнечные панели (Энергия); лишнее отключите Shift+кликом.',
    });
  }

  if ((ship.moveTarget || ship.jump) && !ship.stats.piloted) {
    out.push({
      id: 'pilot',
      level: 'warn',
      text: 'Нет пилота — корабль стоит',
      hint: 'Нужен свободный человек с разрешённой работой «Пилот» и целый мостик.',
    });
  }

  const maxHp = HULLS[ship.hull].maxHp;
  if (ship.hp < maxHp * 0.3) {
    out.push({ id: 'hull', level: 'bad', text: `Корпус ${Math.round((ship.hp / maxHp) * 100)}%`, hint: 'Отремонтируйте корабль у станции или колонии.' });
  }

  for (const c of living) {
    if (c.health < 35) {
      out.push({ id: `hurt:${c.id}`, level: 'warn', text: `${c.name} тяжело ранен(а)`, hint: 'Нужен запитанный медотсек.' });
    }
  }
  return out;
}
