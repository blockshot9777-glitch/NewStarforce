// Генератор корпуса корабля: форма вырастает из реальной планировки отсеков.
// Нос вправо, двигательные гондолы — там, где стоят двигатели, по бокам — пилоны.
// Два варианта: «open» — вырез под интерьер (вид «Корабль»), «closed» — крыша отсеков и рубка
// (вид «Звёздная система» и чужие корабли: комнаты снаружи не видны, как в оригинале).
import { distanceInside, fbm, hash2, hex, makeCanvas, mix, rand, type RGB } from './kit';

/** Пикселей на клетку в текстуре корпуса. */
export const HULL_PX = 40;

export interface HullSprite {
  canvas: HTMLCanvasElement;
  /** Сколько клеток слева и сверху от клетки (0,0) планировки занимает корпус. */
  offX: number;
  offY: number;
  /** Сопла (в клетках планировки) — отсюда рисуется факел. */
  nozzles: { x: number; y: number; r: number }[];
  /** Бортовые огни (в клетках планировки). */
  lights: { x: number; y: number; color: string }[];
}

export interface HullInput {
  w: number;
  h: number;
  tiles: string[];
  modules: [string, number, number][];
  own: boolean;
  seed: number;
  variant: 'open' | 'closed';
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function generateHull(inp: HullInput): HullSprite {
  const { w, h, tiles } = inp;
  const R = rand(inp.seed * 7 + (inp.variant === 'open' ? 1 : 2));
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  tiles.forEach((t, i) => {
    if (t === 'empty') return;
    const x = i % w;
    const y = Math.floor(i / w);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  });
  if (minX >= maxX) {
    minX = 0;
    minY = 0;
    maxX = w;
    maxY = h;
  }
  const fw = maxX - minX;
  const fh = maxY - minY;
  const midY = (minY + maxY) / 2;
  const pad = 0.9;
  const bow = Math.max(3, Math.min(9, fh * 0.6)) + 1;
  const offX = 4.2 - minX;
  const offY = 2.6 - minY;
  const PX = HULL_PX;
  const CW = Math.ceil((fw + 4.2 + bow + 1.2) * PX);
  const CH = Math.ceil((fh + 5.2) * PX);
  const T = (tx: number) => (tx + offX) * PX;
  const U = (ty: number) => (ty + offY) * PX;

  // --- Маски частей корпуса ---
  const coverage = new Uint8Array(Math.ceil((fw + 4.2 + bow + 1.2) * HULL_PX) * Math.ceil((fh + 5.2) * HULL_PX));
  const part = (draw: (g: CanvasRenderingContext2D) => void) => {
    const [c, g] = makeCanvas(CW, CH);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    draw(g);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const m = new Uint8Array(c.width * c.height);
    for (let i = 0; i < m.length; i++) m[i] = data[i * 4 + 3] > 0 ? 1 : 0;
    // Покрытие края (сглаживание силуэта) запоминаем отдельно.
    for (let i = 0; i < m.length; i++) coverage[i] = Math.max(coverage[i], data[i * 4 + 3]);
    return m;
  };
  const roundRect = (g: CanvasRenderingContext2D, x: number, y: number, ww: number, hh: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, ww, hh, r);
    g.fill();
  };

  const engines = inp.modules.filter(([t]) => t === 'engine').map(([, x, y]) => ({ x, y }));
  const engineRows = [...new Set(engines.map((e) => e.y))];
  if (!engineRows.length) engineRows.push(minY + 1, maxY - 2);

  const body = part((g) => {
    tiles.forEach((t, i) => {
      if (t === 'empty') return;
      const x = i % w;
      const y = Math.floor(i / w);
      roundRect(g, T(x - pad), U(y - pad), (1 + 2 * pad) * PX, (1 + 2 * pad) * PX, PX * 0.6);
    });
    // Нос.
    g.beginPath();
    g.moveTo(T(maxX - 1), U(minY - pad + fh * 0.12));
    g.lineTo(T(maxX + bow - 0.6), U(midY - 0.35));
    g.quadraticCurveTo(T(maxX + bow), U(midY), T(maxX + bow - 0.6), U(midY + 0.35));
    g.lineTo(T(maxX - 1), U(maxY + pad - fh * 0.12));
    g.closePath();
    g.fill();
  });
  const nacelle = part((g) => {
    for (const ry of engineRows) roundRect(g, T(minX - 4), U(ry - 0.75), 5.2 * PX, 2.5 * PX, PX * 0.9);
  });
  const wing = part((g) => {
    for (const s of [-1, 1]) {
      const edge = U(s < 0 ? minY - pad : maxY + pad);
      g.beginPath();
      g.moveTo(T(minX + fw * 0.05), edge - s * PX * 0.3);
      g.lineTo(T(minX + fw * 0.12), edge + s * 1.9 * PX);
      g.lineTo(T(minX + fw * 0.5), edge + s * 1.5 * PX);
      g.lineTo(T(minX + fw * 0.68), edge - s * PX * 0.3);
      g.closePath();
      g.fill();
    }
  });
  const carve = part((g) => {
    tiles.forEach((t, i) => {
      if (t !== 'empty') g.fillRect(T(i % w), U(Math.floor(i / w)), PX, PX);
    });
  });

