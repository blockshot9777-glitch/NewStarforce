import { describe, expect, it } from 'vitest';
import { STAR_SYSTEMS } from '@starforce/shared';
import { NEBULA_SIZE, nebulaBlobs, tileOffset, wrappedCenters } from '../src/render/nebula';

/** Поле яркости так же, как рисуются пятна: копии за краем тайла переносятся внутрь. */
function paintField(blobs: { x: number; y: number; r: number }[], size: number, wrap: boolean): Float64Array {
  const img = new Float64Array(size * size);
  for (const b of blobs) {
    const centers = wrap ? wrappedCenters(b.x, b.y, b.r, size) : [{ x: b.x, y: b.y }];
    for (const c of centers) {
      const x0 = Math.max(0, Math.floor(c.x - b.r));
      const x1 = Math.min(size - 1, Math.ceil(c.x + b.r));
      const y0 = Math.max(0, Math.floor(c.y - b.r));
      const y1 = Math.min(size - 1, Math.ceil(c.y + b.r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
          if (d >= b.r) continue;
          img[y * size + x] += 1 - d / b.r;
        }
      }
    }
  }
  return img;
}

/** Скачок между пикселями, которые становятся соседями, когда тайлы стоят встык. */
function seamJump(img: Float64Array, size: number): number {
  let max = 0;
  for (let i = 0; i < size; i++) {
    max = Math.max(max, Math.abs(img[i * size]! - img[i * size + size - 1]!));
    max = Math.max(max, Math.abs(img[i]! - img[(size - 1) * size + i]!));
  }
  return max;
}

describe('туманность', () => {
  it('пятно внутри тайла рисуется один раз, у края и в углу — с переносом', () => {
    expect(wrappedCenters(32, 32, 10, 64)).toEqual([{ x: 32, y: 32 }]);
    expect(wrappedCenters(60, 30, 16, 64)).toEqual(
      expect.arrayContaining([
        { x: 60, y: 30 },
        { x: 60 - 64, y: 30 },
      ]),
    );
    expect(wrappedCenters(60, 30, 16, 64)).toHaveLength(2);
    const corner = wrappedCenters(4, 62, 14, 64);
    expect(corner).toEqual(
      expect.arrayContaining([
        { x: 4, y: 62 },
        { x: 4 + 64, y: 62 },
        { x: 4, y: 62 - 64 },
        { x: 4 + 64, y: 62 - 64 },
      ]),
    );
    expect(corner).toHaveLength(4);
  });

  it('перенос убирает шов, обрезка по краю тайла его оставляет', () => {
    const size = 64;
    const blobs = [
      { x: 2, y: 30, r: 18 },
      { x: 60, y: 8, r: 16 },
      { x: 4, y: 62, r: 14 },
      { x: 32, y: 32, r: 10 },
    ];
    const bound = blobs.reduce((sum, b) => sum + 1 / b.r, 0) + 1e-9;
    expect(seamJump(paintField(blobs, size, true), size)).toBeLessThanOrEqual(bound);
    expect(seamJump(paintField(blobs, size, false), size)).toBeGreaterThan(0.4);
  });

  it('пятна всех систем лежат в тайле и не накладывают свои копии', () => {
    for (let systemId = 0; systemId < STAR_SYSTEMS.length; systemId++) {
      const blobs = nebulaBlobs(systemId, STAR_SYSTEMS[systemId]!.star);
      expect(blobs).toHaveLength(28);
      for (const b of blobs) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThan(NEBULA_SIZE);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThan(NEBULA_SIZE);
        expect(b.r).toBeGreaterThanOrEqual(120);
        expect(b.r).toBeLessThan(440);
        expect(b.r).toBeLessThan(NEBULA_SIZE / 2);
        const centers = wrappedCenters(b.x, b.y, b.r, NEBULA_SIZE);
        expect(centers).toContainEqual({ x: b.x, y: b.y });
        if (b.x + b.r > NEBULA_SIZE) expect(centers).toContainEqual({ x: b.x - NEBULA_SIZE, y: b.y });
        if (b.x - b.r < 0) expect(centers).toContainEqual({ x: b.x + NEBULA_SIZE, y: b.y });
        if (b.y + b.r > NEBULA_SIZE) expect(centers).toContainEqual({ x: b.x, y: b.y - NEBULA_SIZE });
        if (b.y - b.r < 0) expect(centers).toContainEqual({ x: b.x, y: b.y + NEBULA_SIZE });
      }
    }
  });

  it('сдвиг тайла повторяется через период и остаётся в пределах одного тайла', () => {
    const period = NEBULA_SIZE / 0.02;
    expect(tileOffset(80_000, 0.02, NEBULA_SIZE)).toBeCloseTo(tileOffset(80_000 + period, 0.02, NEBULA_SIZE), 6);
    expect(tileOffset(-50_000, 0.02, NEBULA_SIZE)).toBeCloseTo(tileOffset(-50_000 + period, 0.02, NEBULA_SIZE), 6);
    for (const camera of [-200_000, -50_000, -1, 0, 1, 50_000, 200_000]) {
      const offset = tileOffset(camera, 0.02, NEBULA_SIZE);
      expect(offset).toBeGreaterThan(-NEBULA_SIZE);
      expect(offset).toBeLessThanOrEqual(0);
    }
  });
});
