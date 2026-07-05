import { describe, expect, it } from 'vitest';
import { pickDesignStyle } from './designStyle';

const getter = (map: Record<string, string>) => (prop: string) => map[prop] ?? '';

describe('pickDesignStyle', () => {
  it('主要デザインプロパティを抽出し、既定値/ゼロ余白/none を除外する', () => {
    const props = pickDesignStyle(
      getter({
        color: 'rgb(51, 51, 51)',
        'background-color': 'rgb(255, 255, 255)',
        'font-size': '16px',
        'font-weight': '700',
        'line-height': 'normal', // 除外
        padding: '16px',
        margin: '0px', // 除外 (ゼロ余白)
        'border-radius': '8px',
        'box-shadow': 'none', // 除外
        gap: '0px 0px', // 除外
      }),
    );
    const labels = props.map((p) => p.label);
    expect(labels).toEqual(['color', 'bg', 'font', 'weight', 'padding', 'radius']);
    expect(props.find((p) => p.label === 'radius')?.value).toBe('8px');
  });

  it('transparent 背景と font-weight:400(既定) を除外する', () => {
    const props = pickDesignStyle(
      getter({
        color: 'rgb(0, 0, 0)',
        'background-color': 'rgba(0, 0, 0, 0)',
        'font-weight': '400',
      }),
    );
    expect(props.map((p) => p.label)).toEqual(['color']);
  });

  it('長い値は 48 文字 + … に省略し、rgb()/shadow の内部カンマは壊さない', () => {
    const long =
      'rgba(0, 0, 0, 0.2) 0px 2px 8px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px 0px';
    const props = pickDesignStyle(getter({ 'box-shadow': long }));
    const shadow = props.find((p) => p.label === 'shadow');
    expect(shadow?.value.endsWith('…')).toBe(true);
    expect(shadow?.value.length).toBe(49);
    expect(shadow?.value.startsWith('rgba(0, 0, 0, 0.2)')).toBe(true);
  });

  it('空値のプロパティはスキップする', () => {
    const props = pickDesignStyle(getter({ color: 'rgb(1,2,3)' }));
    expect(props).toHaveLength(1);
    expect(props[0]).toEqual({ label: 'color', value: 'rgb(1,2,3)' });
  });
});
