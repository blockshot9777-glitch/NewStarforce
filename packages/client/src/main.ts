import './style.css';
import { isModuleType, moduleSize, validateBuild, type BuildKind, type Ship } from '@starforce/shared';
import { connect, savedName, send } from './net';
import { kenneyEnabled, loadKenney } from './render/kenney';
import { loadSprites } from './render/modules';
import { loadPainted } from './render/painted';
import { drawBackdrop, drawMinimap, drawSpace, type SpaceRenderResult } from './render/space';
import { drawPlanetSurface, terrainImage, type PlanetLayout } from './render/planet';
import { initAudio, playJump, toggleMute, updateLoops } from './audio';
import { runGallery } from './render/gallery';
import { PostFx } from './render/post';
import { interp, screenToWorld, store, toast, worldToTile } from './store';
import { initUi, kindName, renderTooltip, renderUi, setMode } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let W = 0;
let H = 0;
let last: SpaceRenderResult = { interior: null };
let planetView: PlanetLayout | null = null;

const ZOOM = { ship: [1.6, 7], system: [0.06, 2.2] } as const;

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------- Строительство ----------

/** Объект-«корабль» из данных снимка — чтобы проверить постройку тем же кодом, что и сервер. */
function pseudoShip(): Ship | null {
  const own = store.snap?.ship;
  const l = own && store.layouts.get(own.id);
  if (!own || !l) return null;
  return { w: l.w, h: l.h, tiles: l.grid.tiles, modules: own.modules, blueprints: own.blueprints, res: own.res } as unknown as Ship;
}

/** Клетки под инструментом: модуль — одна клетка, стены — рамка, пол и разбор — прямоугольник. */
function toolCells(): { x: number; y: number }[] {
  const h = store.hoverTile;
  if (!h) return [];
  const tool = store.tool;
  if (tool && isModuleType(tool)) {
    const [w, hh] = moduleSize(tool);
    const cells: { x: number; y: number }[] = [];
    for (let dy = 0; dy < hh; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: h.x + dx, y: h.y + dy });
    return cells;
  }
  if (!store.dragStart || !tool || tool === 'urgent') return [h];
  const x0 = Math.min(store.dragStart.x, h.x);
  const x1 = Math.max(store.dragStart.x, h.x);
  const y0 = Math.min(store.dragStart.y, h.y);
  const y1 = Math.max(store.dragStart.y, h.y);
  const cells: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const border = x === x0 || x === x1 || y === y0 || y === y1;
      if (tool === 'wall' && !border) continue;
      cells.push({ x, y });
    }
  }
  return cells.slice(0, 400);
}

function applyTool(): void {
  const tool = store.tool;
  if (!tool) return;
  if (isModuleType(tool)) {
    const h = store.hoverTile;
    if (h) send({ c: 'build', x: h.x, y: h.y, kind: tool });
    return;
  }
  const cells = toolCells();
  for (const c of cells) {
    if (tool === 'remove') send({ c: 'remove', x: c.x, y: c.y });
    else if (tool === 'urgent') send({ c: 'urgent', x: c.x, y: c.y });
    else if (tool === 'stockpile' || tool === 'unstockpile') send({ c: 'stockpile', x: c.x, y: c.y, on: tool === 'stockpile' });
    else send({ c: 'build', x: c.x, y: c.y, kind: tool });
  }
}

function drawToolPreview(): void {
  const i = last.interior;
  if (!i || !store.tool || store.mode !== 'ship') return;
  const ship = pseudoShip();
  const cells = toolCells();
  const zone = store.tool === 'stockpile' || store.tool === 'unstockpile';
  const anchor = store.hoverTile;
  const moduleOk = !!(ship && anchor && store.tool && isModuleType(store.tool) && !validateBuild(ship, anchor.x, anchor.y, store.tool));
  for (const c of cells) {
    let ok = true;
    if (store.tool && isModuleType(store.tool)) ok = moduleOk;
    else if (ship && !zone && store.tool !== 'remove' && store.tool !== 'urgent') {
      ok = !validateBuild(ship, c.x, c.y, store.tool as BuildKind);
    }
    const x = i.ox + c.x * i.ts;
    const y = i.oy + c.y * i.ts;
    const bad = store.tool === 'remove' || store.tool === 'unstockpile';
    ctx.fillStyle = bad ? 'rgba(255,82,82,0.3)' : ok ? 'rgba(105,240,174,0.3)' : 'rgba(255,82,82,0.35)';
    ctx.fillRect(x, y, i.ts, i.ts);
    ctx.strokeStyle = bad ? '#ff5252' : ok ? '#69f0ae' : '#ff5252';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, i.ts - 1, i.ts - 1);
  }
  const h = store.hoverTile;
  if (h && ship && store.tool !== 'remove' && store.tool !== 'urgent' && store.tool !== 'stockpile' && store.tool !== 'unstockpile') {
    const err = validateBuild(ship, h.x, h.y, store.tool as BuildKind);
    const text = err ? `${kindName(store.tool as BuildKind)}: ${err}` : kindName(store.tool as BuildKind);
    ctx.font = '13px system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = err ? '#ff8a80' : '#b9f6ca';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(text, store.mouse.x + 16, store.mouse.y + 24);
    ctx.fillText(text, store.mouse.x + 16, store.mouse.y + 24);
  }
}

