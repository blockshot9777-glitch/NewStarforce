import { describe, expect, it } from 'vitest';
import { spatial } from '../src/audio';

describe('звук: громкость и панорама по положению', () => {
  it('в центре экрана — полная громкость без смещения', () => {
    expect(spatial(0, 0, 1)).toEqual({ gain: 1, pan: 0 });
  });
  it('справа — звук справа, слева — слева', () => {
    expect(spatial(300, 0, 1).pan).toBeGreaterThan(0);
    expect(spatial(-300, 0, 1).pan).toBeLessThan(0);
    expect(spatial(5000, 0, 1).pan).toBe(1);
  });
  it('далеко за экраном почти не слышно; при крупном масштабе то же расстояние в мире дальше на экране и тише', () => {
    expect(spatial(5000, 0, 1).gain).toBeLessThan(0.03);
    expect(spatial(400, 0, 4).gain).toBeLessThan(spatial(400, 0, 1).gain);
  });
});
