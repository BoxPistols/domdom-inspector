import { describe, expect, it } from 'vitest';
import {
  annotateProp,
  EMPTY_TOKEN_DICT,
  matchColor,
  matchSize,
  mergeTokenDicts,
  parseColor,
  parseMuiTheme,
  parseSizePx,
  parseTokens,
  type TokenDict,
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
    expect(dict.sizes).toEqual([{ name: 'space/2', px: 8, category: 'space' }]);
  });

  it('Tokens Studio (value/type)', () => {
    const dict = parseTokens({
      global: {
        brand: { value: '#ff0000', type: 'color' },
        radius: { md: { value: '4', type: 'borderRadius' } },
      },
    });
    expect(dict.colors[0].name).toBe('global/brand');
    expect(dict.sizes[0]).toEqual({ name: 'global/radius/md', px: 4, category: 'radius' });
  });

  it('フラット辞書 (値から型推定)', () => {
    const dict = parseTokens({ 'primary/500': '#1668d4', 'space/1': '4px', 'space/n': 16 });
    expect(dict.colors.map((c) => c.name)).toEqual(['primary/500']);
    expect(dict.sizes.map((s) => `${s.name}=${s.px}`)).toEqual(['space/1=4', 'space/n=16']);
  });

  it('複合トークン ($value がオブジェクト: typography/shadow) は子要素を走査し、非長さ子は捨てる', () => {
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
    // パスに $value を挟まないクリーンな名前で子を走査する。ただしサイズとして登録するのは
    // カテゴリが判別できる長さのみ: fontSize→font。lineHeight (比率/px 両用で照合すると
    // padding 等を誤マッチさせる) と shadow の blur・fontFamily は登録しない (M3 の野良値検出保護)。
    expect(dict.sizes).toEqual([
      { name: 'typography/body/fontSize', px: 16, category: 'font' },
    ]);
    // shadow の色は複合トークンからでも抽出される
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
  it('±0.25px は hit、±4px は nearest (同カテゴリ内)', () => {
    expect(matchSize(DICT, 8, 'space')?.hit).toBe('space/2');
    expect(matchSize(DICT, 10, 'space')).toEqual({ hit: null, nearest: 'space/2' });
    expect(matchSize(DICT, 100, 'space')).toEqual({ hit: null, nearest: null });
  });
  it('該当カテゴリのトークンが無ければ null (カテゴリ跨ぎで照合しない)', () => {
    // DICT は space トークンのみ。radius/font カテゴリの候補は無い
    expect(matchSize(DICT, 8, 'radius')).toBeNull();
    expect(matchSize(DICT, 8, 'font')).toBeNull();
  });
});

// カテゴリ横断の誤マッチ検証用: font と radius のトークンを混在させた辞書
const MIXED = parseTokens({
  space: { '2': { $value: '8px', $type: 'dimension' } },
  fontSize: { sm: { $value: '14px', $type: 'fontSize' } },
  radius: { md: { $value: '6px', $type: 'borderRadius' } },
});

