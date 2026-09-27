// HTML-интерфейс поверх холста: ресурсы, строительство, команда, цели, торговля, экспедиции, прыжки, чат.
import {
  BIOMES,
  BUY_MARKUP,
  CATEGORY_NAMES,
  EXPEDITION_MAX_CREW,
  HULLS,
  MODULES,
  MODULE_TYPES,
  NPCS,
  RECRUIT_COST,
  RESOURCES,
  RESOURCE_NAMES,
  ROBOT_COST,
  STAR_SYSTEMS,
  STRUCTURE_COST,
  STRUCTURE_WORK,
  systemDistance,
  type BuildCategory,
  type BuildKind,
  type Contact,
  type OwnShipView,
  type Resource,
  type Resources,
} from '@starforce/shared';
import { send } from './net';
import { store, toast, type Mode } from './store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const RES_ICON: Record<Resource, string> = {
  metal: '⛓',
  ice: '❄',
  water: '💧',
  crystals: '💎',
  biomass: '🌿',
  food: '🍞',
  credits: '₵',
};

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.floor(n));
}

function costText(cost: Partial<Resources>): string {
  return Object.entries(cost)
    .map(([k, v]) => `${RES_ICON[k as Resource]}${v}`)
    .join(' ');
}

function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

const STATE_NAMES: Record<string, string> = {
  idle: 'свободен',
  working: 'работает',
  eating: 'ест',
  sleeping: 'спит',
  healing: 'лечится',
  cryo: 'криосон',
};
const JOB_NAMES: Record<string, string> = {
  build: 'стройка',
  harvest: 'урожай',
  repair: 'ремонт',
  pilot: 'пилотирует',
  extinguish: 'тушит пожар',
  cryo: 'идёт в капсулу',
};

const BUILD_ITEMS: Record<BuildCategory, BuildKind[]> = {
  orders: [],
  tiles: ['floor', 'wall', 'door'],
  power: [],
  air: [],
  water: [],
  food: [],
  furniture: [],
  medicine: [],
  security: [],
  ship: [],
};
for (const t of MODULE_TYPES) BUILD_ITEMS[MODULES[t].category].push(t);

const STRUCTURE_NAMES: Record<string, string> = { floor: 'Пол', wall: 'Стена', door: 'Дверь' };

export function kindName(kind: BuildKind): string {
  return kind in MODULES ? MODULES[kind as keyof typeof MODULES].name : STRUCTURE_NAMES[kind];
}

// ---------- Действия ----------

export function setMode(mode: Mode): void {
  if (store.mode === mode) return;
  if (store.mode === 'ship') store.shipZoom = store.zoomTarget;
  else store.systemZoom = store.zoomTarget;
  store.mode = mode;
  store.zoomTarget = mode === 'ship' ? store.shipZoom : store.systemZoom;
  if (mode === 'system') {
    store.tool = null;
    store.panel = null;
  }
}