// ---------- Ввод ----------

function contactAt(wx: number, wy: number) {
  const snap = store.snap;
  if (!snap) return undefined;
  const pickR = 14 / store.zoom;
  let best: { id: number; d: number } | null = null;
  for (const c of snap.contacts) {
    if (c.k === 'projectile') continue;
    const r = 'r' in c ? c.r : c.k === 'npc' ? 20 : 8;
    const p = interp(c.id, c.x, c.y);
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d <= r + pickR && (!best || d < best.d)) best = { id: c.id, d };
  }
  return best ? snap.contacts.find((c) => c.id === best!.id) : undefined;
}

function tileInOwnShip(): { x: number; y: number } | null {
  const own = store.snap?.ship;
  const l = own && store.layouts.get(own.id);
  if (!own || !l || store.mode !== 'ship') return null;
  const pos = interp(own.id, own.x, own.y);
  const t = worldToTile(pos, l, store.mouse.wx, store.mouse.wy);
  return t.x >= 0 && t.y >= 0 && t.x < l.w && t.y < l.h ? t : null;
}

function onMouseMove(e: MouseEvent): void {
  store.mouse.x = e.clientX;
  store.mouse.y = e.clientY;
  const w = screenToWorld(e.clientX, e.clientY, W, H);
  store.mouse.wx = w.x;
  store.mouse.wy = w.y;
  store.hoverTile = tileInOwnShip();
}

/** Клик по поверхности: ЛКМ — выбрать человека или пометить ресурс, ПКМ — отправить выбранного в точку. */
function onPlanetMouseDown(e: MouseEvent): void {
  const landing = store.snap?.expeditions.find((x) => x.id === store.landingId);
  if (!landing || !planetView) return;
  const { ox, oy, ts } = planetView;
  const fx = (e.clientX - ox) / ts - 0.5;
  const fy = (e.clientY - oy) / ts - 0.5;
  const tx = Math.round(fx);
  const ty = Math.round(fy);
  const s = landing.surface;
  if (e.button === 2) {
    if (store.planetCrew === null) return;
    send({ c: 'landMove', expeditionId: landing.id, crewId: store.planetCrew, x: tx, y: ty });
    return;
  }
  if (e.button !== 0) return;
  const crew = s.crew.find((c) => c.task !== 'boarded' && Math.hypot(c.x - fx, c.y - fy) < 0.7);
  if (crew) {
    store.planetCrew = store.planetCrew === crew.id ? null : crew.id;
  } else {
    const node = s.nodes.find((n) => n.x === tx && n.y === ty);
    if (node) send({ c: 'landMark', expeditionId: landing.id, nodeId: node.id });
    else store.planetCrew = null;
  }
  renderUi(true);
}

function onMouseDown(e: MouseEvent): void {
  if (store.mode === 'planet') {
    onPlanetMouseDown(e);
    return;
  }
  if (e.button === 2) {
    if (store.tool) store.tool = null;
    else {
      const tile = tileInOwnShip();
      const own = store.snap?.ship;
      const layout = own ? store.layouts.get(own.id) : undefined;
      const kind = tile && layout ? layout.grid.tiles[tile.y * layout.w + tile.x] : undefined;
      if (store.selectedCrew !== null && tile && (kind === 'floor' || kind === 'door')) {
        send({ c: 'order', crewId: store.selectedCrew, x: tile.x, y: tile.y });
      } else if (store.selectedCrew !== null && tile && kind && kind !== 'empty') {
        toast('Сюда не пройти');
      } else {
        store.selectedId = null;
        store.selectedCrew = null;
      }
    }
    renderUi(true);
    return;
  }
  if (e.button !== 0) return;
  const tile = tileInOwnShip();
  if (store.tool && tile) {
    store.dragStart = tile;
    return;
  }
  const own = store.snap?.ship;
  if (tile && own) {
    // Клик по своему кораблю: выбор члена экипажа или модуля.
    const crew = own.crew.find((c) => Math.abs(c.x - tile.x) < 0.6 && Math.abs(c.y - tile.y) < 0.6);
    store.selectedCrew = crew ? (store.selectedCrew === crew.id ? null : crew.id) : null;
    const m = own.modules.find((o) => o.x === tile.x && o.y === tile.y);
    if (!crew && m && e.shiftKey) send({ c: 'toggle', moduleId: m.id });
    renderUi(true);
    return;
  }
  const c = contactAt(store.mouse.wx, store.mouse.wy);
  if (c) {
    store.selectedId = c.id;
  } else if (own) {
    send({ c: 'move', x: store.mouse.wx, y: store.mouse.wy });
  }
  renderUi(true);
}

