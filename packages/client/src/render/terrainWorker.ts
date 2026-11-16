// Фоновый поток рельефа планеты: карта считается ~0.3 с, игра в это время не замирает.
import type { Biome } from '@starforce/shared';
import { renderTerrain } from './terrain';

export interface TerrainJob {
  id: number;
  terrain: string;
  w: number;
  h: number;
  biome: Biome;
  seed: number;
}

self.onmessage = (e: MessageEvent<TerrainJob>) => {
  const { id, terrain, w, h, biome, seed } = e.data;
  const canvas = renderTerrain(terrain, w, h, biome, seed) as unknown as OffscreenCanvas;
  const bitmap = canvas.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ id, bitmap }, [bitmap]);
};