function handleAction(el: HTMLElement): void {
  const act = el.dataset.act!;
  const id = Number(el.dataset.id);
  const own = store.snap?.ship;
  switch (act) {
    case 'mode':
      setMode(store.mode === 'ship' ? 'system' : 'ship');
      break;
    case 'panel': {
      const p = el.dataset.panel as 'build' | 'crew';
      store.panel = store.panel === p ? null : p;
      if (store.mode !== 'ship') setMode('ship');
      break;
    }
    case 'category':
      store.buildCategory = el.dataset.cat!;
      if (store.buildCategory !== 'orders') break;
      break;
    case 'tool':
      store.tool = store.tool === el.dataset.kind ? null : (el.dataset.kind as BuildKind | 'remove' | 'urgent');
      break;
    case 'air':
      store.airOverlay = !store.airOverlay;
      break;
    case 'galaxy':
      store.galaxyOpen = !store.galaxyOpen;
      break;
    case 'jump':
      send({ c: 'jump', systemId: id });
      store.galaxyOpen = false;
      break;
    case 'stop':
      send({ c: 'stop' });
      break;
    case 'cryo':
      send({ c: 'cryo', crewId: id });
      break;
    case 'selcrew':
      store.selectedCrew = store.selectedCrew === id ? null : id;
      break;
    case 'expcrew':
      if (store.expeditionCrew.has(id)) store.expeditionCrew.delete(id);
      else if (store.expeditionCrew.size < EXPEDITION_MAX_CREW) store.expeditionCrew.add(id);
      else toast(`Не больше ${EXPEDITION_MAX_CREW} человек в шаттле`);
      break;
    case 'expedition':
      send({ c: 'expedition', planetId: id, crewIds: [...store.expeditionCrew] });
      store.expeditionCrew.clear();
      break;
    case 'recall':
      send({ c: 'recall', expeditionId: id });
      break;
    case 'target':
      send({ c: 'target', id });
      break;
    case 'untarget':
      send({ c: 'target', id: null });
      break;
    case 'goto': {
      const c = store.snap?.contacts.find((o) => o.id === id);
      if (c && own) {
        const r = 'r' in c ? c.r : 20;
        const d = Math.hypot(c.x - own.x, c.y - own.y) || 1;
        const stand = r + 120;
        send({ c: 'move', x: c.x + ((own.x - c.x) / d) * stand, y: c.y + ((own.y - c.y) / d) * stand });
      }
      break;
    }
    case 'mine': {
      const res = el.dataset.res === 'any' ? null : (el.dataset.res as Resource);
      send({ c: 'mineResource', resource: res });
      send({ c: 'target', id });
      break;
    }
    case 'trade':
      send({ c: 'trade', resource: el.dataset.res as Resource, amount: Number(el.dataset.amount) });
      break;
    case 'recruit':
      send({ c: 'recruit', robot: el.dataset.robot === '1' });
      break;
    case 'upgrade':
      send({ c: 'upgrade' });
      break;
    case 'repair':
      send({ c: 'repair' });
      break;
    case 'toggle':
      send({ c: 'toggle', moduleId: id });
      break;
    case 'help':
      $('help').classList.toggle('hidden');
      break;
  }
  renderUi(true);
}

export function initUi(): void {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (el) {
      e.preventDefault();
      handleAction(el);
    }
  });
  const chat = $<HTMLInputElement>('chat-input');
  chat.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (chat.value.trim()) send({ c: 'chat', text: chat.value });
      chat.value = '';
      chat.blur();
    } else if (e.key === 'Escape') chat.blur();
  });
}

// ---------- Отрисовка панелей ----------

let lastUi = 0;

export function renderUi(force = false): void {
  const now = performance.now();
  if (!force && now - lastUi < 200) return;
  lastUi = now;
  const snap = store.snap;
  if (!snap) return;
  const own = snap.ship;
  renderTop(own, snap.systemId, snap.population);
  renderButtons(own);
  renderBuild(own);
  renderCrew(own);
  renderContext(own);
  renderGalaxy(own, snap.systemId);
  renderLog();
  const dead = $('dead');
  if (!own) {
    dead.classList.remove('hidden');
    setHtml(dead, `<h2>Корабль потерян</h2><p>Экипаж погиб. Как и в оригинале — всё сначала.</p><p>Новый корабль через ${Math.ceil(snap.me.respawnIn)} с…</p>`);
  } else dead.classList.add('hidden');
}

function meter(label: string, value: number, max: number, color: string, text?: string): string {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return `<div class="meter" title="${esc(label)}"><span class="meter-label">${esc(label)}</span><div class="meter-bar"><div style="width:${(frac * 100).toFixed(0)}%;background:${color}"></div></div><span class="meter-val">${esc(text ?? `${fmt(value)}/${fmt(max)}`)}</span></div>`;
}

function renderTop(own: OwnShipView | null, systemId: number, population: number[]): void {
  if (!own) {
    setHtml($('top'), '');
    return;
  }
  const res = RESOURCES.map((r) => `<span class="res" title="${RESOURCE_NAMES[r]}">${RES_ICON[r]} ${fmt(own.res[r])}</span>`).join('');
  const deficit = own.powerDemand > own.powerOutput + 0.01;
  const html = `
    <div class="res-row">${res}</div>
    <div class="meters">
      ${meter('Корпус', own.hp, own.maxHp, '#ff7043')}
      ${meter('Щит', own.shield, own.maxShield, '#b388ff')}
      ${meter('Кислород', own.oxygen, own.oxygenCap, '#4dd0e1', `${Math.round((own.oxygen / Math.max(1, own.oxygenCap)) * 100)}%`)}
      ${meter('Энергия', own.powerOutput, Math.max(own.powerOutput, own.powerDemand), deficit ? '#ff5252' : '#ffd740', `${own.powerOutput.toFixed(0)}/${own.powerDemand.toFixed(0)}`)}
      ${meter('Батарея', own.battery, own.batteryCap, '#c6ff00')}
    </div>
    <div class="status">
      <span>${esc(STAR_SYSTEMS[systemId].name)}</span>
      <span class="${own.piloted ? 'ok' : 'warn'}">${own.piloted ? '✈ пилот за пультом' : '✈ нет пилота'}</span>
      ${own.inSafeZone ? '<span class="ok">безопасная зона</span>' : ''}
      ${own.jump ? `<span class="warn">прыжок: ${own.jump.timeLeft.toFixed(0)} с</span>` : ''}
      <span title="Игроков онлайн по системам">👥 ${population.reduce((a, b) => a + b, 0)}</span>
    </div>`;
  setHtml($('top'), html);
}