describe('カテゴリ非区別バグの回帰防止', () => {
  it('単位なし/非長さ値 (opacity/fontWeight/lineHeight/z-index) はサイズに混入しない', () => {
    const dict = parseTokens({
      'opacity/50': 0.5,
      'font-weight/bold': 700,
      'z/modal': 1000,
      'line-height/tight': 1.25,
    });
    expect(dict.sizes).toEqual([]);
  });

  it('font-size トークンは padding (space) に一致しない', () => {
    // padding:14px は fontSize/sm=14px と px は同じだが、カテゴリが違うので照合されない。
    // 14 は space/2=8 からは遠い (>4px) ので沈黙 → null (グリッド警告は overlay 側で残る)
    expect(annotateProp({ label: 'padding', value: '14px' }, MIXED)).toBeNull();
    // font ラベルなら fontSize/sm に一致する
    expect(annotateProp({ label: 'font', value: '14px' }, MIXED)).toEqual({
      kind: 'hit',
      names: ['fontSize/sm'],
    });
  });

  it('radius ラベルは radius トークンにだけ一致 (6px は 4px グリッド外でも正)', () => {
    expect(annotateProp({ label: 'radius', value: '6px' }, MIXED)).toEqual({
      kind: 'hit',
      names: ['radius/md'],
    });
    // gap は space カテゴリ
    expect(annotateProp({ label: 'gap', value: '8px' }, MIXED)).toEqual({
      kind: 'hit',
      names: ['space/2'],
    });
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

  it('サイズ: 近い外れ値の警告は px の並び順に依存しない', () => {
    // 遠い値 (100px) が先にあっても、近い外れ値 (10px→space/2) の警告を握りつぶさない
    const a = annotateProp({ label: 'padding', value: '100px 10px' }, DICT);
    const b = annotateProp({ label: 'padding', value: '10px 100px' }, DICT);
    expect(a).toEqual({ kind: 'miss', nearest: 'space/2' });
    expect(b).toEqual(a);
  });

  it('サイズ: 一致値と遠い外れ値が混在したら hit を主張しない (グリッド警告を残す)', () => {
    // 8px は space/2 に一致するが 100px は野良値。全体を hit と言うと 100px の
    // グリッド警告まで抑制されてしまうため null にする
    expect(annotateProp({ label: 'padding', value: '8px 100px' }, DICT)).toBeNull();
    expect(annotateProp({ label: 'padding', value: '100px 8px' }, DICT)).toBeNull();
  });

  it('色: 半透明トークンと不透明ページ色はアルファ差で不一致になる', () => {
    const dict = parseTokens({ overlay: { $value: '#00000080', $type: 'color' } });
    // 同じ RGB でも alpha が 0.5 と 1 なら距離 128 で HIT(3)/NEAR(64) を超え不一致
    expect(annotateProp({ label: 'bg', value: '#000000' }, dict)).toEqual({
      kind: 'miss',
      nearest: null,
    });
  });
});

describe('parseMuiTheme (FR-14)', () => {
  const theme = {
    palette: {
      mode: 'light',
      primary: { main: '#1976d2', light: '#42a5f5' },
      text: { primary: 'rgba(0, 0, 0, 0.87)' },
      getContrastText: () => '#fff',
      tonalOffset: 0.2,
    },
    spacing: (n: number) => `${n * 8}px`,
    shape: { borderRadius: 4 },
    typography: { fontSize: 14, body1: { fontSize: '1rem' }, h6: { fontSize: '1.25rem' } },
  };

  it('palette の色文字列を color トークン化する (関数・数値・非色文字列はスキップ)', () => {
    const dict = parseMuiTheme(theme);
    const names = dict.colors.map((c) => c.name);
    expect(names).toContain('palette.primary.main');
    expect(names).toContain('palette.text.primary');
    // 'light' (mode) は色として解釈できないのでスキップされる
    expect(names).not.toContain('palette.mode');
    expect(dict.colors.find((c) => c.name === 'palette.primary.main')).toMatchObject({
      r: 0x19,
      g: 0x76,
      b: 0xd2,
      a: 1,
    });
  });

  it('spacing 関数を代表倍数の space トークンに展開する', () => {
    const dict = parseMuiTheme(theme);
    expect(dict.sizes.find((s) => s.name === 'spacing(1)')).toMatchObject({
      px: 8,
      category: 'space',
    });
    expect(dict.sizes.find((s) => s.name === 'spacing(4)')?.px).toBe(32);
  });

  it('数値 spacing / shape.borderRadius / typography.*.fontSize も変換する', () => {
    const dict = parseMuiTheme({ ...theme, spacing: 4 });
    expect(dict.sizes.find((s) => s.name === 'spacing(2)')?.px).toBe(8);
    expect(dict.sizes.find((s) => s.name === 'shape.borderRadius')).toMatchObject({
      px: 4,
      category: 'radius',
    });
    // '1rem' → 16px (rem は ×16)
    expect(dict.sizes.find((s) => s.name === 'typography.body1.fontSize')).toMatchObject({
      px: 16,
      category: 'font',
    });
  });

  it('colorSchemes (CssVarsProvider) の palette も scheme 名付きで収集する', () => {
    const dict = parseMuiTheme({
      colorSchemes: { light: { palette: { primary: { main: '#1976d2' } } } },
      spacing: (n: number) => `${n * 8}px`,
      shape: { borderRadius: 4 },
      typography: {},
    });
    expect(dict.colors.map((c) => c.name)).toContain('light.palette.primary.main');
  });

  it('テーマ形でない入力は空辞書、spacing 関数の throw は spacing のみスキップ', () => {
    expect(parseMuiTheme(null)).toEqual({ colors: [], sizes: [] });
    expect(parseMuiTheme('not a theme')).toEqual({ colors: [], sizes: [] });
    const dict = parseMuiTheme({
      ...theme,
      spacing: () => {
        throw new Error('boom');
      },
    });
    expect(dict.sizes.some((s) => s.name.startsWith('spacing('))).toBe(false);
    expect(dict.colors.length).toBeGreaterThan(0);
  });
});

describe('mergeTokenDicts', () => {
  it('primary (手動貼り付け) を先頭に併合する = 同距離タイで手動が勝つ', () => {
    const manual: TokenDict = {
      colors: [{ name: 'manual', r: 1, g: 2, b: 3, a: 1 }],
      sizes: [],
    };
    const auto: TokenDict = {
      colors: [{ name: 'theme', r: 1, g: 2, b: 3, a: 1 }],
      sizes: [{ name: 'spacing(1)', px: 8, category: 'space' }],
    };
    const merged = mergeTokenDicts(manual, auto);
    expect(merged.colors.map((c) => c.name)).toEqual(['manual', 'theme']);
    expect(merged.sizes).toHaveLength(1);
    // 同 RGB のタイは配列先勝ち = 手動トークン名が hit になる
    expect(matchColor(merged, 'rgb(1, 2, 3)')?.hit).toBe('manual');
  });

  it('片側が空なら他方をそのまま返す (参照を保ち再割当を検知しやすくする)', () => {
    const some: TokenDict = { colors: [{ name: 'x', r: 0, g: 0, b: 0, a: 1 }], sizes: [] };
    expect(mergeTokenDicts(EMPTY_TOKEN_DICT, some)).toBe(some);
    expect(mergeTokenDicts(some, EMPTY_TOKEN_DICT)).toBe(some);
  });
});

describe('負値 (負マージン等) の照合 (issue #3 保留項目)', () => {
  // DICT: space/1=4px, space/2=8px (正トークンのみ)
  it('負値は絶対値がトークンに一致すれば hit (正当な負マージンの照合を壊さない)', () => {
    expect(annotateProp({ label: 'margin', value: '-8px' }, DICT)).toEqual({
      kind: 'hit',
      names: ['space/2'],
    });
    expect(annotateProp({ label: 'margin', value: '8px -8px' }, DICT)).toEqual({
      kind: 'hit',
      names: ['space/2'],
    });
  });

  it('負トークンそのものがあればそれを優先する', () => {
    const dict = parseTokens({ 'space/neg-2': { $value: '-8px', $type: 'dimension' } });
    expect(annotateProp({ label: 'margin', value: '-8px' }, dict)).toEqual({
      kind: 'hit',
      names: ['space/neg-2'],
    });
  });

  it('一致しない負値は警告せず判定保留 (グリッド警告は tokenLint 側に残る)', () => {
    // -6px は |−6| が space/1=4 / space/2=8 のどちらとも不一致 → null (miss を出さない)
    expect(annotateProp({ label: 'margin', value: '-6px' }, DICT)).toBeNull();
    // 正値の一致と混在しても、負値が不一致なら全体 hit を主張しない
    expect(annotateProp({ label: 'margin', value: '8px -6px' }, DICT)).toBeNull();
  });
});
