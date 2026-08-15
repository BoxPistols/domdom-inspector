import { describe, expect, it } from 'vitest';
import { extractRootCandidates, mappingLine, rootOf } from './sourceRoots';

// 実測した本物のスタック (localhost:3000 / Vite + React 19 / dev-album)。
// 作り物ではなく実機から取ったものを固定する — ここが現実とズレると、
// 存在しないパスを「候補」として勧めることになる
const REAL_STACK = `Error: react-stack-top-frame
    at exports.jsxDEV (http://localhost:3000/@fs/Users/ai/dev/writing/dev-album/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=6e4a7bd0:246:30)
    at Navigation (http://localhost:3000/src/components/Navigation.tsx?t=1786807702679:248:35)
    at Object.react_stack_bottom_frame (http://localhost:3000/@fs/Users/ai/dev/writing/dev-album/node_modules/.vite/deps/chunk-W3OFGNWF.js?v=6e4a7bd0:18241:20)`;

describe('rootOf', () => {
  it('node_modules より手前で切る', () => {
    expect(rootOf('/Users/me/proj/node_modules/.vite/deps/react.js')).toBe('/Users/me/proj');
  });

  it('ビルド出力ディレクトリでも切る', () => {
    expect(rootOf('/Users/me/proj/.next/static/chunks/x.js')).toBe('/Users/me/proj');
    expect(rootOf('/Users/me/proj/dist/assets/index.js')).toBe('/Users/me/proj');
  });

  it('ファイルを指していたら親ディレクトリにする', () => {
    expect(rootOf('/Users/me/proj/src/App.tsx')).toBe('/Users/me/proj/src');
  });

  it('プロジェクトになりえない場所は候補にしない', () => {
    expect(rootOf('/usr/local/lib/node.js')).toBeNull();
    expect(rootOf('/System/Library/x.js')).toBeNull();
    expect(rootOf('/private/var/folders/ab/T/x.js')).toBeNull();
    expect(rootOf('relative/path.js')).toBeNull();
  });
});

describe('extractRootCandidates', () => {
  it('実機のスタックからリポジトリのルートを取り出す', () => {
    expect(extractRootCandidates([REAL_STACK])).toEqual(['/Users/ai/dev/writing/dev-album']);
  });

  it('出現回数の多い候補を先に出す', () => {
    const sources = [
      '/@fs/Users/me/a/node_modules/x.js',
      '/@fs/Users/me/b/node_modules/y.js',
      '/@fs/Users/me/b/node_modules/z.js',
    ];
    expect(extractRootCandidates(sources)[0]).toBe('/Users/me/b');
  });

  it('手がかりが無ければ空 (でっち上げない)', () => {
    expect(extractRootCandidates(['http://localhost:3000/src/App.tsx?t=1'])).toEqual([]);
    expect(extractRootCandidates([''])).toEqual([]);
  });

  it('Next のチャンク URL からは何も出ない (絶対パスが漏れていないため)', () => {
    // これが「Next では候補が出せない」ことの根拠。出せないことを明示的に固定する
    expect(
      extractRootCandidates(['http://localhost:3001/_next/static/chunks/_0wzpx8i._.js:1:1']),
    ).toEqual([]);
  });

  it('file:// 形式の絶対パスも拾う', () => {
    expect(extractRootCandidates(['at Foo (file:///Users/me/proj/src/App.tsx:3:1)'])).toEqual([
      '/Users/me/proj/src',
    ]);
  });
});

describe('mappingLine', () => {
  it('そのまま貼れる 1 行を作る', () => {
    expect(mappingLine('/src/components/Navigation.tsx', '/Users/me/proj', 'localhost:3000')).toBe(
      '/src=/Users/me/proj/src @ localhost:3000',
    );
  });
  it('末尾スラッシュを重ねない', () => {
    expect(mappingLine('/views/index.ejs', '/Users/me/proj/')).toBe('/views=/Users/me/proj/views');
  });
});