function onMouseUp(e: MouseEvent): void {
  if (e.button !== 0) return;
  if (store.dragStart) {
    applyTool();
    store.dragStart = null;
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  if (store.mode === 'planet') {
    store.planetZoom = Math.max(14, Math.min(72, store.planetZoom * Math.exp(-e.deltaY * 0.0015)));
    return;
  }
  const factor = Math.exp(-e.deltaY * 0.0015);
  store.zoomTarget *= factor;
  const [lo, hi] = ZOOM[store.mode];
  // Колесом можно плавно «выйти» из корабля в систему и обратно — как переключение видов в оригинале.
  if (store.mode === 'ship' && store.zoomTarget < lo) {
    store.shipZoom = lo * 1.5;
    store.mode = 'system';
    store.zoomTarget = Math.min(store.systemZoom, ZOOM.system[1]);
    store.tool = null;
    store.panel = null;
  } else if (store.mode === 'system' && store.zoomTarget > hi) {
    store.systemZoom = hi / 2;
    store.mode = 'ship';
    store.zoomTarget = ZOOM.ship[0] * 1.2;
  } else store.zoomTarget = Math.max(lo, Math.min(hi, store.zoomTarget));
  renderUi(true);
}

function onKey(e: KeyboardEvent): void {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (store.mode === 'planet') {
    // Прокрутка карты планеты: WASD и стрелки (и русская раскладка).
    const step = 3;
    const pan: Record<string, [number, number]> = {
      w: [0, -step], ц: [0, -step], ArrowUp: [0, -step],
      s: [0, step], ы: [0, step], ArrowDown: [0, step],
      a: [-step, 0], ф: [-step, 0], ArrowLeft: [-step, 0],
      d: [step, 0], в: [step, 0], ArrowRight: [step, 0],
    };
    const d = pan[e.key];
    if (d) {
      e.preventDefault();
      store.planetCam.x += d[0];
      store.planetCam.y += d[1];
      return;
    }
  }
  switch (e.key) {
    case 'm':
    case 'M':
    case 'ь':
    case 'Ь':
      toast(toggleMute() ? 'Звук выключен (M)' : 'Звук включён (M)');
      break;
    case 'Tab':
    case ' ':
      e.preventDefault();
      setMode(store.mode === 'ship' ? 'system' : 'ship');
      break;
    case 'Escape':
      if (store.mode === 'planet') {
        setMode('ship');
        break;
      }
      store.tool = null;
      store.selectedId = null;
      store.galaxyOpen = false;
      break;
    case 'b':
    case 'и':
      store.panel = store.panel === 'build' ? null : 'build';
      setMode('ship');
      break;
    case 'c':
    case 'с':
      store.panel = store.panel === 'crew' ? null : 'crew';
      setMode('ship');
      break;
    case 'o':
    case 'щ':
      store.airOverlay = !store.airOverlay;
      break;
    case 'g':
    case 'п':
      store.galaxyOpen = !store.galaxyOpen;
      break;
    case 'Enter':
      document.getElementById('chat-input')!.focus();
      e.preventDefault();
      break;
    default:
      return;
  }
  renderUi(true);
}

// ---------- Цикл ----------

let post: PostFx | null = null;
/** Сглаженная длительность кадра (мс) и с какого момента постобработка работает — для автоотключения. */
let frameMs = 16;
let lastFrameAt = 0;
let postSince = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (lastFrameAt) frameMs += (Math.min(200, now - lastFrameAt) - frameMs) * 0.05;
  lastFrameAt = now;
  if (post && !postSince) postSince = now;
  // Слабая машина: если с постобработкой стабильно меньше ~35 кадров/с — выключаем её, игра важнее.
  if (post && now - postSince > 3000 && frameMs > 28 && new URLSearchParams(location.search).get('post') !== '1') {
    console.warn(`postfx off: ${frameMs.toFixed(0)} ms/frame`);
    document.getElementById('game-post')?.remove();
    post = null;
  }
  drawFrame(now);
  // Постобработка (свечение, цвет, виньетка) — поверх готового 2D-кадра.
  if (post) {
    try {
      post.bloom = store.mode === 'planet' ? 0.7 : 1;
      post.present(canvas, now / 1000);
    } catch (e) {
      // Потеря контекста WebGL и т. п. — показываем обычный 2D-кадр.
      console.warn('postfx off', e);
      document.getElementById('game-post')?.remove();
      post = null;
    }
  }
}

