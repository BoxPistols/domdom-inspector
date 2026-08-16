import { describe, expect, it } from 'vitest';
import { authoredFrames, parseStackFrames, pickAuthoredFrame, stackStringOf } from './ownerStack';

/**
 * 標本は**実測そのもの** (2026-08-16, Next.js 16 + Turbopack + React 19)。
 * この形で `<img>` の位置が取れることを確認した上で固定する。
 */
const REAL_STACK = [
  'Error: react-stack-top-frame',
  '    at exports.jsxDEV (http://localhost:3001/_next/static/chunks/_0ro62as._.js:641:33)',
  '    at http://localhost:3001/_next/static/chunks/_1dffrib._.js:1921:245',
  '    at Array.map (<anonymous>)',
  '    at SampleBrowser (http://localhost:3001/_next/static/chunks/_1dffrib._.js:1908:32)',
  '    at Object.react_stack_bottom_frame (http://localhost:3001/_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js:14894:24)',
].join('\n');

describe('parseStackFrames — 実測のスタック', () => {
  it('React 内部と位置なしの行を落とす', () => {
    const frames = parseStackFrames(REAL_STACK);
    expect(frames.map((f) => `${f.line}:${f.column}`)).toEqual(['1921:245', '1908:32']);
  });

  it('**jsxDEV を落とす** (落とさないと React の内部を開く)', () => {
    expect(parseStackFrames(REAL_STACK).some((f) => f.url.includes('_0ro62as'))).toBe(false);
  });

  it('**react-dom のフレームを落とす**', () => {
    expect(
      parseStackFrames(REAL_STACK).some((f) => f.url.includes('react-dom')),
      'react-dom を開いてはいけない',
    ).toBe(false);
  });

  it('関数名が取れるものは名前も持つ', () => {
    const named = parseStackFrames(REAL_STACK).find((f) => f.name);
    expect(named?.name).toBe('SampleBrowser');
  });

  it('`Array.map (<anonymous>)` のような位置なし行は捨てる', () => {
    expect(parseStackFrames(REAL_STACK).some((f) => f.url.includes('anonymous'))).toBe(false);
  });
});

describe('pickAuthoredFrame — その要素の JSX が書かれた場所', () => {
  it('内部を除いた先頭 = 対象要素の JSX 呼び出しを選ぶ', () => {
    // 実測では 1921:245 → SampleBrowser.tsx:68 (= 対象の <img> の行)
    expect(pickAuthoredFrame(REAL_STACK)).toEqual({
      url: 'http://localhost:3001/_next/static/chunks/_1dffrib._.js',
      line: 1921,
      column: 245,
      name: null,
    });
  });

  it('**親コンポーネント本体を選ばない** (1 段浅い場所を開くと「そこじゃない」になる)', () => {
    expect(pickAuthoredFrame(REAL_STACK)?.line).not.toBe(1908);
  });

  it('内部フレームしか無ければ null (誤った場所を開かない)', () => {
    const onlyInternal = [
      'Error: x',
      '    at exports.jsxDEV (http://x/_next/static/chunks/react-dom.js:1:1)',
      '    at Array.map (<anonymous>)',
    ].join('\n');
    expect(pickAuthoredFrame(onlyInternal)).toBeNull();
  });

  it('空文字でも壊れない', () => {
    expect(pickAuthoredFrame('')).toBeNull();
  });
});

describe('parseStackFrames — 別の形も受ける', () => {
  it('Firefox 形式 (name@url:line:col) は対象外だが落ちない', () => {
    expect(() => parseStackFrames('SampleBrowser@http://x/a.js:10:2')).not.toThrow();
  });

  it('絶対パス形式のフレームも拾う (dev サーバが素のパスを出す構成)', () => {
    const frames = parseStackFrames('    at Foo (/Users/me/app/src/App.tsx:12:3)');
    expect(frames[0]).toEqual({ url: '/Users/me/app/src/App.tsx', line: 12, column: 3, name: 'Foo' });
  });
});

describe('stackStringOf — Error でも文字列でも受ける', () => {
  it('Error から stack を取る', () => {
    const err = new Error('x');
    expect(stackStringOf(err)).toBe(err.stack);
  });

  it('文字列はそのまま', () => {
    expect(stackStringOf('at a (http://x/a.js:1:1)')).toBe('at a (http://x/a.js:1:1)');
  });

  it('それ以外は null', () => {
    expect(stackStringOf(null)).toBeNull();
    expect(stackStringOf(undefined)).toBeNull();
    expect(stackStringOf({})).toBeNull();
    expect(stackStringOf(42)).toBeNull();
  });
});

/**
 * **Owner Stack が「不明な所有者」の共有スタックになる場合がある** (2026-08-17 の実機報告)。
 *
 * React は実際の捕捉を先頭 1 万要素までに制限し、超えると React 内部で作った共有の
 * スタックを使う (`react-jsx-dev-runtime` の `UnknownOwner`)。これを利用者のコードだと
 * 誤認すると、source map で戻したときに **React の実装ファイルが開く**。
 */
const UNKNOWN_OWNER_STACK = [
  'Error: react-stack-top-frame',
  '    at UnknownOwner (http://localhost:3001/_next/static/chunks/_0ro62as._.js:6210:20)',
  '    at Object.react_stack_bottom_frame (http://localhost:3001/_next/static/chunks/_0ro62as._.js:6199:9)',
].join('\n');

describe('不明な所有者の共有スタックを利用者のコードとして扱わない', () => {
  it('UnknownOwner のフレームを落とす', () => {
    expect(parseStackFrames(UNKNOWN_OWNER_STACK).some((f) => f.name === 'UnknownOwner')).toBe(false);
  });

  it('残るフレームが無ければ null (React の内部を開かない)', () => {
    expect(pickAuthoredFrame(UNKNOWN_OWNER_STACK)).toBeNull();
  });
});

describe('authoredFrames — 候補を順に返す', () => {
  it('先頭が最有力、以降が控え (1 つ目が外れたら次を試せる)', () => {
    const frames = authoredFrames(REAL_STACK);
    expect(frames.map((f) => f.line)).toEqual([1921, 1908]);
  });

  it('上限で切る (病的に長い stack で走査が伸びない)', () => {
    const long = ['Error: x']
      .concat(Array.from({ length: 30 }, (_, i) => `    at f${i} (http://x/a.js:${i + 1}:1)`))
      .join('\n');
    expect(authoredFrames(long, 4)).toHaveLength(4);
  });
});
