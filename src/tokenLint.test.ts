import { describe, expect, it } from 'vitest';
import { lintSpacing } from './tokenLint';
import type { DesignProp } from './types';

const d = (label: string, value: string): DesignProp => ({ label, value });

describe('lintSpacing', () => {
  it('4px グリッドに乗る値は指摘しない', () => {
    expect(lintSpacing([d('padding', '16px'), d('radius', '8px'), d('gap', '0px')])).toEqual([]);
  });

  it('グリッド外の値を野良値として検出する', () => {
    const f = lintSpacing([d('padding', '17px')]);
    expect(f).toHaveLength(1);
    expect(f[0]).toEqual({ label: 'padding', value: '17px', offGrid: [17] });
  });

  it('複合値の一部だけグリッド外でも検出する', () => {
    const f = lintSpacing([d('padding', '16px 17px 16px 16px')]);
    expect(f[0].offGrid).toEqual([17]);
  });

  it('spacing 以外 (color/font) は検査しない', () => {
    expect(lintSpacing([d('color', 'rgb(1,2,3)'), d('font', '15px')])).toEqual([]);
  });

  it('grid=8 では 12px が野良値になる (グリッド可変)', () => {
    expect(lintSpacing([d('margin', '16px')], 8)).toEqual([]);
    expect(lintSpacing([d('margin', '12px')], 8)[0].offGrid).toEqual([12]);
  });

  it('0px はグリッド外にしない', () => {
    expect(lintSpacing([d('padding', '0px 17px')])[0].offGrid).toEqual([17]);
  });
});
