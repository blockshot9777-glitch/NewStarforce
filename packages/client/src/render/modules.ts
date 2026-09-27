// Процедурная отрисовка модулей. Если положить PNG в public/sprites/<тип>.png,
// будет использован спрайт (так можно подключить арт из оригинального STARFORCE.IO).
import { MODULES, MODULE_TYPES, type ModuleType } from '@starforce/shared';

const sprites = new Map<ModuleType, HTMLImageElement>();

export function loadSprites(): void {
  for (const type of MODULE_TYPES) {
    const img = new Image();
    img.onload = () => sprites.set(type, img);
    img.src = `sprites/${type}.png`;
  }
}

export interface ModuleLook {
  powered: boolean;
  active: boolean;
  growth: number;
  hpFrac: number;
  enabled: boolean;
}

export function drawModule(ctx: CanvasRenderingContext2D, type: ModuleType, x: number, y: number, s: number, look: ModuleLook, t: number): void {
  const sprite = sprites.get(type);
  const def = MODULES[type];
  ctx.save();
  ctx.translate(x, y);
  if (sprite) {
    ctx.drawImage(sprite, 0, 0, s, s);
  } else {
    drawProcedural(ctx, type, s, look, t, def.color);
  }
  if (!look.powered && def.demand > 0 && look.enabled) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, s, s);
    bolt(ctx, s * 0.5, s * 0.5, s * 0.35, '#ff5252');
  }
  if (!look.enabled) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#ffab40';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.22, -Math.PI * 0.3, Math.PI * 1.3);
    ctx.moveTo(s / 2, s * 0.22);
    ctx.lineTo(s / 2, s * 0.5);
    ctx.stroke();
  }
  if (look.hpFrac < 0.999) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(s * 0.1, s * 0.86, s * 0.8, s * 0.08);
    ctx.fillStyle = look.hpFrac <= 0 ? '#555' : look.hpFrac < 0.4 ? '#ff5252' : '#ffd740';
    ctx.fillRect(s * 0.1, s * 0.86, s * 0.8 * Math.max(0, look.hpFrac), s * 0.08);
    if (look.hpFrac <= 0) {
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.2);
      ctx.lineTo(s * 0.8, s * 0.8);
      ctx.moveTo(s * 0.8, s * 0.2);
      ctx.lineTo(s * 0.2, s * 0.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function bolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.15, cy - r);
  ctx.lineTo(cx - r * 0.45, cy + r * 0.1);
  ctx.lineTo(cx - r * 0.02, cy + r * 0.1);
  ctx.lineTo(cx - r * 0.15, cy + r);
  ctx.lineTo(cx + r * 0.45, cy - r * 0.1);
  ctx.lineTo(cx + r * 0.02, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
}