  const N = CW * CH;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = body[i] | nacelle[i] | wing[i];
  const dist = distanceInside(mask, CW, CH);

  // --- Высота и цвет по пикселям ---
  const base: RGB = inp.own ? hex('#c3c8ce') : hex('#a59f96');
  const dark: RGB = inp.own ? hex('#7b828a') : hex('#6d665f');
  const stripe: RGB = hex('#8e2b2b');
  const height = new Float32Array(N);
  const color: RGB[] = new Array(N);
  const gloss = new Float32Array(N);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const i = y * CW + x;
      if (!mask[i]) continue;
      const tx = x / PX - offX;
      const ty = y / PX - offY;
      // Фаска по краю + у гондол — цилиндр.
      let hgt = smooth(dist[i] / (PX * 0.8)) * 1.2;
      let col = base;
      if (nacelle[i] && !body[i]) {
        col = dark;
        // Цилиндр: высота по поперечному сечению ближайшей гондолы.
        let best = 9;
        for (const ry of engineRows) best = Math.min(best, Math.abs(ty - (ry + 0.5)));
        hgt += Math.sqrt(Math.max(0, 1 - (best / 1.25) ** 2)) * 1.8;
      } else if (wing[i] && !body[i]) {
        col = mix(base, dark, 0.25);
        hgt -= 0.15;
      }
      // Плиты обшивки со сдвигом рядов и швами.
      const row = Math.floor(ty / 1.25);
      const shift = (row & 1) * 1.0;
      const px2 = (tx + shift) / 2;
      const col2 = Math.floor(px2);
      const fx = px2 - col2;
      const fy = ty / 1.25 - row;
      const hp = hash2(col2, row, inp.seed);
      let k = 0.9 + hp * 0.14;
      // Акцентные плиты: часть обшивки темнее — корабль не выглядит новым.
      if (hp > 0.86) col = mix(col, dark, 0.45);
      // Заклёпки вдоль швов.
      if ((fx < 0.06 && Math.abs(((ty / 0.4) % 1) - 0.5) < 0.09) || (fy < 0.07 && Math.abs(((tx / 0.4) % 1) - 0.5) < 0.09)) {
        hgt += 0.1;
      }
      if (fx < 0.012 || fy < 0.02) {
        k *= 0.74;
        hgt -= 0.08;
      }
      // Потёртости и подтёки.
      k *= 0.86 + fbm(tx * 0.55, ty * 0.55, inp.seed + 9, 4) * 0.22;
      k *= 0.93 + 0.07 * Math.sign(Math.sin(ty * 9 + fbm(tx * 0.3, ty * 0.3, inp.seed, 2) * 6)) * fbm(tx * 0.2, ty * 3, inp.seed + 4, 2);
      // Красные полосы вдоль бортов и шеврон на носу.
      const band = Math.min(Math.abs(ty - (minY - pad + 0.45)), Math.abs(ty - (maxY + pad - 0.45)));
      const chevron = tx > maxX + 0.5 && Math.abs(Math.abs(ty - midY) - (maxX + bow - tx) * 0.33) < 0.18;
      if (body[i] && ((band < 0.16 && tx > minX - 0.5 && tx < maxX + 1) || chevron)) col = mix(col, stripe, 0.92);
      // Общий свет по кораблю: сверху-слева светлее, снизу-справа темнее.
      k *= 1.1 - 0.22 * ((x / CW) * 0.5 + (y / CH) * 0.5);
      color[i] = [col[0] * k, col[1] * k, col[2] * k];
      height[i] = hgt;
      gloss[i] = 0.35;
    }
  }

  // --- Освещение ---
  const [canvas, g] = makeCanvas(CW, CH);
  const img = g.createImageData(CW, CH);
  const d = img.data;
  const lx = -0.5;
  const ly = -0.6;
  const lz = 0.62;
  const Hh = (x: number, y: number) => {
    const i = Math.max(0, Math.min(CH - 1, y)) * CW + Math.max(0, Math.min(CW - 1, x));
    return mask[i] ? height[i] : -0.4;
  };
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const i = y * CW + x;
      if (!mask[i]) continue;
      const nx = -(Hh(x + 1, y) - Hh(x - 1, y)) * PX * 0.16;
      const ny = -(Hh(x, y + 1) - Hh(x, y - 1)) * PX * 0.16;
      const len = Math.hypot(nx, ny, 1);
      const ndl = (nx * lx + ny * ly + lz) / len;
      const diff = 0.38 + Math.max(0, ndl) * 0.78;
      const spec = Math.pow(Math.max(0, (2 * ndl) / len - lz), 14) * gloss[i] * 120;
      const c = color[i];
      // Тёмный кант по силуэту — корабль отделяется от космоса.
      const rim = dist[i] < 2.2 ? 0.45 : 1;
      d[i * 4] = Math.min(255, (c[0] * diff + spec) * rim);
      d[i * 4 + 1] = Math.min(255, (c[1] * diff + spec) * rim);
      d[i * 4 + 2] = Math.min(255, (c[2] * diff + spec) * rim);
      d[i * 4 + 3] = coverage[i];
    }
  }
  g.putImageData(img, 0, 0);

  // --- Детали поверх ---
  const nozzles: HullSprite['nozzles'] = [];
  for (const ry of engineRows) {
    const ny = ry + 0.5;
    // Решётки и трубы на гондоле.
    g.fillStyle = 'rgba(20,24,28,0.55)';
    for (let k = 0; k < 3; k++) g.fillRect(T(minX - 3 + k * 1.1), U(ny - 0.15), PX * 0.7, PX * 0.3);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(T(minX - 3.3), U(ny - 0.55));
    g.lineTo(T(minX + 0.8), U(ny - 0.55));
    g.stroke();
    // Сопла: два кольца с тёплым отсветом.
    for (const dy of [-0.38, 0.38]) {
      const cx = T(minX - 4.05);
      const cy = U(ny + dy);
      const r = PX * 0.42;
      const rg = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
      rg.addColorStop(0, '#ffb26b');
      rg.addColorStop(0.35, '#7a2a10');
      rg.addColorStop(0.7, '#1a1b1e');
      rg.addColorStop(1, '#4a4f56');
      g.fillStyle = rg;
      g.beginPath();
      g.ellipse(cx, cy, r * 0.55, r, 0, 0, Math.PI * 2);
      g.fill();
      nozzles.push({ x: minX - 4.05, y: ny + dy, r: 0.42 });
    }
  }
  // Короба, решётки и антенны на пилонах.
  for (const s of [-1, 1]) {
    const edge = U(s < 0 ? minY - pad : maxY + pad);
    for (let k = 0; k < 4; k++) {
      const gx = T(minX + fw * (0.14 + R() * 0.32));
      const gy = edge + s * PX * (0.35 + R() * 0.8);
      const gw = PX * (0.4 + R() * 0.7);
      const gh = PX * (0.25 + R() * 0.35);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(gx + 2, gy + 2, gw, gh);
      g.fillStyle = R() < 0.5 ? 'rgba(70,76,84,0.95)' : 'rgba(150,156,164,0.95)';
      g.fillRect(gx, gy, gw, gh);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(gx, gy, gw, 1.5);
    }
  }
  // Бортовой номер на верхнем пилоне.
  g.save();
  g.font = `bold ${Math.round(PX * 0.75)}px system-ui`;
  g.fillStyle = 'rgba(235,238,242,0.75)';
  g.textBaseline = 'middle';
  g.fillText(`Б-${String(inp.seed % 1000).padStart(3, '0')}`, T(minX + fw * 0.18), minY * PX + offY * PX - pad * PX - PX * 0.9);
  g.restore();

  if (inp.variant === 'open') {
    // Вырез под интерьер с утопленной тенью по краю.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = PX * 0.7;
    g.fillStyle = '#101317';
    tiles.forEach((t, i) => {
      if (t !== 'empty') g.fillRect(T(i % w) - 1, U(Math.floor(i / w)) - 1, PX + 2, PX + 2);
    });
    g.restore();
  } else {
    // Крыша отсеков: настил крупными плитами, огни иллюминаторов, остеклённая рубка у носа.
    g.save();
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 1.5;
    for (let x = minX; x <= maxX; x += 2) {
      g.beginPath();
      g.moveTo(T(x), U(minY));
      g.lineTo(T(x), U(maxY));
      g.stroke();
    }
    g.beginPath();
    g.moveTo(T(minX), U(midY));
    g.lineTo(T(maxX), U(midY));
    g.stroke();
    for (let x = minX + 1; x < maxX - 1; x += 1.5) {
      for (const y of [minY + 0.25, maxY - 0.25]) {
        if (carve[Math.round(U(y)) * CW + Math.round(T(x))] && R() < 0.7) {
          g.fillStyle = R() < 0.8 ? 'rgba(255,214,140,0.9)' : 'rgba(140,220,255,0.9)';
          g.fillRect(T(x) - 2, U(y) - 1.5, 4, 3);
        }
      }
    }
    const gx0 = T(maxX - 0.4);
    const glass = g.createLinearGradient(gx0, U(midY - 1), gx0 + PX * 1.6, U(midY + 1));
    glass.addColorStop(0, '#9be7ff');
    glass.addColorStop(0.45, '#1b6a8c');
    glass.addColorStop(1, '#0a1c26');
    g.fillStyle = glass;
    g.beginPath();
    g.moveTo(gx0, U(midY - 0.9));
    g.quadraticCurveTo(gx0 + PX * 2.1, U(midY), gx0, U(midY + 0.9));
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(20,24,28,0.9)';
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }

  const lights: HullSprite['lights'] = [
    { x: minX + fw * 0.12, y: minY - pad - 1.75, color: '#ff3b30' },
    { x: minX + fw * 0.12, y: maxY + pad + 1.75, color: '#34ff7a' },
    { x: maxX + bow - 0.5, y: midY, color: '#ffffff' },
  ];
  return { canvas, offX, offY, nozzles, lights };
}
