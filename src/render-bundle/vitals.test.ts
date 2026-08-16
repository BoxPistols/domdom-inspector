import { describe, expect, it } from 'vitest';
import { CLS_INITIAL, formatVital, rateVital, updateCls } from './vitals';

describe('rateVital (web.dev しきい値)', () => {
  it('LCP: 2500ms 以下 good / 4000ms 以下 needs-improvement / 超は poor', () => {
    expect(rateVital('LCP', 2500)).toBe('good');
    expect(rateVital('LCP', 2501)).toBe('needs-improvement');
    expect(rateVital('LCP', 4000)).toBe('needs-improvement');
    expect(rateVital('LCP', 4001)).toBe('poor');
  });

  it('CLS: 0.1 / 0.25 境界', () => {
    expect(rateVital('CLS', 0.1)).toBe('good');
    expect(rateVital('CLS', 0.2)).toBe('needs-improvement');
    expect(rateVital('CLS', 0.3)).toBe('poor');
  });

  it('INP: 200ms / 500ms 境界', () => {
    expect(rateVital('INP', 199)).toBe('good');
    expect(rateVital('INP', 350)).toBe('needs-improvement');
    expect(rateVital('INP', 501)).toBe('poor');
  });
});

describe('formatVital', () => {
  it('CLS は無次元 3 桁、ms は 1s 以上で秒表記', () => {
    expect(formatVital('CLS', 0.123456)).toBe('0.123');
    expect(formatVital('LCP', 850)).toBe('850ms');
    expect(formatVital('LCP', 2340)).toBe('2.34s');
  });
});

describe('updateCls (session window 方式)', () => {
  const shift = (value: number, startTime: number, hadRecentInput = false) => ({
    value,
    startTime,
    hadRecentInput,
  });

  it('連続シフト (間隔 1s 以内) は同一セッションに合算される', () => {
    let s = CLS_INITIAL;
    s = updateCls(s, shift(0.1, 1000));
    s = updateCls(s, shift(0.1, 1500));
    expect(s.max).toBeCloseTo(0.2);
  });

  it('1s 超の間隔で新セッションが始まり、max は過去最大を保持する', () => {
    let s = CLS_INITIAL;
    s = updateCls(s, shift(0.2, 1000));
    s = updateCls(s, shift(0.05, 3000)); // gap 2s → 新セッション
    expect(s.current).toBeCloseTo(0.05);
    expect(s.max).toBeCloseTo(0.2);
  });

  it('セッション全長 5s 超でも新セッションに切れる', () => {
    let s = CLS_INITIAL;
    s = updateCls(s, shift(0.1, 0));
    s = updateCls(s, shift(0.1, 900));
    s = updateCls(s, shift(0.1, 1800));
    s = updateCls(s, shift(0.1, 2700));
    s = updateCls(s, shift(0.1, 3600));
    s = updateCls(s, shift(0.1, 4500));
    s = updateCls(s, shift(0.1, 5400)); // 窓全長 > 5s → 新セッション
    expect(s.current).toBeCloseTo(0.1);
    expect(s.max).toBeCloseTo(0.6);
  });

  it('直近入力ありのシフトは CLS に含めない (web.dev 定義)', () => {
    let s = CLS_INITIAL;
    s = updateCls(s, shift(0.5, 1000, true));
    expect(s.max).toBe(0);
  });
});
