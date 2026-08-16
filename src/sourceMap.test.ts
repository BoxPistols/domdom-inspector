import { describe, expect, it } from 'vitest';
import {
  decodeVlq,
  resolveOriginalPosition,
  sourceMapUrlFrom,
  toLocalPath,
  type RawSourceMap,
} from './sourceMap';

/**
 * 実測 (2026-08-16, Next.js 16 + Turbopack + React 19) で確かめた経路を固定する:
 *   `_debugStack` の `…/_next/static/chunks/_1dffrib._.js:1921:245`
 *     → indexed source map (35 sections)
 *     → `/Users/…/components/input/SampleBrowser.tsx:68` = 対象の `<img>` の行
 *
 * 実データは利用者のコードなので持ち込まない。**同じ構造 (indexed / 差分符号 /
 * セクションの列オフセット) を持つ最小の map** で同じ性質を検証する。
 */

/** 1 セグメントを VLQ に符号化 (テスト用の逆変換) */
function encodeVlq(values: number[]): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (const value of values) {
    let v = value < 0 ? (-value << 1) | 1 : value << 1;
    do {
      let digit = v & 31;
      v >>>= 5;
      if (v > 0) digit |= 32;
      out += CHARS[digit];
    } while (v > 0);
  }
  return out;
}

const seg = (...v: number[]) => encodeVlq(v);

describe('decodeVlq', () => {
  it('往復して同じ値になる', () => {
    for (const values of [[0], [1, 0, 0, 0], [-5], [245, 0, 67, 12], [1000000]]) {
      expect(decodeVlq(encodeVlq(values))).toEqual(values);
    }
  });

  it('**壊れた入力では途中までを返さず空にする** (誤った位置を出さない)', () => {
    expect(decodeVlq('AA!AA')).toEqual([]);
    expect(decodeVlq('')).toEqual([]);
  });
});

describe('resolveOriginalPosition — 素の map', () => {
  // 生成 1 行目に 2 つの区間: 列 1→ 元 10 行 / 列 21→ 元 20 行
  const map: RawSourceMap = {
    version: 3,
    sources: ['file:///p/App.tsx'],
    mappings: [seg(0, 0, 9, 0), seg(20, 0, 10, 0)].join(','),
  };

  it('対象列を超えない最大の区間を選ぶ', () => {
    expect(resolveOriginalPosition(map, 1, 5)).toEqual({
      source: 'file:///p/App.tsx',
      line: 10,
      column: 1,
    });
    expect(resolveOriginalPosition(map, 1, 30)).toEqual({
      source: 'file:///p/App.tsx',
      line: 20,
      column: 1,
    });
  });

  it('区間の開始ちょうどはその区間', () => {
    expect(resolveOriginalPosition(map, 1, 21)?.line).toBe(20);
  });

  it('どの区間より左なら解決しない (近いものを勝手に選ばない)', () => {
    const later: RawSourceMap = { sources: ['file:///p/A.tsx'], mappings: seg(10, 0, 4, 0) };
    expect(resolveOriginalPosition(later, 1, 5)).toBeNull();
  });

  it('存在しない行なら null', () => {
    expect(resolveOriginalPosition(map, 99, 1)).toBeNull();
  });
});

describe('resolveOriginalPosition — indexed map (実測と同じ構造)', () => {
  // section の offset ぶんだけ生成行がずれる。**列オフセットは 0 行目にしか効かない**
  const map: RawSourceMap = {
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: { sources: ['file:///p/First.tsx'], mappings: seg(0, 0, 0, 0) },
      },
      {
        offset: { line: 100, column: 40 },
        map: {
          sources: ['file:///p/SampleBrowser.tsx'],
          // 0 行目 (= 生成 101 行目) の列 40+1 から / 1 行目 (= 102 行目) の列 1 から
          mappings: [seg(0, 0, 67, 8), ';', seg(0, 0, 5, 0)].join(''),
        },
      },
    ],
  };

  it('後ろのセクションの行へ正しく解決する', () => {
    expect(resolveOriginalPosition(map, 101, 245)).toEqual({
      source: 'file:///p/SampleBrowser.tsx',
      line: 68,
      column: 9,
    });
  });

  it('セクションの列オフセットは 0 行目にだけ効く', () => {
    // 102 行目は生成列 1 から始まる (offset.column を足さない)。
    // 元の列 9 は差分符号の引き継ぎ (前の区間の 8 に +0)
    expect(resolveOriginalPosition(map, 102, 3)).toEqual({
      source: 'file:///p/SampleBrowser.tsx',
      line: 73,
      column: 9,
    });
    // **列オフセットを 2 行目以降にも足していたら、生成列 3 では解決できない**
    // (足すと区間の開始が 41 になり対象列を超える) — この assert が offset の扱いを固定する
    expect(resolveOriginalPosition(map, 102, 3)?.line).toBe(73);
  });

  it('先頭セクションも引ける (差分符号がセクションを跨いで壊れない)', () => {
    expect(resolveOriginalPosition(map, 1, 1)?.source).toBe('file:///p/First.tsx');
  });
});

describe('toLocalPath — 開けない形は開けると言わない', () => {
  it('file:// はローカル絶対パスにする', () => {
    expect(toLocalPath('file:///Users/me/app/src/App.tsx')).toBe('/Users/me/app/src/App.tsx');
  });

  it('パーセントエンコードを戻す', () => {
    expect(toLocalPath('file:///Users/me/my%20app/A.tsx')).toBe('/Users/me/my app/A.tsx');
  });

  it('絶対パスはそのまま', () => {
    expect(toLocalPath('/Users/me/app/src/App.tsx')).toBe('/Users/me/app/src/App.tsx');
  });

  it('**戻せない仮想パスは null**', () => {
    expect(toLocalPath('webpack://app/./src/App.tsx')).toBeNull();
    expect(toLocalPath('turbopack:///[project]/src/App.tsx')).toBeNull();
    expect(toLocalPath('src/App.tsx')).toBeNull();
  });
});

describe('sourceMapUrlFrom', () => {
  it('相対の sourceMappingURL をスクリプト URL 基準で絶対化する', () => {
    expect(
      sourceMapUrlFrom(
        'http://localhost:3001/_next/static/chunks/_1dffrib._.js',
        '//# sourceMappingURL=_1dffrib._.js.map',
      ),
    ).toBe('http://localhost:3001/_next/static/chunks/_1dffrib._.js.map');
  });

  it('data: URI はそのまま返す (呼び出し側が判別する)', () => {
    const url = sourceMapUrlFrom('http://x/a.js', '//# sourceMappingURL=data:application/json;base64,AAA');
    expect(url?.startsWith('data:')).toBe(true);
  });

  it('無ければ null', () => {
    expect(sourceMapUrlFrom('http://x/a.js', 'console.log(1)')).toBeNull();
  });
});
