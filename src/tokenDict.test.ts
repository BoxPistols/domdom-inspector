import { describe, expect, it } from 'vitest';
import {
  annotateProp,
  EMPTY_TOKEN_DICT,
  matchColor,
  matchSize,
  parseColor,
  parseSizePx,
  parseTokens,
} from './tokenDict';

describe('parseColor', () => {
  it('#rrggbb / #rgb / #rrggbbaa / rgb() / rgba() を正規化する', () => {
    expect(parseColor('#1668d4')).toEqual({ r: 0x16, g: 0x68, b: 0xd4, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 1);
    expect(parseColor('rgb(22, 104, 212)')).toEqual({ r: 22, g: 104, b: 212, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it('非対応値は null (キーワード / hsl / calc)', () => {
    expect(parseColor('red')).toBeNull();
    expect(parseColor('hsl(200, 50%, 50%)')).toBeNull();
  });
});

describe('parseSizePx', () => {
  it('px / rem / 素の数値を px に揃える', () => {
    expect(parseSizePx('8px')).toBe(8);
    expect(parseSizePx('0.5rem')).toBe(8);
    expect(parseSizePx(12)).toBe(12);
  });
  it('% や calc は null', () => {
    expect(parseSizePx('50%')).toBeNull();
    expect(parseSizePx('calc(100% - 8px)')).toBeNull();
  });
});

describe('parseTokens (3 フォーマット自動判別)', () => {
  it('W3C Design Tokens ($value/$type)', () => {
    const dict = parseTokens({
      color: { primary: { $value: '#1668d4', $type: 'color' } },
      space: { '2': { $value: '8px', $type: 'dimension' } },
    });
    expect(dict.colors).toEqual([{ name: 'color/primary', r: 0x16, g: 0x68, b: 0xd4, a: 1 }]);
    expect(dict.sizes).toEqual([{ name: 'space/2', px: 8 }]);
  });

  it('Tokens Studio (value/type)', () => {
    const dict = parseTokens({
      global: {
        brand: { value: '#ff0000', type: 'color' },
        radius: { md: { value: '4', type: 'borderRadius' } },
      },
    });
    expect(dict.colors[0].name).toBe('global/brand');
    expect(dict.sizes[0]).toEqual({ name: 'global/radius/md', px: 4 });
  });

  it('フラット辞書 (値から型推定)', () => {
    const dict = parseTokens({ 'primary/500': '#1668d4', 'space/1': '4px', 'space/n': 16 });
    expect(dict.colors.map((c) => c.name)).toEqual(['primary/500']);
    expect(dict.sizes.map((s) => `${s.name}=${s.px}`)).toEqual(['space/1=4', 'space/n=16']);
  });

  it('複合トークン ($value がオブジェクト: typography/shadow) は子要素を走査する', () => {
    const dict = parseTokens({
      typography: {
        body: {
          $type: 'typography',
          $value: { fontSize: '16px', lineHeight: '24px', fontFamily: 'Inter' },
        },
      },
      shadow: {
        card: { $type: 'shadow', $value: { color: '#00000040', blur: '4px' } },
      },
    });
    // パスに $value を挟まないクリーンな名前で登録される。fontFamily は色/サイズ
    // いずれでもないのでスキップ
    expect(dict.sizes.map((s) => `${s.name}=${s.px}`)).toEqual([
      'typography/body/fontSize=16',
      'typography/body/lineHeight=24',
      'shadow/card/blur=4',
    ]);
    expect(dict.colors.map((c) => c.name)).toEqual(['shadow/card/color']);
  });

  it('エイリアス参照や非対応値はスキップ (壊れない)', () => {
    const dict = parseTokens({
      alias: { $value: '{color.primary}', $type: 'color' },
      pct: { $value: '50%', $type: 'dimension' },
      meta: { $description: 'x' },
    });
    expect(dict.colors).toHaveLength(0);
    expect(dict.sizes).toHaveLength(0);
  });
});

const DICT = parseTokens({
  'primary': '#1668d4',
  'primary-dark': '#12569f',
  'space/1': '4px',
  'space/2': '8px',
});

describe('matchColor', () => {
  it('一致 (丸め誤差込み) は hit', () => {
    expect(matchColor(DICT, '#1668d4')?.hit).toBe('primary');
    expect(matchColor(DICT, 'rgb(22, 104, 212)')?.hit).toBe('primary');
  });
  it('近い色は nearest としてサジェスト、遠い色はサジェストなし', () => {
    expect(matchColor(DICT, '#1a6cd8')).toEqual({ hit: null, nearest: 'primary' });
    expect(matchColor(DICT, '#00ff00')).toEqual({ hit: null, nearest: null });
  });
  it('辞書が空 / 色でない値は null', () => {
    expect(matchColor(EMPTY_TOKEN_DICT, '#1668d4')).toBeNull();
    expect(matchColor(DICT, 'bold')).toBeNull();
  });
  it('完全透明 (a=0) は照合対象外 — 既定背景を野良色扱いしない', () => {
    expect(matchColor(DICT, 'rgba(0, 0, 0, 0)')).toBeNull();
    expect(matchColor(DICT, 'rgba(255, 0, 0, 0)')).toBeNull();
  });
});

describe('matchSize', () => {
  it('±0.25px は hit、±4px は nearest', () => {
    expect(matchSize(DICT, 8)?.hit).toBe('space/2');
    expect(matchSize(DICT, 10)).toEqual({ hit: null, nearest: 'space/2' });
    expect(matchSize(DICT, 100)).toEqual({ hit: null, nearest: null });
  });
});

describe('annotateProp (チップ注釈)', () => {
  it('色: 一致トークン名 / 野良色は最近傍サジェスト', () => {
    expect(annotateProp({ label: 'color', value: '#1668d4' }, DICT)).toEqual({
      kind: 'hit',
      names: ['primary'],
    });
    expect(annotateProp({ label: 'bg', value: '#1a6cd8' }, DICT)).toEqual({
      kind: 'miss',
      nearest: 'primary',
    });
  });

  it('padding: 全 px がトークンに乗れば hit (名前は重複排除)、0 は常に許容', () => {
    expect(annotateProp({ label: 'padding', value: '8px 4px 8px 0px' }, DICT)).toEqual({
      kind: 'hit',
      names: ['space/2', 'space/1'],
    });
  });

  it('padding: 1 つでも外れれば miss + 最近傍', () => {
    expect(annotateProp({ label: 'padding', value: '8px 10px' }, DICT)).toEqual({
      kind: 'miss',
      nearest: 'space/2',
    });
  });

  it('対象外ラベル / 辞書なしは null (注釈を出さない)', () => {
    expect(annotateProp({ label: 'shadow', value: '0 1px 2px #000' }, DICT)).toBeNull();
    expect(annotateProp({ label: 'padding', value: '8px' }, EMPTY_TOKEN_DICT)).toBeNull();
  });

  it('サイズ: トークンから遠い値 (レイアウト都合の可能性) は沈黙、色は常に警告', () => {
    // 100px はどのトークンからも遠い → デザイン逸脱と断定できずノイズになるため null
    expect(annotateProp({ label: 'padding', value: '100px' }, DICT)).toBeNull();
    // 色はどれからも遠くても野良色として警告 (最近傍なし)
    expect(annotateProp({ label: 'color', value: '#00ff00' }, DICT)).toEqual({
      kind: 'miss',
      nearest: null,
    });
  });
});
