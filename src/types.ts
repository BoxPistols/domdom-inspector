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

/** computed style から抽出したデザインプロパティ (production でも取得可) */
export interface DesignProp {
  label: string;
  value: string;
  /** 実装で宣言された CSS 変数名 (var(--x) の --x)。トークン準拠検証の主表示 (cssVars Tier1) */
  varName?: string;
  /** varName が複数候補 (shorthand で side 別変数等) の全件 */
  varNames?: string[];
  /** 変数が単一に絞れない (padding: var(--a) var(--b) 等) */
  ambiguous?: boolean;
  /**
   * 値の来歴 (cssVars.ValueOrigin)。'var' = 変数経由 / 'literal' = この要素でのベタ書き /
   * 'inherited' = 継承値・UA 既定 / 'unknown' = CSSOM を読めず判定不能。
   * トークン一致 (今の正しさ) とは直交する軸で、ハードコード検出の主材料。
   * バッジ表示では使わないため省略可 (ページ全体スキャン時のみ付与)。
   */
  origin?: 'var' | 'literal' | 'inherited' | 'unknown';
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
  /** React 要素か (false = 非 React の素の DOM。design のみ表示) */
  isReact: boolean;
  /** computed style 由来のデザインプロパティ (production/デザイナー向け、常に取得可) */
  design: DesignProp[];
}

export interface PathMapping {
  from: string;
  to: string;
}

export interface Settings {
  /**
   * 職域モード: popup の情報設計を切り替える (デザイナー = デザイン検査中心 /
   * エンジニア = レンダー計測・エディタ連携を含む全機能)。機能自体は消さず表示を最適化する。
   */
  role: 'designer' | 'engineer';
  /** インスペクタ有効/無効の既定 (オリジン単位の制御は Phase 2) */
  editor: 'vscode' | 'cursor' | 'antigravity' | 'webstorm' | 'custom';
  /** editor === 'custom' 時の URL テンプレート ({file} {line} {column}) */
  customUrlTemplate: string;
  /** MUI/サードパーティを飛ばして自作コンポーネントの callsite へジャンプ (FR-09) */
  muiSkip: boolean;
  /**
   * クリックでエディタを開くか。false ならクリックしてもエディタ連携せず、
   * ハイライト/ホバー確認だけ行う (Alt+クリックの描画元ツリーは維持)。
   */
  openEditorOnClick: boolean;
  /**
   * バッジの情報量。compact=名前+場所のみ / normal=+内部名・主要props /
   * detailed=全props を複数行で。file:line は常に独立行で表示し省略しない。
   */
  badgeDetail: 'compact' | 'normal' | 'detailed';
  /**
   * デザイン値を「宣言された CSS 変数名優先」で表示するか (既定 true)。
   * ミッション = トークン準拠検証のため、var(--x) 宣言があれば変数名を主・生値を従で出す。
   * false にすると常に生値 (#hex/px) を主表示する。
   */
  showVarNames: boolean;
  colors: {
    mui: string;
    custom: string;
    thirdParty: string;
  };
  /** ビルド時パス → ローカル絶対パスの書き換え */
  pathMappings: PathMapping[];
  /**
   * レンダー可視化モード中の「記録トグル」キー (ページ内、単一キー)。
   * モード切替 (Alt+Shift+I / Alt+Shift+R) は manifest commands 側で
   * chrome://extensions/shortcuts から任意再設定できるため、ここには含めない。
   */
  recordKey: string;
  /**
   * MUI テーマ自動取得 (FR-14)。ThemeProvider の context からテーマトークンを抽出し、
   * 手動貼り付けトークンと併合して照合に使う (手動優先)。false で抽出・併合を停止。
   */
  autoTheme: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  role: 'engineer',
  editor: 'cursor',
  customUrlTemplate: 'vscode://file{file}:{line}:{column}',
  muiSkip: true,
  openEditorOnClick: true,
  badgeDetail: 'normal',
  showVarNames: true,
  // 白ページ上のハイライト枠が SC 1.4.11 (非テキスト 3:1) を満たす明度にする
  // (旧: #2196f3/#4caf50/#9e9e9e は緑 2.78:1 / グレー 2.68:1 で未達だった)。
  // 検算は overlayContrast.test.ts — 値を変えるならテストが機械で弾く
  colors: {
    mui: '#1976d2',
    custom: '#2e7d32',
    thirdParty: '#616161',
  },
  pathMappings: [],
  recordKey: 'r',
  autoTheme: true,
};

/**
 * MAIN world (inspector / overlay / renderDebug) が表示する UI 文字列。
 * MAIN world は拡張 API (browser.i18n) を使えないため、bridge (ISOLATED) が
 * browser.i18n で解決して postMessage で流し込む。既定は英語 (default_locale=en)。
 * statsTitle の {n} は表示時に commit 数へ置換する。
 */
