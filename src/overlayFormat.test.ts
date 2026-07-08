import { describe, expect, it } from 'vitest';
import { DEFAULT_STRINGS } from './types';
import { colorFor, designLabel, heatColor, visibleProps } from './overlayFormat';

describe('colorFor', () => {
  const colors = { mui: '#2196f3', custom: '#4caf50', thirdParty: '#9e9e9e' };
  it('mui は mui 色', () => expect(colorFor('mui', colors)).toBe('#2196f3'));
  it('custom は custom 色', () => expect(colorFor('custom', colors)).toBe('#4caf50'));
  it('third-party は thirdParty 色', () => expect(colorFor('third-party', colors)).toBe('#9e9e9e'));
});

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

describe('designLabel', () => {
  it('既知 id は対応する表示名に解決する', () => {
    expect(designLabel('color', DEFAULT_STRINGS)).toBe(DEFAULT_STRINGS.dsColor);
    expect(designLabel('radius', DEFAULT_STRINGS)).toBe(DEFAULT_STRINGS.dsRadius);
  });
  it('未知 id はそのまま返す', () => {
    expect(designLabel('unknownProp', DEFAULT_STRINGS)).toBe('unknownProp');
  });
});

describe('visibleProps', () => {
  const five = [1, 2, 3, 4, 5];
  it('compact は 0 件', () => {
    expect(visibleProps(five, 'compact')).toEqual([]);
  });
  it('normal は先頭 4 件 (n>=4)', () => {
    expect(visibleProps(five, 'normal')).toEqual([1, 2, 3, 4]);
  });
  it('normal は n<4 のとき n 件', () => {
    expect(visibleProps([1, 2], 'normal')).toEqual([1, 2]);
  });
  it('detailed は全件', () => {
    expect(visibleProps(five, 'detailed')).toEqual(five);
  });
});
