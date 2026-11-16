// Фоновый поток генерации корпуса: стройка не подвешивает игру, пока рисуется новая обшивка.
import { generateHull, type HullInput } from './hull';

self.onmessage = (e: MessageEvent<{ key: string; input: HullInput }>) => {
  const sprite = generateHull(e.data.input);
  const bitmap = (sprite.canvas as unknown as OffscreenCanvas).transferToImageBitmap();
  (self as unknown as Worker).postMessage({ key: e.data.key, sprite: { ...sprite, canvas: bitmap } }, [bitmap]);
};
