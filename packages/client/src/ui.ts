// HTML-интерфейс поверх холста: ресурсы, строительство, команда, цели, торговля, экспедиции, прыжки, чат.
import {
  AIM_HINTS,
  AIM_KINDS,
  AIM_NAMES,
  BIOMES,
  BUY_MARKUP,
  CATEGORY_NAMES,
  EXPEDITION_MAX_CREW,
  HULLS,
  MODULES,
  MOOD_BREAK_BELOW,
  MOOD_HIGH,
  MOOD_LOW,
  THOUGHTS,
  TRAITS,
  MODULE_TYPES,
  NPCS,
  RECRUIT_COST,
  RESOURCES,
  RESOURCE_NAMES,
  ROBOT_COST,
  SIGNALS,
  STAR_SYSTEMS,
  STRUCTURE_COST,
  STRUCTURE_WORK,
  systemDistance,
  type AimKind,
  type BuildCategory,
  type BuildKind,
  type JobKind,
  type WorkPriority,
  type Contact,
  type OwnShipView,
  type Resource,
  type Resources,
  moduleSize,
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

const SURFACE_TASKS: Record<string, string> = {
  idle: 'ждёт',
  gather: 'добывает',
  move: 'идёт',
  flee: 'ранен, к шаттлу',
  board: 'к шаттлу',
  boarded: 'в шаттле',
};

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
  haul: 'несёт',
};

