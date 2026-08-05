import { describe, expect, it } from 'vitest';
import { buildEditorUrl, formatSourceRef } from './editor';
import { DEFAULT_SETTINGS, type Settings } from './types';

const loc = {
  fileName: 'http://localhost:3000/src/App.tsx?t=1',
  lineNumber: 12,
  columnNumber: 5,
};

// 既定エディタ (DEFAULT_SETTINGS.editor) は Cursor のため、vscode 固有の検証は明示指定する
const vscode: Settings = { ...DEFAULT_SETTINGS, editor: 'vscode' };

describe('buildEditorUrl', () => {
  it('vscode スキームを生成する (パス正規化込み)', () => {
    expect(buildEditorUrl(vscode, loc)).toBe('vscode://file/src/App.tsx:12:5');
  });

  it('既定エディタ (Cursor) のスキームを生成する', () => {
    expect(buildEditorUrl(DEFAULT_SETTINGS, loc)).toBe('cursor://file/src/App.tsx:12:5');
  });

  it('パスマッピング適用後の絶対パスでリンクする', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      editor: 'cursor',
      pathMappings: [{ from: '/src', to: '/Users/me/proj/src' }],
    };
    expect(buildEditorUrl(settings, loc)).toBe(
      'cursor://file/Users/me/proj/src/App.tsx:12:5',
    );
  });

  it('Antigravity IDE のスキーム (antigravity-ide://) を生成する', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, editor: 'antigravity' };
    expect(buildEditorUrl(settings, loc)).toBe('antigravity-ide://file/src/App.tsx:12:5');
  });

  it('カスタムテンプレートのプレースホルダを置換する', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      editor: 'custom',
      customUrlTemplate: 'myeditor://open?f={file}&l={line}&c={column}',
    };
    expect(buildEditorUrl(settings, loc)).toBe('myeditor://open?f=/src/App.tsx&l=12&c=5');
  });

  it('column 0 は 1 にフォールバックする', () => {
    expect(
      buildEditorUrl(vscode, { ...loc, columnNumber: 0 }),
    ).toBe('vscode://file/src/App.tsx:12:1');
  });

  it('webstorm テンプレートは {column} を持たず line までで生成する', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, editor: 'webstorm' };
    expect(buildEditorUrl(settings, loc)).toBe('webstorm://open?file=/src/App.tsx&line=12');
  });

  it('webpack-internal ソースも先頭スラッシュ 1 個に正規化してリンクする', () => {
    expect(
      buildEditorUrl(vscode, {
        fileName: 'webpack-internal:///./src/App.tsx',
        lineNumber: 3,
        columnNumber: 2,
      }),
    ).toBe('vscode://file/src/App.tsx:3:2');
  });
});

describe('formatSourceRef (エディタが開かなかったときに渡す場所)', () => {
  it('パス:行 の形にする', () => {
    expect(
      formatSourceRef(DEFAULT_SETTINGS, {
        fileName: 'http://localhost:5173/src/App.tsx',
        lineNumber: 42,
        columnNumber: 7,
      }),
    ).toBe('/src/App.tsx:42');
  });

  it('パスマッピングを適用する (手元のディスク上のパスを渡せるように)', () => {
    expect(
      formatSourceRef(
        { ...DEFAULT_SETTINGS, pathMappings: [{ from: '/src', to: '/Users/me/app/src' }] },
        { fileName: '/src/App.tsx', lineNumber: 3, columnNumber: 1 },
      ),
    ).toBe('/Users/me/app/src/App.tsx:3');
  });

  it('webpack-internal スキームも実パスに直す', () => {
    expect(
      formatSourceRef(DEFAULT_SETTINGS, {
        fileName: 'webpack-internal:///./src/components/Card.tsx',
        lineNumber: 10,
        columnNumber: 2,
      }),
    ).toBe('/src/components/Card.tsx:10');
  });
});
