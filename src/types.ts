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
  editor: 'vscode' | 'cursor' | 'webstorm' | 'custom';
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

/** page (MAIN world) と bridge (ISOLATED) 間の postMessage 識別子 */
export const BRIDGE_SOURCE = 'mui-inspector-bridge';
export const PAGE_SOURCE = 'mui-inspector-page';
