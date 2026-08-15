import { describe, expect, it } from 'vitest';
import { parseMappings, serializeMappings } from './mappings';

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

describe('parseMappings / serializeMappings — オリジン限定', () => {
  it('` @ origin` をオリジン限定として読む', () => {
    expect(parseMappings('/src=/abs/src @ localhost:3000')).toEqual([
      { from: '/src', to: '/abs/src', origin: 'localhost:3000' },
    ]);
  });
  it('限定なしは origin キー自体を持たない (保存形を汚さない)', () => {
    expect(parseMappings('/src=/abs/src')).toEqual([{ from: '/src', to: '/abs/src' }]);
  });
  it('往復で一致する (popup の 編集 → 保存 → 再表示 で内容が変わらない)', () => {
    const text = '/src=/abs/a @ localhost:3000\n/views=/abs/views';
    expect(serializeMappings(parseMappings(text))).toBe(text);
  });
});