const PRIORITY_COLUMNS: { kind: JobKind; name: string }[] = [
  { kind: 'extinguish', name: 'Пожар' },
  { kind: 'pilot', name: 'Мостик' },
  { kind: 'repair', name: 'Ремонт' },
  { kind: 'haul', name: 'Перенос' },
  { kind: 'harvest', name: 'Урожай' },
  { kind: 'build', name: 'Стройка' },
];

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
  else if (store.mode === 'system') store.systemZoom = store.zoomTarget;
  store.mode = mode;
  if (mode === 'planet') {
    store.tool = null;
    store.panel = null;
    store.galaxyOpen = false;
    return;
  }
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
    case 'planet': {
      store.landingId = id;
      store.planetCrew = null;
      const e = store.snap?.expeditions.find((x) => x.id === id);
      if (e) store.planetCam = { x: e.surface.shuttle.x + 0.5, y: e.surface.shuttle.y + 0.5 };
      setMode('planet');
      break;
    }
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
      store.tool = store.tool === el.dataset.kind ? null : (el.dataset.kind as BuildKind | 'remove' | 'urgent' | 'stockpile' | 'unstockpile');
      break;
    case 'air':
      store.airOverlay = !store.airOverlay;
      if (store.airOverlay) store.tempOverlay = false;
      break;
    case 'temp':
      store.tempOverlay = !store.tempOverlay;
      if (store.tempOverlay) store.airOverlay = false;
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
    case 'draft': {
      const on = own?.crew.find((c) => c.id === id)?.draft ?? false;
      send({ c: 'draft', crewId: id, on: !on });
      break;
    }
    case 'clearorder':
      send({ c: 'clearOrder', crewId: id });
      break;
    case 'priority': {
      const kind = el.dataset.kind as JobKind;
      const cur = own?.crew.find((c) => c.id === id)?.priorities[kind] ?? 3;
      const next = (cur >= 4 ? 0 : cur + 1) as WorkPriority;
      send({ c: 'setPriority', crewId: id, kind, value: next });
      break;
    }
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
    case 'signal':
      send({ c: 'signal', id, option: Number(el.dataset.opt) });
      break;
    case 'goto': {
      const c = store.snap?.contacts.find((o) => o.id === id);
      if (c && own) {
        const r = 'r' in c ? c.r : 20;
        const d = Math.hypot(c.x - own.x, c.y - own.y) || 1;
        // К сигналу нужно подойти вплотную — иначе событие не откроется.
        const stand = c.k === 'signal' ? 60 : r + 120;
        send({ c: 'move', x: c.x + ((own.x - c.x) / d) * stand, y: c.y + ((own.y - c.y) / d) * stand });
      }
      break;
    }
    case 'aim':
      send({ c: 'aim', aim: el.dataset.aim as AimKind });
      break;
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
  // На экране планеты журнал и карточка переезжают, чтобы не закрывать карту.
  document.body.classList.toggle('planet-mode', store.mode === 'planet');
  renderTop(own, snap.systemId, snap.population);
  renderAlerts(own);
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
  return `<div class="meter" title="${esc(label)}"><span class="meter-label">${esc(label)}</span><div class="meter-bar"><div style="width:${(frac * 100).toFixed(0)}%;background-color:${color};--c:${color}"></div></div><span class="meter-val">${esc(text ?? `${fmt(value)}/${fmt(max)}`)}</span></div>`;
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
      ${meter('Щит', own.shield, own.maxShield, '#4fc3f7')}
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
  if (store.mode === 'planet') {
    const e = store.snap!.expeditions.find((x) => x.id === store.landingId);
    setHtml(
      $('buttons-left'),
      e
        ? `<span class="planet-hint">ЛКМ — выбрать человека / пометить ресурс · ПКМ — отправить · колесо — масштаб · WASD — карта · Esc — корабль</span>`
        : '',
    );
    setHtml(
      $('buttons-right'),
      `${e && !e.returning ? `<button data-act="recall" data-id="${e.id}" class="danger">⤴ Все к шаттлу</button>` : ''}
       <button data-act="mode" class="big">⚙ Корабль</button>`,
    );
    return;
  }
  const ship = store.mode === 'ship';
  setHtml(
    $('buttons-left'),
    own
      ? `<button data-act="panel" data-panel="build" class="${store.panel === 'build' ? 'on' : ''}">🛠 Строительство</button>
         <button data-act="panel" data-panel="crew" class="${store.panel === 'crew' ? 'on' : ''}">👥 Команда</button>
         <button data-act="air" class="${store.airOverlay ? 'on' : ''}">💨 Воздух</button>
         <button data-act="temp" class="${store.tempOverlay ? 'on' : ''}">🌡 Температура</button>
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
      ['remove', '⛏', 'Разобрать', 'Снести постройку (половина ресурсов упадёт на пол) или отменить чертёж'],
      ['urgent', '❗', 'Важно', 'Пометить задачу на клетке как важную — экипаж возьмётся за неё сразу'],
      ['stockpile', '▦', 'Склад', 'Зона, куда носят ресурсы. В запасе корабля только то, что лежит здесь'],
      ['unstockpile', '▢', 'Убрать склад', 'Снять зону склада с клеток'],
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
  return `<div class="mini"><div style="width:${Math.max(0, Math.min(100, v)).toFixed(0)}%;background-color:${color};--c:${color}"></div></div>`;
}

type CrewV = OwnShipView['crew'][number];

const moodColor = (m: number) => (m >= MOOD_HIGH ? '#69f0ae' : m < MOOD_BREAK_BELOW ? '#ff5252' : m < MOOD_LOW ? '#ffab40' : '#b39ddb');
const moodWord = (c: CrewV) => (c.breakdown ? 'срыв' : c.mood >= MOOD_HIGH ? 'воодушевлён' : c.mood < MOOD_BREAK_BELOW ? 'на грани' : c.mood < MOOD_LOW ? 'подавлен' : 'в порядке');

/** Мысли списком: «+5 Сыт», «−10 Голоден» — видно, что именно портит или поднимает настроение. */
function thoughtsHtml(c: CrewV): string {
  return [...c.thoughts]
    .sort((a, b) => THOUGHTS[a].mood - THOUGHTS[b].mood)
    .map((t) => {
      const v = THOUGHTS[t].mood;
      return `<div class="${v < 0 ? 'thought-bad' : 'thought-good'}">${v > 0 ? '+' : '−'}${Math.abs(v)} ${esc(THOUGHTS[t].text)}</div>`;
    })
    .join('');
}

const traitHtml = (c: CrewV) => (c.trait ? `<span class="trait" title="${esc(TRAITS[c.trait].desc)}">${esc(TRAITS[c.trait].name)}</span>` : '');

function renderCrew(own: OwnShipView | null): void {
  const el = $('crew');
  if (!own || store.panel !== 'crew' || store.mode !== 'ship') {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const away = store.snap!.expeditions.reduce((s, e) => s + e.surface.crew.length, 0);
  const rows = own.crew
    .map((c) => {
      const s = c.skills;
      const pri = PRIORITY_COLUMNS.map(({ kind, name }) => {
        const v = c.priorities[kind];
        return `<button class="pri ${v === 0 ? 'off' : ''}" data-act="priority" data-id="${c.id}" data-kind="${kind}" title="${name}: 1 — в первую очередь, 4 — в последнюю, 0 — не делать">${name} ${v}</button>`;
      }).join('');
      return `<tr class="${store.selectedCrew === c.id ? 'sel' : ''}">
        <td><a data-act="selcrew" data-id="${c.id}">${c.robot ? '🤖 ' : ''}${esc(c.name)}</a> ${traitHtml(c)}</td>
        <td title="Здоровье">${bar(c.health, c.health < 35 ? '#ff5252' : '#69f0ae')}</td>
        <td title="Сытость">${c.robot ? '—' : bar(c.food, '#ffb74d')}</td>
        <td title="Бодрость">${c.robot ? '—' : bar(c.rest, '#64b5f6')}</td>
        <td title="Настроение: ${c.robot ? 'у роботов его нет' : `${c.mood} — ${moodWord(c)}. ${c.thoughts.map((t) => THOUGHTS[t].text).join(', ')}`}">${c.robot ? '—' : bar(c.mood, moodColor(c.mood))}</td>
        <td>${c.draft ? 'ведёт' : STATE_NAMES[c.state]}${c.job ? ` · ${JOB_NAMES[c.job]}` : ''}${c.order ? ` → ${c.order.x},${c.order.y}` : ''}</td>
        <td class="skills" title="Инженерия / Ботаника / Пилотирование / Бой">${s.engineering}/${s.botany}/${s.piloting}/${s.combat}</td>
        <td><button data-act="draft" data-id="${c.id}" class="${c.draft ? 'on' : ''}" title="Прямое управление: пешка стоит, пока не прикажете идти">${c.draft ? 'Отпустить' : 'Вести'}</button>
            ${c.robot ? '' : `<button data-act="cryo" data-id="${c.id}">${c.state === 'cryo' ? 'Разбудить' : '❄ Криосон'}</button>`}
            <button data-act="expcrew" data-id="${c.id}" class="${store.expeditionCrew.has(c.id) ? 'on' : ''}" title="Выбрать для высадки на планету">🚀</button></td>
      </tr><tr class="pri-row"><td colspan="8">${pri}</td></tr>`;
    })
    .join('');
  setHtml(
    el,
    `<div class="panel-title">Команда ${own.crew.length + away}/${own.crewCap}${away ? ` (на планете: ${away})` : ''}</div>
     <table><tr><th>Имя</th><th>❤</th><th>🍞</th><th>☾</th><th title="Настроение">☺</th><th>Занятие</th><th>И/Б/П/Б</th><th></th></tr>${rows}</table>
     <div class="hint">☺ — настроение: наведите, чтобы увидеть причины. Цифры под именем — приоритет работы: 1 раньше всего, 4 позже, 0 запрещает. «Вести» — пешка ждёт приказа, ПКМ по полу отправит её в клетку. 🚀 — отметить для высадки.</div>`,
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
    case 'signal':
      return c.kind ? SIGNALS[c.kind].name : 'Неопознанный сигнал';
  }
}

function renderContext(own: OwnShipView | null): void {
  const el = $('context');
  const snap = store.snap!;
  const parts: string[] = [];
  if (own) {
    if (own.event) parts.push(eventCard(own.event));
    const pawn = store.selectedCrew !== null ? own.crew.find((c) => c.id === store.selectedCrew) : undefined;
    if (pawn) parts.push(pawnCard(pawn));
    const sel = store.selectedId !== null ? snap.contacts.find((c) => c.id === store.selectedId) : undefined;
    if (sel) parts.push(selectionPanel(own, sel));
    if (own.marketId !== null && snap.market) parts.push(marketPanel(own));
    if (snap.expeditions.length) {
      parts.push(
        `<div class="card"><div class="panel-title">Высадки</div>${snap.expeditions
          .map((e) => {
            const status = e.waitingForShip
              ? '<span class="warn">все в шаттле, ждут корабль в системе</span>'
              : e.returning
                ? 'возвращаются к шаттлу'
                : `на поверхности ${Math.floor(e.surface.elapsed / 60)}:${String(Math.floor(e.surface.elapsed % 60)).padStart(2, '0')}`;
            const crew = e.surface.crew
              .map((c) => `${c.robot ? '🤖' : ''}${esc(c.name.split(' ')[0])} <span class="${c.health < 40 ? 'warn' : 'muted'}">${Math.round(c.health)}❤ · ${SURFACE_TASKS[c.task]}</span>`)
              .join('<br>');
            return `<div class="row"><b>${esc(e.planetName)}</b> · ${status}<br>${crew}<br>
               <span class="muted">Добыто: ${Object.entries(e.loot).map(([k, v]) => `${RES_ICON[k as Resource]}${v}`).join(' ') || 'пока ничего'}
               · хищников: ${e.surface.creatures.length}</span>
               <div class="actions">${store.mode !== 'planet' || store.landingId !== e.id ? `<button data-act="planet" data-id="${e.id}" class="accent">🌍 На поверхность</button>` : ''}
               ${e.returning ? '' : `<button data-act="recall" data-id="${e.id}">⤴ Все к шаттлу</button>`}</div></div>`;
          })
          .join('')}</div>`,
      );
    }
  }
  if (parts.length) {
    el.classList.remove('hidden');
    setHtml(el, parts.join(''));
  } else el.classList.add('hidden');
}

/** Событие у сигнала: описание и варианты решения (как в FTL). Исход решает сервер. */
function eventCard(ev: NonNullable<OwnShipView['event']>): string {
  const options = ev.options
    .map((o, i) => {
      const cost = Object.entries(o.cost) as [Resource, number][];
      const price = cost.length ? ` <span class="event-cost">${cost.map(([k, v]) => `${RES_ICON[k]}${v}`).join(' ')}</span>` : '';
      return `<button class="event-option" data-act="signal" data-id="${ev.signalId}" data-opt="${i}" ${o.ok ? '' : 'disabled'}>
        <span class="event-label">${esc(o.label)}${price}</span>
        <span class="event-hint">${esc(o.ok ? o.hint : o.why)}</span></button>`;
    })
    .join('');
  return `<div class="card event event-${ev.kind}"><div class="panel-title">${esc(ev.name)}</div>
    <div class="event-text">${esc(ev.text)}</div>${options}
    <div class="hint">Не хотите вмешиваться — просто улетайте.</div></div>`;
}

function pawnCard(c: OwnShipView['crew'][number]): string {
  const s = c.skills;
  const carry = c.carry ? `${RES_ICON[c.carry.resource]} ${c.carry.amount}` : 'руки пусты';
  const going = c.order ? `идёт в клетку ${c.order.x},${c.order.y}` : 'приказа идти нет';
  return `<div class="card">
    <div class="panel-title">${c.robot ? '🤖 ' : ''}${esc(c.name)} ${c.draft ? '<span class="ok">ведёт</span>' : ''}</div>
    <div>Здоровье ${bar(c.health, c.health < 35 ? '#ff5252' : '#69f0ae')} ${Math.round(c.health)}</div>
    <div>Сытость ${c.robot ? '—' : `${bar(c.food, '#ffb74d')} ${Math.round(c.food)}`}</div>
    <div>Бодрость ${c.robot ? '—' : `${bar(c.rest, '#64b5f6')} ${Math.round(c.rest)}`}</div>
    ${c.robot ? '' : `<div>Настроение ${bar(c.mood, moodColor(c.mood))} ${c.mood} · <span style="color:${moodColor(c.mood)}">${moodWord(c)}</span> ${traitHtml(c)}</div><div class="thoughts">${thoughtsHtml(c)}</div>`}
    <div class="muted">${c.draft ? 'ждёт приказа' : STATE_NAMES[c.state]}${c.job ? ` · ${JOB_NAMES[c.job]}` : ''} · ${going}</div>
    <div class="muted">В руках: ${carry}</div>
    <div class="skills">Инженерия ${s.engineering} · Ботаника ${s.botany} · Пилот ${s.piloting} · Бой ${s.combat}</div>
    <div class="sub">
      <button data-act="draft" data-id="${c.id}" class="${c.draft ? 'on' : ''}">${c.draft ? 'Отпустить' : 'Вести'}</button>
      <button data-act="clearorder" data-id="${c.id}">Снять приказ</button>
      ${c.robot ? '' : `<button data-act="cryo" data-id="${c.id}">${c.state === 'cryo' ? 'Разбудить' : 'Криосон'}</button>`}
    </div>
    <div class="hint">ПКМ по полу — идти в эту клетку. «Вести» снимает пешку с работ, пока не отпустите.</div>
  </div>`;
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
      lines.push(aimPanel(own, c.sub));
      actions.push(isTarget ? `<button data-act="untarget">Прекратить огонь</button>` : `<button data-act="target" data-id="${c.id}" class="danger">⚔ Атаковать</button>`);
      break;
    }
    case 'ship':
      lines.push(`<div>Капитан: ${esc(c.owner)} · ${HULLS[c.hull].name}</div><div>Корпус ${Math.round(c.hp)}/${c.maxHp}</div>`);
      lines.push(aimPanel(own, null));
      actions.push(isTarget ? `<button data-act="untarget">Прекратить огонь</button>` : `<button data-act="target" data-id="${c.id}" class="danger" title="Вне безопасных зон">⚔ Атаковать игрока</button>`);
      break;
    case 'loot':
      lines.push(`<div>${Object.entries(c.res).map(([k, v]) => `${RES_ICON[k as Resource]} ${v}`).join(' ')}</div><div class="muted">Тяговый луч подберёт груз вблизи.</div>`);
      break;
    case 'signal':
      lines.push(
        c.kind
          ? `<div>${esc(SIGNALS[c.kind].text)}</div><div class="muted">Подлетите вплотную, чтобы принять решение.</div>`
          : '<div class="muted">Источник не опознан. Подлетите ближе — или включите радар, он опознаёт сигналы издалека.</div>',
      );
      break;
    default:
      break;
  }
  return `<div class="card">${lines.join('')}<div class="actions">${actions.join('')}</div></div>`;
}

/** Выбор прицела (как в FTL): корпус или система врага. sub — состояние систем цели, если оно известно. */
function aimPanel(own: OwnShipView, sub: [number, number, number] | null): string {
  const chips = AIM_KINDS.map((k, i) => {
    const frac = sub && i > 0 ? sub[i - 1] : null;
    const state = frac === null ? '' : frac <= 0 ? '<span class="aim-down">выбито</span>' : bar(frac * 100, frac < 0.4 ? '#ffab40' : '#80deea');
    return `<button class="aim ${own.aim === k ? 'on' : ''}" data-act="aim" data-aim="${k}" title="${esc(AIM_HINTS[k])}"><span>${i + 1} · ${AIM_NAMES[k]}</span>${state}</button>`;
  }).join('');
  return `<div class="sub">Целиться в:</div><div class="aim-row">${chips}</div><div class="hint">${esc(AIM_HINTS[own.aim])}</div>`;
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

/** Предупреждения как в RimWorld: столбик слева, тревоги красным, подсказка — при наведении. */
function renderAlerts(own: OwnShipView | null): void {
  const alerts = own?.alerts ?? [];
  // Текущая задача капитана — над предупреждениями (на планете не показываем: там свои заботы).
  const g = store.mode !== 'planet' ? store.snap?.me.guide : null;
  const guide = g
    ? `<div class="guide"><div class="guide-head"><span>Задача ${g.index + 1}/${g.total}</span><span class="guide-reward">+${g.reward}₵</span></div>
       <div class="guide-title">${esc(g.title)}</div><div class="guide-text">${esc(g.text)}</div>
       <div class="guide-dots">${Array.from({ length: g.total }, (_, i) => `<i class="${i < g.index ? 'done' : i === g.index ? 'now' : ''}"></i>`).join('')}</div></div>`
    : '';
  setHtml(
    $('alerts'),
    guide +
      alerts
        .map((a) => `<div class="alert alert-${a.level}" title="${esc(a.hint)}">${a.level === 'bad' ? '⚠' : '•'} ${esc(a.text)}<div class="alert-hint">${esc(a.hint)}</div></div>`)
        .join(''),
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

// ---------- Подсказка под курсором (как в RimWorld/ONI): что это и в каком состоянии ----------

let lastTip = '';

/** Вызывается каждый кадр: содержимое пересобирается, только если изменилось. */
export function renderTooltip(): void {
  const el = document.getElementById('tooltip');
  if (!el) return;
  const own = store.snap?.ship;
  const h = store.hoverTile;
  const l = own ? store.layouts.get(own.id) : undefined;
  if (!own || !h || !l || store.mode !== 'ship' || store.tool || store.mouse.down) {
    if (lastTip) {
      el.classList.add('hidden');
      lastTip = '';
    }
    return;
  }
  const parts: string[] = [];
  for (const c of own.crew) {
    if (Math.round(c.x) !== h.x || Math.round(c.y) !== h.y) continue;
    const doing = c.breakdown ? '<span class="warn">срыв — не работает</span>' : c.draft ? 'ждёт приказа' : `${STATE_NAMES[c.state]}${c.job ? ` · ${JOB_NAMES[c.job]}` : ''}`;
    parts.push(
      `<div class="tip-title">${c.robot ? '🤖 ' : ''}${esc(c.name)}</div><div class="muted">${doing}</div>` +
        `<div class="tip-bars"><span>❤</span>${bar(c.health, '#69f0ae')}${c.robot ? '' : `<span>🍞</span>${bar(c.food, '#ffb74d')}<span>☾</span>${bar(c.rest, '#90caf9')}`}</div>` +
        (c.robot ? '' : `<div class="tip-bars"><span>☺</span>${bar(c.mood, moodColor(c.mood))}<span style="color:${moodColor(c.mood)}">${moodWord(c)}</span> ${traitHtml(c)}</div><div class="thoughts">${thoughtsHtml(c)}</div>`) +
        (c.carry ? `<div class="muted">несёт: ${esc(RESOURCE_NAMES[c.carry.resource])} ×${fmt(c.carry.amount)}</div>` : ''),
    );
  }
  for (const m of own.modules) {
    const [mw, mh] = moduleSize(m.type);
    if (h.x < m.x || h.y < m.y || h.x >= m.x + mw || h.y >= m.y + mh) continue;
    const def = MODULES[m.type];
    const status = m.hp <= 0 ? '<span class="bad">разрушен</span>' : !m.enabled ? '<span class="warn">выключен</span>' : def.demand > 0 && !m.powered ? '<span class="bad">нет энергии</span>' : def.output ? '<span class="ok">даёт энергию</span>' : m.active ? '<span class="ok">работает</span>' : '<span class="muted">ожидает</span>';
    const grow = m.type === 'hydroponics' ? ` · урожай ${Math.round(m.growth * 100)}%` : '';
    parts.push(`<div class="tip-title">${esc(def.name)}</div><div>${status}${grow} · прочность ${fmt(m.hp)}/${fmt(def.maxHp)}</div><div class="muted tip-desc">${esc(def.desc)}</div>`);
  }
  for (const st of own.stacks) if (st.x === h.x && st.y === h.y) parts.push(`<div>${esc(RESOURCE_NAMES[st.resource])} ×${fmt(st.amount)}</div>`);
  const room = l.rooms.roomOf[h.y * l.w + h.x];
  if (room >= 0) {
    const air = Math.round((own.roomAir[room] ?? 0) * 100);
    const temp = Math.round(own.roomTemp[room] ?? 21);
    const vented = l.rooms.rooms[room].vented;
    parts.push(`<div class="muted tip-room">Отсек: воздух <span class="${air < 50 ? 'bad' : air < 80 ? 'warn' : 'ok'}">${air}%</span> · ${temp}°${vented ? ' · <span class="bad">пробоина</span>' : ''}</div>`);
  }
  const html = parts.join('<div class="tip-sep"></div>');
  if (!html) {
    if (lastTip) {
      el.classList.add('hidden');
      lastTip = '';
    }
    return;
  }
  if (html !== lastTip) {
    el.innerHTML = html;
    lastTip = html;
  }
  el.classList.remove('hidden');
  const x = Math.min(window.innerWidth - el.offsetWidth - 8, store.mouse.x + 18);
  const y = Math.min(window.innerHeight - el.offsetHeight - 8, store.mouse.y + 18);
  el.style.transform = `translate(${x}px, ${y}px)`;
}
