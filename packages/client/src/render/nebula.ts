/** Сторона квадратного тайла туманности. Фон — это повторение одного тайла. */
export const NEBULA_SIZE = 1024;

export interface NebulaBlob {
  x: number;
  y: number;
  r: number;
  /** Цвет центра, #rrggbb. Прозрачность задаётся при рисовании. */
  color: string;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Пятна одной звёздной системы. Семя совпадает с прежней формулой systemId * 31 + 5. */
export function nebulaBlobs(systemId: number, starColor: string, size = NEBULA_SIZE): NebulaBlob[] {
  const rnd = seeded(systemId * 31 + 5);
  const tints = ['#3949ab', '#6a1b9a', '#00838f', starColor];
  const blobs: NebulaBlob[] = [];
  for (let i = 0; i < 28; i++) {
    blobs.push({
      x: rnd() * size,
      y: rnd() * size,
      r: 120 + rnd() * 320,
      color: tints[i % tints.length]!,
    });
  }
  return blobs;
}

/**
 * Центры копий пятна, пересекающих тайл.
 * Пятно у края рисуется ещё раз с противоположной стороны, поэтому соседние тайлы стыкуются без шва.
 * Радиус меньше половины стороны — копии одного пятна не накладываются друг на друга.
 */
export function wrappedCenters(x: number, y: number, r: number, size: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
      out.push({ x: px, y: py });
    }
  }
  return out;
}

/** Смещение повторяющегося тайла в пикселях экрана, в полуинтервале (-size, 0]. */
export function tileOffset(camera: number, factor: number, size: number): number {
  const wrapped = (((camera * factor) % size) + size) % size;
  return wrapped === 0 ? 0 : -wrapped;
}
