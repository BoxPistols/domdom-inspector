import { describe, expect, it } from 'vitest';
import { DEFAULT_STRINGS } from './types';
import {
  clampBadgePosition,
  colorFor,
  designLabel,
  shapeClassFor,
  visibleProps,
} from './overlayFormat';

describe('colorFor', () => {
  const colors = { mui: '#2196f3', custom: '#4caf50', thirdParty: '#9e9e9e' };
  it('mui は mui 色', () => expect(colorFor('mui', colors)).toBe('#2196f3'));
  it('custom は custom 色', () => expect(colorFor('custom', colors)).toBe('#4caf50'));
  it('third-party は thirdParty 色', () => expect(colorFor('third-party', colors)).toBe('#9e9e9e'));
});

describe('shapeClassFor', () => {
  // SC 1.4.1: 分類を色だけで伝えない。色を判別できなくても形で 3 分類が読めること
  const CLASSIFICATIONS = ['mui', 'custom', 'third-party'] as const;

  it('分類ごとに異なる形状クラスを返す', () => {
    const shapes = CLASSIFICATIONS.map((c) => shapeClassFor(c));
    expect(new Set(shapes).size).toBe(CLASSIFICATIONS.length);
  });

  it('形状クラスは CSS 側に定義がある名前だけを使う', () => {
    // overlayStyles.ts / popup の凡例と同じ語彙。増やすなら CSS も同時に足す
    const DEFINED = ['circle', 'square', 'diamond'];
    for (const c of CLASSIFICATIONS) expect(DEFINED).toContain(shapeClassFor(c));
  });

  it('色と形が 1 対 1 で対応する (凡例が嘘にならない)', () => {
    const colors = { mui: '#2196f3', custom: '#4caf50', thirdParty: '#9e9e9e' };
    const pairs = CLASSIFICATIONS.map((c) => `${colorFor(c, colors)}/${shapeClassFor(c)}`);
    expect(new Set(pairs).size).toBe(CLASSIFICATIONS.length);
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

describe('clampBadgePosition (バッジがビューポート外へ出る回帰の防止)', () => {
  const VIEW = { width: 1000, height: 800 };
  const BADGE = { width: 560, height: 100 };

  it('通常は要素の左端に揃え、上に余白があれば上へ置く', () => {
    const p = clampBadgePosition({ left: 100, top: 300, bottom: 340 }, BADGE, VIEW);
    expect(p.left).toBe(100);
    expect(p.top).toBe(300 - 100 - 4);
  });

  it('右端に近い要素でもバッジが画面外へはみ出さない (今回の実機バグ)', () => {
    // 左端 900 のままだと 900+560=1460 で 1000 を大きく超える
    const p = clampBadgePosition({ left: 900, top: 300, bottom: 340 }, BADGE, VIEW);
    expect(p.left).toBe(1000 - 560 - 4);
    expect(p.left + BADGE.width).toBeLessThanOrEqual(VIEW.width);
  });

  it('上に余白が無ければ下へ回し、下端も超えない', () => {
    const p = clampBadgePosition({ left: 10, top: 5, bottom: 760 }, BADGE, VIEW);
    // 下に置くと 766 + 100 = 866 で 800 を超えるのでクランプされる
    expect(p.top).toBe(800 - 100 - 4);
    expect(p.top + BADGE.height).toBeLessThanOrEqual(VIEW.height);
  });

  it('ビューポートより大きいバッジは左上に寄せる (負の座標にしない)', () => {
    const p = clampBadgePosition({ left: 500, top: 400, bottom: 450 }, { width: 1200, height: 900 }, VIEW);
    expect(p.left).toBe(4);
    expect(p.top).toBe(4);
  });
});