function base(ctx: CanvasRenderingContext2D, s: number, inset = 0.08): void {
  const i = s * inset;
  const g = ctx.createLinearGradient(0, i, 0, s - i);
  g.addColorStop(0, '#5b6270');
  g.addColorStop(1, '#343944');
  ctx.fillStyle = g;
  roundRect(ctx, i, i, s - 2 * i, s - 2 * i, s * 0.12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.stroke();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, alpha = 1): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawProcedural(ctx: CanvasRenderingContext2D, type: ModuleType, s: number, look: ModuleLook, t: number, color: string): void {
  const on = look.powered && look.enabled && look.hpFrac > 0;
  const c = s / 2;
  const lw = Math.max(1, s * 0.05);
  switch (type) {
    case 'reactor': {
      base(ctx, s, 0.04);
      ctx.fillStyle = '#1b1b1b';
      roundRect(ctx, s * 0.18, s * 0.18, s * 0.64, s * 0.64, s * 0.08);
      ctx.fill();
      const pulse = on ? 0.75 + 0.25 * Math.sin(t * 4) : 0.2;
      glow(ctx, c, c, s * 0.42, '#ff9100', pulse);
      ctx.fillStyle = on ? '#ffd180' : '#5d4037';
      for (let i = 0; i < 3; i++) ctx.fillRect(s * 0.26, s * (0.3 + i * 0.15), s * 0.48, s * 0.07);
      break;
    }
    case 'battery': {
      base(ctx, s);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#263238';
        ctx.fillRect(s * (0.2 + i * 0.21), s * 0.22, s * 0.16, s * 0.56);
        ctx.fillStyle = on ? '#c6ff00' : '#556b2f';
        ctx.fillRect(s * (0.2 + i * 0.21), s * (0.22 + 0.56 * 0.3), s * 0.16, s * 0.56 * 0.7);
      }
      break;
    }
    case 'engine': {
      base(ctx, s, 0.02);
      for (const [dx, dy, r] of [
        [0.33, 0.35, 0.2],
        [0.67, 0.35, 0.2],
        [0.5, 0.68, 0.22],
      ]) {
        ctx.fillStyle = '#212121';
        ctx.beginPath();
        ctx.arc(s * dx, s * dy, s * r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#757575';
        ctx.lineWidth = lw;
        ctx.stroke();
        ctx.fillStyle = on ? (look.active ? '#ff3d00' : '#b71c1c') : '#3e2723';
        ctx.beginPath();
        ctx.arc(s * dx, s * dy, s * r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'o2gen': {
      base(ctx, s);
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(on ? t * 6 : 0);
      ctx.fillStyle = '#b2ebf2';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(s * 0.14, 0, s * 0.15, s * 0.06, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(c, c, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'water_recycler': {
      base(ctx, s);
      for (const dx of [0.3, 0.7]) {
        const g = ctx.createLinearGradient(s * (dx - 0.15), 0, s * (dx + 0.15), 0);
        g.addColorStop(0, '#0d47a1');
        g.addColorStop(0.5, on ? '#4fc3f7' : '#37474f');
        g.addColorStop(1, '#0d47a1');
        ctx.fillStyle = g;
        roundRect(ctx, s * (dx - 0.15), s * 0.18, s * 0.3, s * 0.64, s * 0.12);
        ctx.fill();
      }
      break;
    }
    case 'hydroponics': {
      ctx.fillStyle = '#4e342e';
      roundRect(ctx, s * 0.06, s * 0.06, s * 0.88, s * 0.88, s * 0.08);
      ctx.fill();
      ctx.strokeStyle = '#9e9e9e';
      ctx.lineWidth = lw;
      ctx.stroke();
      const g = look.growth;
      ctx.strokeStyle = g >= 1 ? '#aeea00' : '#66bb6a';
      ctx.lineWidth = Math.max(1, s * 0.05);
      for (let i = 0; i < 4; i++) {
        const px = s * (0.2 + i * 0.2);
        const h = s * 0.1 + s * 0.55 * g;
        ctx.beginPath();
        ctx.moveTo(px, s * 0.85);
        ctx.quadraticCurveTo(px + s * 0.08, s * 0.85 - h / 2, px + s * 0.02 * Math.sin(t + i), s * 0.85 - h);
        ctx.stroke();
      }
      if (g >= 1) {
        ctx.fillStyle = '#ffeb3b';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(s * (0.22 + i * 0.2), s * 0.25, s * 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'bed': {
      ctx.fillStyle = '#5d4037';
      roundRect(ctx, s * 0.12, s * 0.08, s * 0.76, s * 0.84, s * 0.08);
      ctx.fill();
      ctx.fillStyle = '#90a4ae';
      roundRect(ctx, s * 0.18, s * 0.3, s * 0.64, s * 0.56, s * 0.06);
      ctx.fill();
      ctx.fillStyle = '#eceff1';
      roundRect(ctx, s * 0.22, s * 0.13, s * 0.56, s * 0.15, s * 0.05);
      ctx.fill();
      break;
    }
    case 'medbay': {
      base(ctx, s);
      ctx.fillStyle = '#eceff1';
      roundRect(ctx, s * 0.16, s * 0.16, s * 0.68, s * 0.68, s * 0.08);
      ctx.fill();
      ctx.fillStyle = on ? '#e53935' : '#8d6e63';
      ctx.fillRect(s * 0.42, s * 0.24, s * 0.16, s * 0.52);
      ctx.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.16);
      break;
    }
    case 'shield_gen': {
      base(ctx, s);
      glow(ctx, c, c, s * 0.45, '#b388ff', on ? 0.6 + 0.3 * Math.sin(t * 3) : 0.1);
      ctx.fillStyle = on ? '#7c4dff' : '#4a148c';
      ctx.beginPath();
      ctx.arc(c, c, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'laser':
    case 'missile': {
      base(ctx, s, 0.06);
      ctx.fillStyle = '#424242';
      ctx.beginPath();
      ctx.arc(c, c, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9e9e9e';
      ctx.lineWidth = lw;
      ctx.stroke();
      if (type === 'laser') {
        ctx.fillStyle = '#bdbdbd';
        ctx.fillRect(c - s * 0.12, c - s * 0.46, s * 0.08, s * 0.4);
        ctx.fillRect(c + s * 0.04, c - s * 0.46, s * 0.08, s * 0.4);
        glow(ctx, c, c, s * 0.2, '#ff1744', look.active ? 1 : on ? 0.3 : 0);
      } else {
        ctx.fillStyle = '#ff7043';
        for (const [dx, dy] of [
          [-0.1, -0.1],
          [0.1, -0.1],
          [-0.1, 0.1],
          [0.1, 0.1],
        ]) {
          ctx.beginPath();
          ctx.arc(c + s * dx, c + s * dy, s * 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'radar': {
      base(ctx, s);
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(on ? t * 1.5 : 0.5);
      ctx.fillStyle = '#b0bec5';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.34, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26a69a';
      ctx.fillRect(-s * 0.03, -s * 0.03, s * 0.3, s * 0.06);
      ctx.restore();
      break;
    }
    case 'mining_laser': {
      base(ctx, s);
      ctx.fillStyle = '#fbc02d';
      ctx.beginPath();
      ctx.moveTo(c, s * 0.12);
      ctx.lineTo(c + s * 0.2, c);
      ctx.lineTo(c, s * 0.88);
      ctx.lineTo(c - s * 0.2, c);
      ctx.closePath();
      ctx.fill();
      glow(ctx, c, c, s * 0.3, '#ffff00', look.active ? 0.9 : 0);
      break;
    }
    case 'lamp': {
      glow(ctx, c, c, s * 0.5, '#fff9c4', on ? 0.5 : 0);
      ctx.fillStyle = '#616161';
      ctx.beginPath();
      ctx.arc(c, c, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = on ? '#fffde7' : '#9e9e9e';
      ctx.beginPath();
      ctx.arc(c, c, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'solar_panel': {
      ctx.fillStyle = '#1a237e';
      ctx.fillRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
      ctx.strokeStyle = on ? '#7986cb' : '#3949ab';
      ctx.lineWidth = Math.max(1, s * 0.03);
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.06 + 0.22 * i), s * 0.06);
        ctx.lineTo(s * (0.06 + 0.22 * i), s * 0.94);
        ctx.moveTo(s * 0.06, s * (0.06 + 0.22 * i));
        ctx.lineTo(s * 0.94, s * (0.06 + 0.22 * i));
        ctx.stroke();
      }
      break;
    }
    case 'cryopod': {
      ctx.fillStyle = '#b0bec5';
      roundRect(ctx, s * 0.14, s * 0.06, s * 0.72, s * 0.88, s * 0.3);
      ctx.fill();
      ctx.fillStyle = on ? '#80deea' : '#546e7a';
      roundRect(ctx, s * 0.26, s * 0.16, s * 0.48, s * 0.56, s * 0.2);
      ctx.fill();
      break;
    }
    case 'bridge': {
      base(ctx, s, 0.04);
      ctx.fillStyle = '#102027';
      roundRect(ctx, s * 0.14, s * 0.14, s * 0.72, s * 0.34, s * 0.05);
      ctx.fill();
      ctx.fillStyle = on ? '#4fc3f7' : '#263238';
      ctx.fillRect(s * 0.2, s * 0.2, s * 0.26, s * 0.22);
      ctx.fillStyle = on ? '#69f0ae' : '#263238';
      ctx.fillRect(s * 0.54, s * 0.2, s * 0.26, s * 0.22);
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.arc(c, s * 0.72, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}
