// Переборки интерьера: плитка стены по маске соседей (16 вариантов), сплошная сталь с фаской
// к отсекам, трубой и кабель-каналом вдоль переборки, болтами на стыках.
import { hash2, hex, litSprite, mix, SpriteCache, type RGB } from './kit';

const walls = new SpriteCache<HTMLCanvasElement>(16);
const S = 64;

/** Биты соседей-стен: N=1, E=2, S=4, W=8. */
export function wallTile(mask: number): HTMLCanvasElement {
  return walls.get(String(mask), () => {
    const n = (mask & 1) !== 0;
    const e = (mask & 2) !== 0;
    const s = (mask & 4) !== 0;
    const w = (mask & 8) !== 0;
    const horiz = e || w;
    const vert = n || s;
    const base: RGB = hex('#5d656f');
    return litSprite(
      S,
      S,
      (u, v) => {
        // Расстояние до «открытой» стороны (где нет соседа-стены) — там фаска вниз, к полу отсека.
        let open = 1;
        if (!n) open = Math.min(open, v);
        if (!s) open = Math.min(open, 1 - v);
        if (!w) open = Math.min(open, u);
        if (!e) open = Math.min(open, 1 - u);
        const bevel = Math.min(1, open / 0.2);
        let h = Math.sqrt(bevel) * 1.4;
        let col: RGB = mix(base, hex('#7c858f'), hash2(Math.floor(u * 2), Math.floor(v * 2), mask) * 0.4);
        let gloss = 0.3;
        // Плиты обшивки переборки.
        if (Math.abs(u - 0.5) < 0.012 || Math.abs(v - 0.5) < 0.012) {
          h -= 0.08;
          col = mix(col, [20, 22, 26], 0.5);
        }
        // Труба вдоль переборки (по направлению соединения) и кабель-канал.
        const along = horiz && !vert ? v : vert && !horiz ? u : -1;
        if (along >= 0) {
          const pipe = Math.abs(along - 0.36);
          if (pipe < 0.09) {
            h += Math.sqrt(1 - (pipe / 0.09) ** 2) * 0.9;
            col = hex('#8f98a2');
            gloss = 0.7;
          }
          const cable = Math.abs(along - 0.64);
          if (cable < 0.05) {
            h += 0.25;
            col = hex('#2c3137');
            gloss = 0.1;
          }
        } else {
          // Угол/тройник — короб узла с болтами.
          const d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
          if (d < 0.28) {
            h += 0.35;
            col = hex('#4c535c');
          }
        }
        // Болты по углам плиты.
        for (const [bx, by] of [
          [0.15, 0.15],
          [0.85, 0.15],
          [0.15, 0.85],
          [0.85, 0.85],
        ]) {
          if (Math.hypot(u - bx, v - by) < 0.035) {
            h += 0.3;
            col = hex('#9aa3ad');
            gloss = 0.8;
          }
        }
        return { h, color: col, alpha: 1, gloss };
      },
      5,
    );
  });
}

export function wallMask(isWall: (dx: number, dy: number) => boolean): number {
  return (isWall(0, -1) ? 1 : 0) | (isWall(1, 0) ? 2 : 0) | (isWall(0, 1) ? 4 : 0) | (isWall(-1, 0) ? 8 : 0);
}
