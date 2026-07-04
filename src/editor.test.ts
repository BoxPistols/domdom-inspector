import { describe, expect, it } from 'vitest';
import { buildEditorUrl } from './editor';
import { DEFAULT_SETTINGS, type Settings } from './types';

const loc = {
  fileName: 'http://localhost:3000/src/App.tsx?t=1',
  lineNumber: 12,
  columnNumber: 5,
};

describe('buildEditorUrl', () => {
  it('vscode スキームを生成する (パス正規化込み)', () => {
    expect(buildEditorUrl(DEFAULT_SETTINGS, loc)).toBe('vscode://file/src/App.tsx:12:5');
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
      buildEditorUrl(DEFAULT_SETTINGS, { ...loc, columnNumber: 0 }),
    ).toBe('vscode://file/src/App.tsx:12:1');
  });

  it('webstorm テンプレートは {column} を持たず line までで生成する', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, editor: 'webstorm' };
    expect(buildEditorUrl(settings, loc)).toBe('webstorm://open?file=/src/App.tsx&line=12');
  });

  it('webpack-internal ソースも先頭スラッシュ 1 個に正規化してリンクする', () => {
    expect(
      buildEditorUrl(DEFAULT_SETTINGS, {
        fileName: 'webpack-internal:///./src/App.tsx',
        lineNumber: 3,
        columnNumber: 2,
      }),
    ).toBe('vscode://file/src/App.tsx:3:2');
  });
});
