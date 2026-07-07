import { describe, expect, it } from 'vitest';
import { normalizeRecordKey } from './recordKey';

describe('normalizeRecordKey', () => {
  it('空文字は fallback に倒す', () => {
    expect(normalizeRecordKey('', 'r')).toBe('r');
  });
  it('複数文字は fallback に倒す', () => {
    expect(normalizeRecordKey('ab', 'r')).toBe('r');
  });
  it('大文字は小文字化する', () => {
    expect(normalizeRecordKey('R', 'r')).toBe('r');
  });
  it('小文字はそのまま', () => {
    expect(normalizeRecordKey('r', 'r')).toBe('r');
  });
  it('数字はそのまま (単一文字)', () => {
    expect(normalizeRecordKey('1', 'r')).toBe('1');
  });
  it('fallback は呼び出し元の指定を尊重する', () => {
    expect(normalizeRecordKey('', 'x')).toBe('x');
  });
});
