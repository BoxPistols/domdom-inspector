import { describe, expect, it } from 'vitest';
import {
  isBundledSource,
  isMuiPath,
  isNodeModulesPath,
  normalizeSourcePath,
  parseStackLocation,
} from './source';

describe('normalizeSourcePath', () => {
  it('dev サーバ URL から pathname を抽出しクエリを除去する', () => {
    expect(normalizeSourcePath('http://localhost:3000/src/App.tsx?t=1719999')).toBe(
      '/src/App.tsx',
    );
  });

  it('Vite の /@fs/ prefix を絶対パスに戻す', () => {
    expect(
      normalizeSourcePath('http://localhost:5173/@fs/Users/me/proj/src/Button.tsx'),
    ).toBe('/Users/me/proj/src/Button.tsx');
  });

  it('webpack-internal スキームを剥がし先頭スラッシュを付ける (./ 有無どちらも)', () => {
    expect(normalizeSourcePath('webpack-internal:///./src/pages/index.tsx')).toBe(
      '/src/pages/index.tsx',
    );
    expect(normalizeSourcePath('webpack-internal:///src/pages/index.tsx')).toBe(
      '/src/pages/index.tsx',
    );
  });

  it('絶対パスはそのまま通す', () => {
    expect(normalizeSourcePath('/Users/me/proj/src/App.tsx')).toBe('/Users/me/proj/src/App.tsx');
  });

  it('パスマッピングを prefix 置換で適用する', () => {
    expect(
      normalizeSourcePath('http://localhost:3000/src/App.tsx', [
        { from: '/src', to: '/Users/me/proj/src' },
      ]),
    ).toBe('/Users/me/proj/src/App.tsx');
  });

  it('ハッシュフラグメントを除去する', () => {
    expect(normalizeSourcePath('http://localhost/src/App.tsx#L10')).toBe('/src/App.tsx');
  });

  it('複数マッピングは最初に一致した prefix だけ適用 (first-match-wins)', () => {
    expect(
      normalizeSourcePath('http://localhost/src/App.tsx', [
        { from: '/src', to: '/a/src' },
        { from: '/src/App.tsx', to: '/should-not-apply' },
      ]),
    ).toBe('/a/src/App.tsx');
  });
});

describe('parseStackLocation', () => {
  it('Chrome 形式のスタックからアプリコードの最初のフレームを返す', () => {
    const stack = [
      'Error',
      '    at createFiberFromElement (http://localhost:3000/node_modules/.vite/deps/react-dom.js?v=abc:100:20)',
      '    at App (http://localhost:3000/src/App.tsx?t=123:12:5)',
      '    at main (http://localhost:3000/src/main.tsx:4:1)',
    ].join('\n');
    expect(parseStackLocation(stack)).toEqual({
      fileName: 'http://localhost:3000/src/App.tsx?t=123',
      lineNumber: 12,
      columnNumber: 5,
    });
  });

  it('Firefox 形式 (name@url:line:col) にも対応する', () => {
    const stack = 'App@http://localhost:3000/src/App.tsx:8:10';
    expect(parseStackLocation(stack)).toMatchObject({ lineNumber: 8, columnNumber: 10 });
  });

  it('アプリコードのフレームが無ければ null', () => {
    const stack =
      '    at x (http://localhost:3000/node_modules/@mui/material/Button/Button.js:5:1)';
    expect(parseStackLocation(stack)).toBeNull();
  });

  it('括弧も @ も無い "at <path>:line:col" 形式を解釈する', () => {
    expect(parseStackLocation('    at /src/App.tsx:10:5')).toEqual({
      fileName: '/src/App.tsx',
      lineNumber: 10,
      columnNumber: 5,
    });
  });
});

describe('path predicates', () => {
  it('node_modules / @mui を判定する', () => {
    expect(isNodeModulesPath('/proj/node_modules/lodash/index.js')).toBe(true);
    expect(isNodeModulesPath('/proj/src/App.tsx')).toBe(false);
    expect(isMuiPath('/proj/node_modules/@mui/material/Button/Button.js')).toBe(true);
    expect(isMuiPath('/proj/node_modules/lodash/index.js')).toBe(false);
  });
});

describe('isBundledSource (バンドル出力の検知 → ジャンプ抑制)', () => {
  it('ハッシュ付きチャンクをバンドル出力と判定する', () => {
    expect(isBundledSource('_31ecaab0._-.js')).toBe(true); // 報告された実例
    expect(isBundledSource('/assets/index-4f2a8b.js')).toBe(true);
    expect(isBundledSource('main.a1b2c3d4.js')).toBe(true);
    expect(isBundledSource('vendor.chunk.js')).toBe(true);
    expect(isBundledSource('app.bundle.js')).toBe(true);
  });

  it('dev サーバの実ソースパスはバンドルでない', () => {
    expect(isBundledSource('/src/components/Box.tsx')).toBe(false);
    expect(isBundledSource('/src/App.jsx')).toBe(false);
    expect(isBundledSource('/Users/me/proj/src/pages/Home.ts')).toBe(false);
    expect(isBundledSource('index.js')).toBe(false); // ハッシュ無しの素の js は許容
  });
});
