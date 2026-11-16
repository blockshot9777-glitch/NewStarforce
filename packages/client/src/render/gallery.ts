// Галерея процедурных ассетов: откройте игру с ?gallery=1, чтобы увидеть все спрайты крупно.
// Нужна для работы над артом — без сервера и без входа в игру.
import { BIOME_TYPES, Rng, STARTER_GLYPHS, STARTER_LAYOUT, generateSurface, type NpcType, type Resource } from '@starforce/shared';
import { renderTerrain } from './terrain';
import { generateHull } from './gen/hull';
import { asteroidSprite, crateSprite, drawPlanetBody, drawStar, npcSprite, stationSprite } from './gen/space';
import { creatureSprite, depositSprite, shuttleSprite } from './gen/surface';

function starterLayout() {
  const w = 16;
  const h = 9;
  const tiles: string[] = new Array(w * h).fill('empty');
  const modules: [string, number, number][] = [];
  STARTER_LAYOUT.forEach((row, ry) =>
    [...row].forEach((ch, rx) => {
      const i = (ry + 1) * w + rx + 1;
      if (ch === '#') tiles[i] = 'wall';
      else if (ch === '+') tiles[i] = 'door';
      else tiles[i] = 'floor';
      const m = STARTER_GLYPHS[ch];
      if (m) modules.push([m, rx + 1, ry + 1]);
    }),
  );
  return { w, h, tiles, modules };
}