/** Вспышка по краям экрана при попадании: красная — корпус, голубая — щит. */
function drawHurt(now: number): void {
  const age = (now - store.hurtAt) / 1000;
  if (age > 0.5) return;
  const a = (1 - age / 0.5) * (store.hurtShield ? 0.25 : 0.45);
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, store.hurtShield ? `rgba(80,190,255,${a})` : `rgba(255,30,30,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

let lastJumping = false;
let lastSystem = -1;

/** Петли звука (двигатель, бур) и звуки прыжка — по состоянию своего корабля. */
function updateSound(): void {
  const own = store.snap?.ship;
  if (!own || !store.snap) {
    updateLoops(0, false);
    return;
  }
  const speed = Math.hypot(own.vx, own.vy) / Math.max(1, own.maxSpeed);
  const mining = own.targetId !== null && own.modules.some((m) => m.type === 'mining_laser' && m.active);
  updateLoops(speed, mining);
  const jumping = !!own.jump;
  if (jumping && !lastJumping) playJump('start');
  lastJumping = jumping;
  if (lastSystem !== -1 && lastSystem !== store.snap.systemId) playJump('arrive');
  lastSystem = store.snap.systemId;
}

function drawFrame(now: number): void {
  updateSound();
  const snap = store.snap;
  if (!snap) {
    drawBackdrop(ctx, W, H, now / 1000);
    return;
  }
  store.zoom += (store.zoomTarget - store.zoom) * 0.18;
  const own = snap.ship;
  if (own) {
    const p = interp(own.id, own.x, own.y);
    store.cam.x = p.x;
    store.cam.y = p.y;
  } else {
    const home = snap.contacts.find((c) => c.k === 'station');
    if (home) {
      store.cam.x += (home.x - store.cam.x) * 0.05;
      store.cam.y += (home.y - store.cam.y) * 0.05;
    }
  }
  const w = screenToWorld(store.mouse.x, store.mouse.y, W, H);
  store.mouse.wx = w.x;
  store.mouse.wy = w.y;
  store.hoverTile = tileInOwnShip();
  const landing = store.mode === 'planet' ? snap.expeditions.find((e) => e.id === store.landingId) : undefined;
  const terrain = landing && store.terrains.get(landing.id);
  if (landing && terrain) {
    planetView = drawPlanetSurface(ctx, W, H, landing, terrain, now / 1000);
    renderUi();
    renderTooltip();
    return;
  }
  // Рельеф высадок считается заранее в фоне — к нажатию «На поверхность» карта уже готова.
  for (const e of snap.expeditions) {
    const tr = store.terrains.get(e.id);
    if (tr) terrainImage(e, tr);
  }
  // Встряска камеры при попаданиях по своему кораблю (затухает за ~0.5 с).
  if (store.shake > 0.05) {
    store.cam.x += ((Math.random() - 0.5) * store.shake) / store.zoom;
    store.cam.y += ((Math.random() - 0.5) * store.shake) / store.zoom;
    store.shake *= 0.86;
  } else store.shake = 0;
  last = drawSpace(ctx, W, H, now / 1000);
  drawHurt(now);
  drawToolPreview();
  drawMinimap(ctx, W - 190, 70, 180);
  renderUi();
  renderTooltip();
}

// ---------- Вход ----------

function start(): void {
  const login = document.getElementById('login')!;
  const input = document.getElementById('name-input') as HTMLInputElement;
  const status = document.getElementById('status')!;
  input.value = savedName();
  const go = () => {
    const name = input.value.trim() || 'Капитан';
    login.classList.add('hidden');
    connect(name, (s) => {
      status.textContent = s === 'online' ? '' : s === 'connecting' ? 'Подключение к серверу…' : 'Нет связи с сервером, переподключаюсь…';
      status.classList.toggle('hidden', s === 'online');
    });
  };
  document.getElementById('play')!.addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  if (new URLSearchParams(location.search).has('autoplay')) {
    if (!input.value) input.value = new URLSearchParams(location.search).get('autoplay') || 'Капитан';
    go();
  } else input.focus();
}

if (new URLSearchParams(location.search).has('gallery')) {
  // Галерея процедурных ассетов (для работы над артом), без сервера.
  runGallery(canvas);
} else {
resize();
window.addEventListener('resize', resize);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', onKey);
loadPainted();
loadSprites();
if (kenneyEnabled()) loadKenney();
initUi();
initAudio();
start();
post = PostFx.create(canvas);
requestAnimationFrame(frame);
}