export interface UiStrings {
  inspectOn: string;
  /** React の production ビルドを検出したとき (名前とソースが取れない) */
  inspectOnSafe: string;
  /** React がそもそも無いページ (素の HTML / 他フレームワーク)。**production と混同しない** */
  inspectOnNoReact: string;
  inspectOff: string;
  noOuterComponent: string;
  jumpUnresolved: string;
  jumpProd: string;
  sourceUnavailable: string;
  prodSafeMode: string;
  /** バンドル出力パス (ハッシュ付きチャンク) でジャンプ不可な時の注記 */
  sourceMinified: string;
  /** file:line 行に添える「エディタで開く」操作ヒント */
  editorHint: string;
  /** エディタへ送った直後の通知。{file} = パス:行。**成功は主張しない** (成否が取れないため) */
  editorOpening: string;
  /** 猶予時間内に何も起きなかったとき。エディタ未インストール / scheme 未登録の可能性 */
  editorNotOpened: string;
  /** フォールバックのコピーボタン */
  editorCopyPath: string;
  editorPathCopied: string;
  ownerPanelTitle: string;
  /** 描画元リストが空 (素の DOM / production ビルド) のときの説明 */
  chainEmpty: string;
  /** 素の DOM 要素にソースジャンプを試みたときの説明 (React でないので原理的に無い) */
  noSourceDom: string;
  renderOn: string;
  renderOnNoDev: string;
  renderOff: string;
  recordStart: string;
  ctrlTitle: string;
  ctrlRecord: string;
  ctrlStop: string;
  ctrlRecording: string;
  /** インスペクトモード中の常設ピル (マウスだけで終了できる導線) */
  inspectPill: string;
  inspectPillClose: string;
  treeOn: string;
  treeOnSafe: string;
  /** production ビルドで名前が minify されツリーが判読不能なときの説明 */
  treeUnavailableProd: string;
  treeOff: string;
  treeTitle: string;
  statsTitle: string;
  statsColsSupported: string;
  statsColsUnsupported: string;
  statsEmpty: string;
  /** 記録サマリ行。{renders}=総レンダー数 / {wasted}=無駄レンダー数 / {ms}=自己時間合計 */
  statsSummary: string;
  /** 無駄レンダー (parent 巻き込まれ) の説明行 */
  statsWastedHint: string;
  /** 列ヘッダ */
  statsColComponent: string;
  statsColRenders: string;
  statsColWasted: string;
  statsColMs: string;
  /** AI レポートコピー */
  statsCopy: string;
  statsCopied: string;
  statsCopyFail: string;
  /** Web Vitals ブロック */
  vitalsTitle: string;
  vitalsLongTasks: string;
  /** 再レンダー原因ラベル (行ツールチップ用) */
  causeState: string;
  causeProps: string;
  causeParent: string;
  causeMount: string;
  causeOther: string;
  /** 行ツールチップの補助 (直近変化)。{list} = キー/インデックス一覧 */
  changedPropsHint: string;
  changedHooksHint: string;
  /** パネル共通の閉じるボタン (aria-label / title) */
  panelClose: string;
  /** デザインチップの表示名 (DesignProp.label は内部 id のまま、表示層でここに解決) */
  dsColor: string;
  dsBg: string;
  dsFont: string;
  dsWeight: string;
  dsLineHeight: string;
  dsPadding: string;
  dsMargin: string;
  dsRadius: string;
  dsShadow: string;
  dsGap: string;
  /** 野良値警告。{label}=表示名 / {values}=グリッド外 px 値 / {grid}=グリッド幅 px */
  offGridWarn: string;
  /** デザイントークン照合 (Figma)。miss 時のチップ注釈。{name}=最近傍トークン名 */
  tokenNear: string;
  tokenNone: string;
  /** MUI テーマ自動取得 (FR-14) 成功時のトースト。{colors}/{sizes} = 抽出件数 */
  themeTokensLoaded: string;
}

