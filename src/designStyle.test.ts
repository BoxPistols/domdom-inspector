import { describe, expect, it } from 'vitest';
import { isColorValue, pickDesignStyle } from './designStyle';

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

  it('色は hex に整形する (rgb→#rrggbb)', () => {
    const props = pickDesignStyle(getter({ color: 'rgb(1, 2, 3)', 'background-color': 'rgb(255, 0, 16)' }));
    expect(props.find((p) => p.label === 'color')?.value).toBe('#010203');
    expect(props.find((p) => p.label === 'bg')?.value).toBe('#ff0010');
  });

  it('半透明 rgba は色を落とさずそのまま残す', () => {
    const props = pickDesignStyle(getter({ color: 'rgba(0, 0, 0, 0.5)' }));
    expect(props[0].value).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('getVar 未指定なら varName は付かない (後方互換)', () => {
    const props = pickDesignStyle(getter({ color: 'rgb(1, 2, 3)' }));
    expect(props[0].varName).toBeUndefined();
    expect(props[0].ambiguous).toBeUndefined();
  });

  it('getVar を渡すと宣言変数名を DesignProp に添える', () => {
    const props = pickDesignStyle(
      getter({ color: 'rgb(1, 2, 3)', padding: '8px 12px' }),
      (label) =>
        label === 'color'
          ? { name: '--text', names: ['--text'], ambiguous: false }
          : label === 'padding'
            ? { name: '--sp-2', names: ['--sp-2', '--sp-3'], ambiguous: true }
            : null,
    );
    const color = props.find((p) => p.label === 'color');
    expect(color?.varName).toBe('--text');
    expect(color?.ambiguous).toBeUndefined();
    expect(color?.value).toBe('#010203'); // 生値も維持

    const padding = props.find((p) => p.label === 'padding');
    expect(padding?.varName).toBe('--sp-2');
    expect(padding?.ambiguous).toBe(true);
    expect(padding?.varNames).toEqual(['--sp-2', '--sp-3']);
  });
});

describe('isColorValue', () => {
  it('#hex / rgb() / rgba() をスウォッチ対象と判定する', () => {
    expect(isColorValue('#1976d2')).toBe(true);
    expect(isColorValue('#fff')).toBe(true);
    expect(isColorValue('rgb(25, 118, 210)')).toBe(true);
    expect(isColorValue('rgba(0, 0, 0, 0.5)')).toBe(true);
  });

  it('キーワード・数値・px・shadow 複合値は対象外と判定する', () => {
    expect(isColorValue('normal')).toBe(false);
    expect(isColorValue('400')).toBe(false);
    expect(isColorValue('14px')).toBe(false);
    expect(isColorValue('8px 16px')).toBe(false);
    // box-shadow の複合値 (色 + オフセット) はスウォッチにしない
    expect(isColorValue('rgba(0, 0, 0, 0.2) 0px 2px 8px 0px')).toBe(false);
  });
});
