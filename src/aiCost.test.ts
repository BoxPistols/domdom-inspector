import { describe, expect, it } from 'vitest';
import { estimateTokens } from './aiCost';

describe('estimateTokens', () => {
  it('ASCII は ≈4 文字/トークン、CJK は ≈1.5 文字/トークンで近似する', () => {
    expect(estimateTokens('abcdefgh')).toBe(2); // 8 ascii / 4
    expect(estimateTokens('あいう')).toBe(2); // 3 cjk / 1.5
    expect(estimateTokens('')).toBe(0);
    // 混在: 4 ascii (=1) + 3 cjk (=2)
    expect(estimateTokens('abcdあいう')).toBe(3);
  });
});
