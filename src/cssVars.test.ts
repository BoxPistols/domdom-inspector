import { describe, expect, it } from 'vitest';
import { parseVarNames, specificity } from './cssVars';

// CSSOM 走査 (collectAuthoredVars) は Chrome 依存挙動 (var 入り shorthand の非展開等) のため
// e2e (実 Chromium) で検証する。ここでは純ロジックのみ機械テストする。

describe('parseVarNames (authored 値からの CSS 変数名抽出)', () => {
  it('単一 var を抽出する', () => {
    expect(parseVarNames('var(--text)')).toEqual({
      name: '--text',
      names: ['--text'],
      ambiguous: false,
    });
  });

  it('フォールバック付き var も名前を取る', () => {
    expect(parseVarNames('var(--space, 16px)')).toEqual({
      name: '--space',
      names: ['--space'],
      ambiguous: false,
    });
  });

  it('calc/color-mix 内の var も拾う', () => {
    expect(parseVarNames('calc(var(--x) + 2px)')?.name).toBe('--x');
    expect(parseVarNames('color-mix(in srgb, var(--a), var(--b))')).toEqual({
      name: '--a',
      names: ['--a', '--b'],
      ambiguous: true,
    });
  });

  it('shorthand で side 別変数は複数 = ambiguous', () => {
    expect(parseVarNames('var(--sp-2) var(--sp-3)')).toEqual({
      name: '--sp-2',
      names: ['--sp-2', '--sp-3'],
      ambiguous: true,
    });
  });

  it('同一変数の重複は 1 件に畳む (ambiguous でない)', () => {
    expect(parseVarNames('var(--sp) var(--sp)')).toEqual({
      name: '--sp',
      names: ['--sp'],
      ambiguous: false,
    });
  });

  it('var を含まない生値は null', () => {
    expect(parseVarNames('#eaedf4')).toBeNull();
    expect(parseVarNames('13px 16px')).toBeNull();
    expect(parseVarNames('')).toBeNull();
  });
});

describe('specificity (簡易 cascade 勝者推定)', () => {
  it('id > class > type の順で重い', () => {
    expect(specificity('#a')).toBeGreaterThan(specificity('.a'));
    expect(specificity('.a')).toBeGreaterThan(specificity('div'));
  });

  it('class/属性/擬似クラスは同じ桁で加算される', () => {
    expect(specificity('.a.b')).toBeGreaterThan(specificity('.a'));
    expect(specificity('.a[data-x]')).toBeGreaterThan(specificity('.a'));
    expect(specificity('.a:hover')).toBeGreaterThan(specificity('.a'));
  });

  it('子孫結合子は type を合算 (結合子自体は数えない)', () => {
    // section span = type 2 個
    expect(specificity('section span')).toBe(specificity('div p'));
    expect(specificity('.card > .body')).toBe(specificity('.a.b'));
  });
});
