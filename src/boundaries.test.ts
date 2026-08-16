import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 境界契約 (framework-agnostic boundary): design 計測経路は「React/Fiber を暗黙前提にした
// モジュール」を import してはならない、を機械強制する。
//
// なぜ: 直近バグ (a7346c5 = 非React サイトで親ナビが Fiber 依存で壊れた) の一般類型は
// 「React 前提の経路が生DOM/production/非MUI で壊れる (特に *誤答* する)」。design 経路が
// Fiber 結合モジュールを import できてしまうと、この類型が構造的に混入し得る。ESLint の
// no-restricted-imports 相当を、依存追加なしで vitest ゲート内に前倒しで固める (二段構えの一段目)。
//
// vitest の cwd はプロジェクトルート。

/** framework 非依存であるべき design 計測経路 (+AI レイヤは決定論データのみ扱う独立層) */
const DESIGN_PATH = [
  'designStyle',
  'cssVars',
  'tokenDict',
  'tokenLint',
  'classify',
  'overlayFormat',
  'designScan',
  'coverage',
  'aiPrompt',
  'aiProviders',
  'aiCost',
  // カバレッジ画面のビューモデル (issue #10)。純ロジックなので同じ契約に入れる。
  // **`scanClient` は入れない** — browser.* を使う拡張ページ専用の配線で、
  // design 計測の純ロジックではない (その旨は当該ファイルのヘッダに明記してある)
  'coverageView',
  'panelState',
];

/** design 経路から import 禁止の Fiber 結合モジュール (source は純パス処理なので除外) */
const FORBIDDEN = ['fiber', 'hook', 'tree', 'treeView', 'renderTracker', 'renderCause', 'renderDebug', 'muiTheme'];

describe('境界契約: design 経路は Fiber 結合モジュールを import しない', () => {
  for (const mod of DESIGN_PATH) {
    it(`${mod}.ts は Fiber 系 (${FORBIDDEN.join('/')}) を import しない`, () => {
      const source = readFileSync(`src/${mod}.ts`, 'utf8');
      // ディレクトリを跨いだ形 ('./render-bundle/tree' 等) も必ず捕まえる。
      // issue #17 で温存実装を src/render-bundle/ へ移したとき、`'./tree'` 決め打ちの
      // 正規表現のままだと**契約が黙って無効化される** (テストは緑のまま素通しになる)。
      const offenders = FORBIDDEN.filter((f) =>
        new RegExp(String.raw`from ['"][^'"]*/${f}['"]`).test(source),
      );
      expect(offenders).toEqual([]);
    });
  }
});

describe('境界契約の反証: パスの形が変わっても検出できる', () => {
  const detects = (source: string) =>
    FORBIDDEN.filter((f) => new RegExp(String.raw`from ['"][^'"]*/${f}['"]`).test(source));

  it('同ディレクトリの import を検出する', () => {
    expect(detects(`import { buildTree } from './tree';`)).toEqual(['tree']);
  });
  it('サブディレクトリへ移した import も検出する', () => {
    expect(detects(`import { buildTree } from './render-bundle/tree';`)).toEqual(['tree']);
    expect(detects(`import type { X } from '../render-bundle/renderTracker';`)).toEqual([
      'renderTracker',
    ]);
  });
  it('名前が前方一致するだけの別モジュールは誤検出しない', () => {
    expect(detects(`import { TreeView } from './treeView';`)).toEqual(['treeView']);
    expect(detects(`import { normalizeSourcePath } from './source';`)).toEqual([]);
  });
});