function renderButtons(own: OwnShipView | null): void {
  const ship = store.mode === 'ship';
  setHtml(
    $('buttons-left'),
    own
      ? `<button data-act="panel" data-panel="build" class="${store.panel === 'build' ? 'on' : ''}">🛠 Строительство</button>
         <button data-act="panel" data-panel="crew" class="${store.panel === 'crew' ? 'on' : ''}">👥 Команда</button>
         <button data-act="air" class="${store.airOverlay ? 'on' : ''}">💨 Воздух</button>
         <button data-act="help">?</button>`
      : '',
  );
  setHtml(
    $('buttons-right'),
    own
      ? `${!ship ? `<button data-act="galaxy" class="${store.galaxyOpen ? 'on' : ''}">🌌 Гиперпрыжок</button>` : ''}
         ${own.moveTarget || own.jump ? '<button data-act="stop">■ Стоп</button>' : ''}
         <button data-act="mode" class="big">⚙ ${ship ? 'Звёздная система' : 'Корабль'}</button>`
      : '',
  );
}

function renderBuild(own: OwnShipView | null): void {
  const el = $('build');
  if (!own || store.panel !== 'build' || store.mode !== 'ship') {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const cats = (Object.keys(CATEGORY_NAMES) as BuildCategory[])
    .map((c) => `<button data-act="category" data-cat="${c}" class="${store.buildCategory === c ? 'on' : ''}">${CATEGORY_NAMES[c]}</button>`)
    .join('');
  let items: string;
  if (store.buildCategory === 'orders') {
    items = [
      ['remove', '⛏', 'Разобрать', 'Снести постройку (вернётся половина ресурсов) или отменить чертёж'],
      ['urgent', '❗', 'Важно', 'Пометить задачу на клетке как важную — экипаж возьмётся за неё сразу'],
    ]
      .map(
        ([k, icon, name, desc]) =>
          `<button class="item ${store.tool === k ? 'on' : ''}" data-act="tool" data-kind="${k}" title="${esc(desc)}"><span class="glyph">${icon}</span><span>${name}</span></button>`,
      )
      .join('');
  } else {
    items = BUILD_ITEMS[store.buildCategory as BuildCategory]
      .map((k) => {
        const isModule = k in MODULES;
        const def = isModule ? MODULES[k as keyof typeof MODULES] : null;
        const cost = isModule ? def!.cost : STRUCTURE_COST[k as keyof typeof STRUCTURE_COST];
        const work = isModule ? def!.work : STRUCTURE_WORK[k as keyof typeof STRUCTURE_WORK];
        const desc = def ? `${def.desc}${def.demand ? ` Потребление: ${def.demand}.` : ''}${def.output ? ` Выработка: ${def.output}.` : ''}` : 'Тяните мышью, чтобы строить рядами.';
        return `<button class="item ${store.tool === k ? 'on' : ''}" data-act="tool" data-kind="${k}" title="${esc(desc)} Работа: ${work} с.">
          <span class="glyph" style="color:${def?.color ?? '#b0bec5'}">${def?.glyph ?? (k === 'wall' ? '▇' : k === 'door' ? '⊟' : '▢')}</span>
          <span>${esc(kindName(k))}</span><span class="cost">${costText(cost)}</span></button>`;
      })
      .join('');
  }
  setHtml(el, `<div class="cats">${cats}</div><div class="items">${items}</div>`);
}

function bar(v: number, color: string): string {
  return `<div class="mini"><div style="width:${Math.max(0, Math.min(100, v)).toFixed(0)}%;background:${color}"></div></div>`;
}

function renderCrew(own: OwnShipView | null): void {
  const el = $('crew');
  if (!own || store.panel !== 'crew' || store.mode !== 'ship') {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const away = store.snap!.expeditions.reduce((s, e) => s + e.crew.length, 0);
  const rows = own.crew
    .map((c) => {
      const s = c.skills;
      return `<tr class="${store.selectedCrew === c.id ? 'sel' : ''}">
        <td><a data-act="selcrew" data-id="${c.id}">${c.robot ? '🤖 ' : ''}${esc(c.name)}</a></td>
        <td title="Здоровье">${bar(c.health, c.health < 35 ? '#ff5252' : '#69f0ae')}</td>
        <td title="Сытость">${c.robot ? '—' : bar(c.food, '#ffb74d')}</td>
        <td title="Бодрость">${c.robot ? '—' : bar(c.rest, '#64b5f6')}</td>
        <td>${STATE_NAMES[c.state]}${c.job ? ` · ${JOB_NAMES[c.job]}` : ''}</td>
        <td class="skills" title="Инженерия / Ботаника / Пилотирование / Бой">${s.engineering}/${s.botany}/${s.piloting}/${s.combat}</td>
        <td>${c.robot ? '' : `<button data-act="cryo" data-id="${c.id}">${c.state === 'cryo' ? 'Разбудить' : '❄ Криосон'}</button>`}
            <button data-act="expcrew" data-id="${c.id}" class="${store.expeditionCrew.has(c.id) ? 'on' : ''}" title="Выбрать для высадки на планету">🚀</button></td>
      </tr>`;
    })
    .join('');
  setHtml(
    el,
    `<div class="panel-title">Команда ${own.crew.length + away}/${own.crewCap}${away ? ` (на планете: ${away})` : ''}</div>
     <table><tr><th>Имя</th><th>❤</th><th>🍞</th><th>☾</th><th>Занятие</th><th>И/Б/П/Б</th><th></th></tr>${rows}</table>
     <div class="hint">🚀 — отметить для высадки. Затем в режиме «Звёздная система» выберите планету на орбите.</div>`,
  );
}

function contactTitle(c: Contact): string {
  switch (c.k) {
    case 'planet':
      return `${c.name}`;
    case 'station':
      return c.name;
    case 'asteroid':
      return 'Астероид';
    case 'npc':
      return NPCS[c.type].name;
    case 'ship':
      return `${c.name}`;
    case 'loot':
      return 'Контейнер с грузом';
    case 'projectile':
      return c.kind === 'missile' ? 'Ракета' : 'Спора';
  }
}

function renderContext(own: OwnShipView | null): void {
  const el = $('context');
  const snap = store.snap!;
  const parts: string[] = [];
  if (own) {
    const sel = store.selectedId !== null ? snap.contacts.find((c) => c.id === store.selectedId) : undefined;
    if (sel) parts.push(selectionPanel(own, sel));
    if (own.marketId !== null && snap.market) parts.push(marketPanel(own));
    if (snap.expeditions.length) {
      parts.push(
        `<div class="card"><div class="panel-title">Экспедиции</div>${snap.expeditions
          .map(
            (e) =>
              `<div class="row"><b>${esc(e.planetName)}</b> · ${e.timeLeft > 0 ? `${Math.ceil(e.timeLeft)} с` : 'ждёт корабль в системе'}<br>
               ${e.crew.map((c) => `${esc(c.name)} ${Math.round(c.health)}❤`).join(', ')}<br>
               <span class="muted">${Object.entries(e.loot).map(([k, v]) => `${RES_ICON[k as Resource]}${v}`).join(' ') || 'пока ничего'}</span>
               ${e.timeLeft > 5 ? `<button data-act="recall" data-id="${e.id}">Отозвать</button>` : ''}</div>`,
          )
          .join('')}</div>`,
      );
    }
  }
  if (parts.length) {
    el.classList.remove('hidden');
    setHtml(el, parts.join(''));
  } else el.classList.add('hidden');
}

function selectionPanel(own: OwnShipView, c: Contact): string {
  const d = Math.hypot(c.x - own.x, c.y - own.y);
  const isTarget = own.targetId === c.id;
  const lines: string[] = [`<div class="panel-title">${esc(contactTitle(c))} <span class="muted">${Math.round(d)} м</span></div>`];
  const actions: string[] = [`<button data-act="goto" data-id="${c.id}">Лететь</button>`];
  switch (c.k) {
    case 'planet': {
      const b = BIOMES[c.biome];
      lines.push(`<div>${esc(b.name)}${c.colony ? ' · <span class="ok">колония с рынком</span>' : ''}</div>`);
      lines.push(`<div class="muted">Опасность: ${'▮'.repeat(Math.round(b.threat * 10))}${'▯'.repeat(10 - Math.round(b.threat * 10))}</div>`);
      lines.push(`<div class="muted">Добыча: ${Object.keys(b.loot).map((k) => RESOURCE_NAMES[k as Resource]).join(', ')}</div>`);
      if (own.orbitId === c.id) {
        const chosen = own.crew.filter((x) => store.expeditionCrew.has(x.id));
        lines.push(
          `<div class="sub">Высадка (${chosen.length}/${EXPEDITION_MAX_CREW}): ${own.crew
            .filter((x) => x.state !== 'cryo')
            .map((x) => `<button data-act="expcrew" data-id="${x.id}" class="chip ${store.expeditionCrew.has(x.id) ? 'on' : ''}">${x.robot ? '🤖' : ''}${esc(x.name.split(' ')[0])}</button>`)
            .join('')}</div>`,
        );
        actions.push(`<button data-act="expedition" data-id="${c.id}" class="accent" ${chosen.length ? '' : 'disabled'}>🚀 Высадить команду</button>`);
      } else lines.push('<div class="muted">Подлетите на орбиту, чтобы высадить команду.</div>');
      break;
    }
    case 'asteroid': {
      const entries = Object.entries(c.res) as [Resource, number][];
      lines.push(
        `<div>${entries.map(([k, v]) => `${RES_ICON[k]} ${RESOURCE_NAMES[k]}: ${v < 0 ? '?' : v}`).join('<br>')}</div>`,
        entries.some(([, v]) => v < 0) ? '<div class="muted">Точное количество покажет сканер (запитанный радар).</div>' : '',
      );
      const mine = entries
        .map(([k]) => `<button data-act="mine" data-id="${c.id}" data-res="${k}" class="chip ${isTarget && own.mineResource === k ? 'on' : ''}">${RES_ICON[k]} ${RESOURCE_NAMES[k]}</button>`)
        .join('');
      lines.push(`<div class="sub">Добывать: <button data-act="mine" data-id="${c.id}" data-res="any" class="chip ${isTarget && own.mineResource === null ? 'on' : ''}">всё подряд</button>${mine}</div>`);
      break;
    }
    case 'npc': {
      const def = NPCS[c.type];
      lines.push(`<div>${def.faction === 'machines' ? 'Машины' : 'Живая флора'} · корпус ${Math.round(c.hp)}/${def.maxHp}</div>`);
      actions.push(isTarget ? `<button data-act="untarget">Прекратить огонь</button>` : `<button data-act="target" data-id="${c.id}" class="danger">⚔ Атаковать</button>`);
      break;
    }
    case 'ship':
      lines.push(`<div>Капитан: ${esc(c.owner)} · ${HULLS[c.hull].name}</div><div>Корпус ${Math.round(c.hp)}/${c.maxHp}</div>`);
      actions.push(isTarget ? `<button data-act="untarget">Прекратить огонь</button>` : `<button data-act="target" data-id="${c.id}" class="danger" title="Вне безопасных зон">⚔ Атаковать игрока</button>`);
      break;
    case 'loot':
      lines.push(`<div>${Object.entries(c.res).map(([k, v]) => `${RES_ICON[k as Resource]} ${v}`).join(' ')}</div><div class="muted">Тяговый луч подберёт груз вблизи.</div>`);
      break;
    default:
      break;
  }
  return `<div class="card">${lines.join('')}<div class="actions">${actions.join('')}</div></div>`;
}

function marketPanel(own: OwnShipView): string {
  const m = store.snap!.market!;
  const rows = (Object.keys(m.price) as Resource[])
    .map((r) => {
      const sell = m.price[r]!;
      const buy = Math.ceil(sell * BUY_MARKUP * 10) / 10;
      return `<tr><td>${RES_ICON[r]} ${RESOURCE_NAMES[r]}</td><td>${fmt(own.res[r])}</td><td>${m.stock[r] ?? 0}</td>
        <td><button data-act="trade" data-res="${r}" data-amount="-1">−1</button><button data-act="trade" data-res="${r}" data-amount="-10">−10</button> ${sell}₵</td>
        <td>${buy}₵ <button data-act="trade" data-res="${r}" data-amount="1">+1</button><button data-act="trade" data-res="${r}" data-amount="10">+10</button></td></tr>`;
    })
    .join('');
  const next = HULLS[own.hull].next;
  return `<div class="card market"><div class="panel-title">Рынок: ${esc(m.name)} <span class="muted">обновление через ${Math.ceil(m.refreshIn / 60)} мин</span></div>
    <table><tr><th></th><th>у вас</th><th>склад</th><th>продать</th><th>купить</th></tr>${rows}</table>
    <div class="actions">
      <button data-act="recruit" data-robot="0">Нанять человека (${RECRUIT_COST}₵)</button>
      <button data-act="recruit" data-robot="1" title="Не ест, не спит, не дышит, но медленный">Купить робота (${ROBOT_COST}₵)</button>
      ${own.hp < own.maxHp ? `<button data-act="repair">Ремонт корпуса</button>` : ''}
      ${next ? `<button data-act="upgrade" title="Вся постройка переносится в новый корпус">Корпус «${HULLS[next].name}»: ${costText(HULLS[next].cost!)}</button>` : ''}
    </div></div>`;
}

function renderGalaxy(own: OwnShipView | null, systemId: number): void {
  const el = $('galaxy');
  if (!own || !store.galaxyOpen) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const xs = STAR_SYSTEMS.map((s) => s.gx);
  const ys = STAR_SYSTEMS.map((s) => s.gy);
  const minX = Math.min(...xs) - 2;
  const minY = Math.min(...ys) - 2;
  const W = 420;
  const H = 260;
  const k = Math.min(W / (Math.max(...xs) - minX + 2), H / (Math.max(...ys) - minY + 2));
  const P = (i: number) => ({ x: (STAR_SYSTEMS[i].gx - minX) * k, y: (STAR_SYSTEMS[i].gy - minY) * k });
  const here = P(systemId);
  const pop = store.snap!.population;
  const nodes = STAR_SYSTEMS.map((s, i) => {
    const p = P(i);
    const d = systemDistance(systemId, i);
    const reachable = i !== systemId && d <= own.jumpRange;
    return `${i !== systemId ? `<line x1="${here.x}" y1="${here.y}" x2="${p.x}" y2="${p.y}" stroke="${reachable ? '#00e5ff' : '#37474f'}" stroke-dasharray="4 4"/>` : ''}
      <circle cx="${p.x}" cy="${p.y}" r="${i === systemId ? 9 : 7}" fill="${s.star}"/>
      <text x="${p.x}" y="${p.y + 22}" text-anchor="middle">${esc(s.name)}${pop[i] ? ` 👥${pop[i]}` : ''}</text>`;
  }).join('');
  const list = STAR_SYSTEMS.map((s, i) => {
    if (i === systemId) return `<div class="row"><b>${esc(s.name)}</b> — вы здесь</div>`;
    const d = systemDistance(systemId, i);
    const ok = d <= own.jumpRange;
    return `<div class="row">${esc(s.name)} · ${d.toFixed(1)} св. лет <button data-act="jump" data-id="${i}" ${ok && !own.jump ? '' : 'disabled'}>${ok ? 'Прыжок (💎2)' : 'далеко'}</button></div>`;
  }).join('');
  setHtml(
    el,
    `<div class="panel-title">Галактика · дальность прыжка ${own.jumpRange.toFixed(1)} св. лет <button data-act="galaxy">✕</button></div>
     <svg viewBox="-20 -20 ${W + 40} ${H + 50}" width="100%">${nodes}</svg>${list}
     <div class="hint">Для прыжка нужны пилот на мостике и работающий двигатель. Больше двигателей — дальше прыжок.</div>`,
  );
}

function renderLog(): void {
  const now = performance.now();
  const entries = [
    ...store.log.map((e) => ({ at: e.at, html: `<div class="log-${e.level}">${esc(e.text)}</div>` })),
    ...store.chat.map((c) => ({ at: c.at, html: `<div class="log-chat"><b>${esc(c.from)}:</b> ${esc(c.text)}</div>` })),
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-8)
    .filter((e) => now - e.at < 30000);
  setHtml($('log'), entries.map((e) => e.html).join(''));
  const t = store.toast;
  const toastEl = $('toast');
  if (t && now - t.at < 3000) {
    toastEl.classList.remove('hidden');
    setHtml(toastEl, esc(t.text));
  } else toastEl.classList.add('hidden');
}