export const DEFAULT_STRINGS: UiStrings = {
  // 案内する操作は実装と 1 対 1 で対応させる。以前は「Click: editor」(実際は ⌘/Ctrl 必須) と
  // 「Alt+Click: rendered-by tree」(ハンドラ不在) を案内しており、画面の指示どおり操作しても
  // 無反応になっていた (Alt+Click は preventDefault されるためページ本来の動作も潰れていた)
  inspectOn: 'Inspect ON — hover to inspect, Esc to exit. ⌘/Ctrl+Click: open in editor / Alt+Click: what rendered this / ↑↓: parent/child',
  // 「名前のみ」は嘘だった: production でもデザイン値・CSS 変数名・トークン照合・野良値警告は
  // すべて出る。出ないのは「自作コンポーネント名」と「ソースジャンプ」だけ
  inspectOnSafe:
    'Inspect ON — React production build: no component names or source jump, but design values and token matching work. Esc to exit',
  // 素の HTML ページで「本番ビルドだから出ない」と説明していたのは嘘だった (React が無い)
  inspectOnNoReact:
    'Inspect ON — no React on this page. Design values, CSS variable names and grid checks work. Esc to exit',
  inspectOff: 'Inspect OFF',
  noOuterComponent: 'No further outer element',
  jumpUnresolved: 'Could not resolve source location (React 19 may need the Babel source plugin)',
  jumpProd: 'Source jump is unavailable on production builds',
  sourceUnavailable: 'source unavailable',
  prodSafeMode: 'production build (safe mode)',
  sourceMinified: 'bundled output · run a dev build to jump',
  editorHint: '⌘/Ctrl+Click to open in editor',
  editorOpening: 'Sent to your editor: {file}',
  editorNotOpened:
    'Nothing opened — your editor may not be installed, or its URL scheme is not registered.',
  editorCopyPath: 'Copy path',
  editorPathCopied: 'Path copied',
  ownerPanelTitle: 'Rendered by (click to open editor)',
  chainEmpty: 'Nothing to show — this element has no React owner (plain DOM, or a production build with names stripped).',
  noSourceDom: 'This element is not a React component, so it has no source file to open.',
  renderOn:
    'Render viz ON — re-rendered elements flash (blue→red = more frequent) / R: record / toggle again to exit',
  renderOnNoDev: 'Render viz ON — no dev build detected, timing unavailable (flash only)',
  renderOff: 'Render viz OFF',
  recordStart: 'Recording — interact to trigger re-renders, press R to stop and see the ranking',
  ctrlTitle: 'Render viz',
  ctrlRecord: 'Record',
  ctrlStop: 'Stop',
  ctrlRecording: 'REC',
  inspectPill: 'Inspecting — Esc to exit',
  inspectPillClose: 'Exit inspect mode',
  treeOn: 'Component tree ON — hover a row to highlight, hover the page to locate it. Esc to close',
  treeOnSafe: 'Component tree ON — no dev build detected, names are estimated',
  treeUnavailableProd:
    'Component tree needs a development build — this page is a production build, where React strips component names. Design measurement and token matching still work.',
  treeOff: 'Component tree OFF',
  treeTitle: 'Component tree',
  statsTitle: 'Re-render ranking ({n} screen updates)',
  statsColsSupported: 'Hover a row for why it re-rendered (state / props / parent)',
  statsColsUnsupported: 'Production build: render counts and causes are exact, timings need a dev build',
  statsEmpty: 'No re-renders were recorded',
  statsSummary: '{renders} renders · {wasted} wasted · {ms}ms self time',
  statsWastedHint: 'wasted = re-rendered by a parent with identical props → React.memo candidate',
  statsColComponent: 'component',
  statsColRenders: 'renders',
  statsColWasted: 'wasted',
  statsColMs: 'self ms',
  statsCopy: 'Copy AI report',
  statsCopied: 'Report copied — paste it into your AI assistant to start the analysis',
  statsCopyFail: 'Copy failed — clipboard is unavailable on this page',
  vitalsTitle: 'Page vitals',
  vitalsLongTasks: 'long tasks',
  causeState: 'own state (useState/useReducer)',
  causeProps: 'props changed',
  causeParent: 'parent re-render (wasted)',
  causeMount: 'mount',
  causeOther: 'context/other',
  changedPropsHint: 'last changed props: {list}',
  changedHooksHint: 'last changed hooks: {list}',
  panelClose: 'Close',
  dsColor: 'text color',
  dsBg: 'background',
  dsFont: 'font size',
  dsWeight: 'weight',
  dsLineHeight: 'line height',
  dsPadding: 'padding',
  dsMargin: 'margin',
  dsRadius: 'radius',
  dsShadow: 'shadow',
  dsGap: 'gap',
  offGridWarn: '{label} {values}px (not on the {grid}px grid)',
  tokenNear: '≠ token · near {name}',
  tokenNone: '≠ token',
  themeTokensLoaded: 'MUI theme detected — color tokens: {colors} / size tokens: {sizes}',
};

/** page (MAIN world) と bridge (ISOLATED) 間の postMessage 識別子 */
export const BRIDGE_SOURCE = 'domdom-inspector-bridge';
export const PAGE_SOURCE = 'domdom-inspector-page';
