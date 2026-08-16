import { describe, expect, it } from 'vitest';
import { heatColor } from './heatColor';

describe('heatColor', () => {
  // 境界値: <=1 青 / <=3 緑 / <=7 黄 / else 赤
  it('0 と 1 は青', () => {
    expect(heatColor(0)).toBe('96,165,250');
    expect(heatColor(1)).toBe('96,165,250');
  });
  it('2 と 3 は緑', () => {
    expect(heatColor(2)).toBe('52,211,153');
    expect(heatColor(3)).toBe('52,211,153');
  });
  it('4 と 7 は黄', () => {
    expect(heatColor(4)).toBe('251,191,36');
    expect(heatColor(7)).toBe('251,191,36');
  });
  it('8 以上は赤', () => {
    expect(heatColor(8)).toBe('248,113,113');
  });
});
