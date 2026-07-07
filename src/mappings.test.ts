import { describe, expect, it } from 'vitest';
import { parseMappings } from './mappings';

describe('parseMappings', () => {
  it('空文字は空配列', () => {
    expect(parseMappings('')).toEqual([]);
  });
  it('= を含まない行は除外', () => {
    expect(parseMappings('foo\nbar')).toEqual([]);
  });
  it('from=to をパースする', () => {
    expect(parseMappings('/src=/abs/src')).toEqual([{ from: '/src', to: '/abs/src' }]);
  });
  it('値内の = は最初の = のみで分割する', () => {
    expect(parseMappings('a=b=c')).toEqual([{ from: 'a', to: 'b=c' }]);
  });
  it('前後の空白を trim する', () => {
    expect(parseMappings('  /src=/abs  ')).toEqual([{ from: '/src', to: '/abs' }]);
  });
  it('複数行をそれぞれパースする', () => {
    expect(parseMappings('/a=/x\n/b=/y')).toEqual([
      { from: '/a', to: '/x' },
      { from: '/b', to: '/y' },
    ]);
  });
});
