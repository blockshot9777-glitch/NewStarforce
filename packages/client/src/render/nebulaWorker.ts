// Фоновый поток рисованного слоя туманности: ~0.2 с счёта при прыжке в систему не подвешивают игру.
import { nebulaPixels } from './nebula';

self.onmessage = (e: MessageEvent<{ systemId: number; star: string; res: number }>) => {
  const { systemId, star, res } = e.data;
  const px = nebulaPixels(systemId, star, res);
  (self as unknown as Worker).postMessage({ systemId, res, px }, [px.buffer]);
};