export function runGallery(canvas: HTMLCanvasElement): void {
  const W = window.innerWidth;
  const H = Math.max(window.innerHeight, 2500);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  document.body.style.overflow = 'auto';
  for (const id of ['login', 'top', 'bottom']) document.getElementById(id)?.classList.add('hidden');
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, W, H);
  const title = (t: string, x: number, y: number) => {
    ctx.fillStyle = '#80deea';
    ctx.font = '14px system-ui';
    ctx.fillText(t, x, y);
  };

  // ?gallery=1&biome=volcanic — один рельеф в масштабе игры (клетка ≈ 36 px), для проверки деталей.
  const only = new URLSearchParams(location.search).get('biome');
  if (only && (BIOME_TYPES as readonly string[]).includes(only)) {
    const b = only as (typeof BIOME_TYPES)[number];
    const surf = generateSurface(new Rng(7), b, (() => { let id = 1; return () => id++; })());
    const t0 = performance.now();
    const img = renderTerrain(surf.terrain, surf.w, surf.h, b, 7);
    console.log(`timing: terrain ${b} ${(performance.now() - t0).toFixed(0)} ms`);
    ctx.drawImage(img, 0, 0, img.width * 1.5, img.height * 1.5);
    return;
  }

  const L = starterLayout();
  // Замер: корпус самого большого корпуса (крейсер 32×17, заполненный) — он перегенерируется при каждой стройке.
  const big = { w: 32, h: 17, tiles: new Array(32 * 17).fill('floor') as string[], modules: [['engine', 2, 4], ['engine', 2, 12]] as [string, number, number][] };
  const t0 = performance.now();
  generateHull({ ...big, own: true, seed: 1, variant: 'open' });
  const t1 = performance.now();
  generateHull({ ...L, own: true, seed: 2, variant: 'open' });
  const t2 = performance.now();
  stationSprite(99);
  planetSpriteTime: {
    const t3 = performance.now();
    drawPlanetBody(ctx, 999, 'terran', -500, -500, 10, 0);
    console.log(`timing: cruiser hull ${(t1 - t0).toFixed(0)} ms, scout hull ${(t2 - t1).toFixed(0)} ms, station ${(t3 - t2).toFixed(0)} ms, planet ${(performance.now() - t3).toFixed(0)} ms`);
    break planetSpriteTime;
  }
  const open = generateHull({ ...L, own: true, seed: 255, variant: 'open' });
  const closed = generateHull({ ...L, own: false, seed: 77, variant: 'closed' });
  const k = 0.55;
  title('Корпус: свой (вырез под интерьер) и чужой (закрытый)', 20, 24);
  ctx.drawImage(open.canvas, 20, 34, open.canvas.width * k, open.canvas.height * k);
  ctx.drawImage(closed.canvas, 40 + open.canvas.width * k, 34, closed.canvas.width * k, closed.canvas.height * k);

  let y = 60 + open.canvas.height * k;
  // Фрегат и крейсер: неровная планировка (центральный корпус + боковые отсеки), несколько двигателей.
  title('Корпуса классов: фрегат и крейсер (чужие, закрытые)', 20, y - 6);
  let hx = 20;
  for (const [cw, ch, sd] of [[24, 13, 31], [32, 17, 47]] as const) {
    const tiles: string[] = new Array(cw * ch).fill('empty');
    const mods: [string, number, number][] = [];
    const cy = Math.floor(ch / 2);
    for (let yy = 1; yy < ch - 1; yy++)
      for (let xx = 1; xx < cw - 1; xx++) {
        const core = Math.abs(yy - cy) <= Math.floor(ch * 0.28);
        const pod = xx > cw * 0.25 && xx < cw * 0.7;
        if (core || pod) tiles[yy * cw + xx] = 'floor';
      }
    for (let e = 0; e < (ch > 14 ? 3 : 2); e++) mods.push(['engine', 1, cy - Math.floor(ch * 0.28) + 1 + e * Math.floor((ch * 0.56) / (ch > 14 ? 2 : 1))]);
    const hs = generateHull({ w: cw, h: ch, tiles, modules: mods, own: false, seed: sd, variant: 'closed' });
    const kk = Math.min(0.5, 640 / hs.canvas.width);
    ctx.drawImage(hs.canvas, hx, y + 4, hs.canvas.width * kk, hs.canvas.height * kk);
    hx += hs.canvas.width * kk + 20;
    if (cw === 32) y += hs.canvas.height * kk + 30;
  }
  title('Планеты (свет — слева сверху)', 20, y);
  BIOME_TYPES.forEach((b, i) => {
    const r = 70;
    drawPlanetBody(ctx, 100 + i, b, 100 + i * 170, y + 95, r, Math.PI * 1.25);
    ctx.fillStyle = '#b0bec5';
    ctx.fillText(b, 70 + i * 170, y + 190);
  });

  y += 220;
  title('Астероиды, станция, контейнеры', 20, y);
  const kinds: Resource[][] = [['metal'], ['metal', 'ice'], ['metal', 'crystals'], ['ice', 'crystals'], ['metal', 'ice', 'crystals']];
  kinds.forEach((kk, i) => ctx.drawImage(asteroidSprite(i * 11 + 3, kk), 20 + i * 140, y + 10, 128, 128));
  ctx.drawImage(stationSprite(1), 740, y - 10, 220, 220);
  drawStar(ctx, 1290, y + 90, 50, '#ffe082', 1);
  ['#b0bec5', '#b3e5fc', '#ea80fc', '#ffd740'].forEach((c, i) => ctx.drawImage(crateSprite(c), 980 + i * 60, y + 50, 48, 48));

  y += 230;
  title('Враги в космосе', 20, y);
  (['drone', 'sentinel', 'sporecaster'] as NpcType[]).forEach((t, i) => ctx.drawImage(npcSprite(t), 20 + i * 170, y + 10, 150, 150));

  y += 190;
  title('Поверхность: шаттл и местная жизнь', 20, y);
  ctx.drawImage(shuttleSprite(), 20, y + 10, 150, 150);
  (['vine', 'stalker', 'sporeling', 'drone_scout', 'ice_crawler', 'magma_beetle', 'beast'] as const).forEach((t, i) =>
    ctx.drawImage(creatureSprite(t), 190 + i * 150, y + 20, 130, 130),
  );
  y += 180;
  title('Рельеф поверхности по биомам', 20, y);
  BIOME_TYPES.forEach((b, i) => {
    const surf = generateSurface(new Rng(40 + i), b, (() => { let id = 1; return () => id++; })());
    const img = renderTerrain(surf.terrain, surf.w, surf.h, b, 40 + i);
    // Крупно, по 4 в ряд — чтобы видеть берега, рябь и корку лавы.
    const cx = 20 + (i % 4) * 340;
    const cy = y + 10 + Math.floor(i / 4) * 255;
    ctx.drawImage(img, cx, cy, 330, 225);
    ctx.fillStyle = '#b0bec5';
    ctx.fillText(b, cx, cy + 242);
  });
  y += 10 + Math.ceil(BIOME_TYPES.length / 4) * 255 + 10;
  title('Залежи на поверхности: металл, лёд, кристаллы, еда, биомасса, вода, тайник Машин', 20, y);
  ['metal', 'ice', 'crystals', 'food', 'biomass', 'water', 'credits'].forEach((r, i) => ctx.drawImage(depositSprite(r, i), 20 + i * 150, y + 10, 130, 130));
}
