/** コンポーネントの 3 分類 (FR-02) */
export type Classification = 'mui' | 'custom' | 'third-party';

/** 解決済みソース位置 */
export interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/** owner チェーンの 1 エントリ */
export interface OwnerEntry {
  name: string;
  classification: Classification;
  source: SourceLocation | null;
}

/** ホバー中の要素について収集した情報 */
export interface InspectInfo {
  name: string;
  /** name がセマンティック名 (owner 由来) の場合、元の内部名 (例: MuiCardContentRoot) */
  internalName: string | null;
  classification: Classification;
  /** 表示用の主要 props (primitive のみ) */
  props: Record<string, string>;
  /** クリックジャンプ先 (MUI スキップ適用後) */
  jumpTarget: SourceLocation | null;
  /** owner チェーン (自身を先頭に、レンダリング元を遡る) */
  ownerChain: OwnerEntry[];
  /** dev ビルドの Fiber から解決できたか (false = セーフモード) */
  devMode: boolean;
}

export interface PathMapping {
  from: string;
  to: string;
}

export interface Settings {
  /** インスペクタ有効/無効の既定 (オリジン単位の制御は Phase 2) */
  editor: 'vscode' | 'cursor' | 'antigravity' | 'webstorm' | 'custom';
  /** editor === 'custom' 時の URL テンプレート ({file} {line} {column}) */
  customUrlTemplate: string;
  /** MUI/サードパーティを飛ばして自作コンポーネントの callsite へジャンプ (FR-09) */
  muiSkip: boolean;
  colors: {
    mui: string;
    custom: string;
    thirdParty: string;
  };
  /** ビルド時パス → ローカル絶対パスの書き換え */
  pathMappings: PathMapping[];
}

export const DEFAULT_SETTINGS: Settings = {
  editor: 'vscode',
  customUrlTemplate: 'vscode://file{file}:{line}:{column}',
  muiSkip: true,
  colors: {
    mui: '#2196f3',
    custom: '#4caf50',
    thirdParty: '#9e9e9e',
  },
  pathMappings: [],
};

/**
 * MAIN world (inspector / overlay / renderDebug) が表示する UI 文字列。
 * MAIN world は拡張 API (browser.i18n) を使えないため、bridge (ISOLATED) が
 * browser.i18n で解決して postMessage で流し込む。既定は英語 (default_locale=en)。
 * statsTitle の {n} は表示時に commit 数へ置換する。
 */
export interface UiStrings {
  inspectOn: string;
  inspectOnSafe: string;
  inspectOff: string;
  noOuterComponent: string;
  jumpUnresolved: string;
  jumpProd: string;
  sourceUnavailable: string;
  prodSafeMode: string;
  ownerPanelTitle: string;
  renderOn: string;
  renderOnNoDev: string;
  renderOff: string;
  recordStart: string;
  statsTitle: string;
  statsColsSupported: string;
  statsColsUnsupported: string;
  statsEmpty: string;
}

export const DEFAULT_STRINGS: UiStrings = {
  inspectOn: 'Inspect ON — Click: editor / Alt+Click: owner tree / ↑↓: parent/child / Esc: exit',
  inspectOnSafe: 'Inspect ON — no dev build detected, safe mode (names only / Esc to exit)',
  inspectOff: 'Inspect OFF',
  noOuterComponent: 'No further outer component',
  jumpUnresolved: 'Could not resolve source location (React 19 may need the Babel source plugin)',
  jumpProd: 'Source jump is unavailable on production builds',
  sourceUnavailable: 'source unavailable',
  prodSafeMode: 'production build (safe mode)',
  ownerPanelTitle: 'Rendered by (click to open editor)',
  renderOn:
    'Render viz ON — re-rendered elements flash (blue→red = more frequent) / R: record / toggle again to exit',
  renderOnNoDev: 'Render viz ON — no dev build detected, timing unavailable (flash only)',
  renderOff: 'Render viz OFF',
  recordStart: 'Recording — interact to trigger re-renders, press R to stop and see the ranking',
  statsTitle: 'Re-render ranking ({n} commits)',
  statsColsSupported: 'Columns: component / re-renders / cumulative self time (ms)',
  statsColsUnsupported: 'Profiler timer unavailable here; time shows 0 (needs a dev build)',
  statsEmpty: 'No re-renders were recorded',
};

/** page (MAIN world) と bridge (ISOLATED) 間の postMessage 識別子 */
export const BRIDGE_SOURCE = 'mui-inspector-bridge';
export const PAGE_SOURCE = 'mui-inspector-page';
