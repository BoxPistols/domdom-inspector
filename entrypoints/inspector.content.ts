import { scanDesign } from '../src/designScan';
import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { findMuiTheme, findMuiThemeFromDom } from '../src/muiTheme';
import { Overlay } from '../src/overlay';
import { RenderDebugger } from '../src/renderDebug';
import { TreeView } from '../src/treeView';
import { DEV_MATCHES } from '../src/matches';
import {
  EMPTY_TOKEN_DICT,
  mergeTokenDicts,
  parseMuiTheme,
  type TokenDict,
} from '../src/tokenDict';
import { BRIDGE_SOURCE, DEFAULT_SETTINGS, DEFAULT_STRINGS, PAGE_SOURCE } from '../src/types';
import { VitalsCollector } from '../src/vitals';

/**
 * MAIN world / document_start: React 読み込み前に DevTools フックを確立し、
 * ブリッジ (ISOLATED) からの設定・トグル指示を受けてインスペクタを駆動する。
 */
export default defineContentScript({
  matches: DEV_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  // FR-13 PoC: プレビュー等の子フレーム (srcdoc/blob/data 含む) にも注入する。
  // matchOriginAsFallback は生成元 origin でマッチ判定するため、非 opaque な
  // blob/srcdoc iframe を拾える (sandbox の opaque origin は対象外)。
  allFrames: true,
  matchOriginAsFallback: true,
  main() {
    // executeScript による即時注入と、登録済みスクリプトの二重実行を防ぐガード
    const w = window as unknown as { __DOMDOM_INSPECTOR_LOADED__?: boolean };
    if (w.__DOMDOM_INSPECTOR_LOADED__) return;
    w.__DOMDOM_INSPECTOR_LOADED__ = true;

    const hookState = installHook();
    // strings は 1 つの共有オブジェクト。bridge からの 'i18n' で in-place 更新すると
    // 参照を持つ全コンポーネントに反映される (英語を既定値として先に動作する)。
    const strings = { ...DEFAULT_STRINGS };
    const overlay = new Overlay(DEFAULT_SETTINGS, strings);
    const inspector = new Inspector(hookState, overlay, strings);
    // Page vitals は document_start から常時観測 (buffered observer で初期エントリも遡取)。
    // 観測のみで DOM/描画には触れず、レポート生成時に snapshot を読む。
    const vitals = new VitalsCollector();
    vitals.start();
    const renderDebugger = new RenderDebugger(hookState, overlay, strings, vitals);
    const treeView = new TreeView(hookState, overlay, strings);

    // MUI テーマ自動取得 (FR-14 / issue #8): 手動貼り付け (pasted) とテーマ由来 (theme) の
    // 2 辞書を持ち、併合して overlay に配る (手動優先)。テーマは commit 後に throttle 付きで
    // 探し、参照が変わったとき (テーマ切替等) だけ再変換してトーストで知らせる。
    let pastedTokens: TokenDict = EMPTY_TOKEN_DICT;
    let themeTokens: TokenDict = EMPTY_TOKEN_DICT;
    let autoTheme = DEFAULT_SETTINGS.autoTheme;
    let lastTheme: unknown = null;
    let themeAttemptAt = 0;
    const currentTokens = () =>
      mergeTokenDicts(pastedTokens, autoTheme ? themeTokens : EMPTY_TOKEN_DICT);
    const pushMergedTokens = () => {
      overlay.updateTokens(currentTokens());
    };
    const attemptThemeExtract = () => {
      if (!autoTheme) return;
      const now = Date.now();
      if (now - themeAttemptAt < 2000) return;
      themeAttemptAt = now;
      const theme = findMuiTheme(hookState.roots) ?? findMuiThemeFromDom();
      if (!theme || theme === lastTheme) return;
      lastTheme = theme;
      const dict = parseMuiTheme(theme);
      if (!dict.colors.length && !dict.sizes.length) return;
      themeTokens = dict;
      pushMergedTokens();
      overlay.toast(
        strings.themeTokensLoaded
          .replace('{colors}', String(dict.colors.length))
          .replace('{sizes}', String(dict.sizes.length)),
      );
    };
    hookState.onCommit(() => attemptThemeExtract());
    // mid-page 注入 (production の「現在のサイトで有効化」) では commit が来ないことが
    // あるため、注入直後にも一度 DOM 経由で試す
    setTimeout(attemptThemeExtract, 1000);

    // Esc は中央で所有し、インスペクタ (パネル > モード) → レンダー可視化 → ツリーの順に
    // 1 度で 1 つだけ閉じる。複数モード同時 ON でも競合しない。
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        if (inspector.onEscape() || renderDebugger.onEscape() || treeView.onEscape()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') {
        inspector.applySettings(data.payload);
        overlay.updateSettings(data.payload);
        renderDebugger.applySettings(data.payload.recordKey);
        treeView.applySettings(data.payload);
        autoTheme = data.payload.autoTheme !== false;
        pushMergedTokens();
        attemptThemeExtract();
      }
      if (data.type === 'i18n' && data.payload) Object.assign(strings, data.payload);
      if (data.type === 'tokens') {
        // payload の shape を検証 (同一 window の任意ページからの postMessage を素通しにしない)。
        // colors/sizes 配列を欠く不正 payload は EMPTY にフォールバックしバッジ描画を守る。
        const p = data.payload;
        pastedTokens =
          p && Array.isArray(p.colors) && Array.isArray(p.sizes) ? p : EMPTY_TOKEN_DICT;
        pushMergedTokens();
      }
      if (data.type === 'toggle') inspector.toggle();
      if (data.type === 'inspect-on') {
        inspector.enableOnly();
        attemptThemeExtract();
      }
      if (data.type === 'toggle-render') renderDebugger.toggle();
      if (data.type === 'toggle-tree') treeView.toggle();
      // AI 監査 (popup) からのページスキャン依頼 (bridge が往復中継)。
      // 集計はスタイル値と件数のみで、テキスト・URL 等のページ内容は含めない。
      if (data.type === 'design-scan' && typeof data.id === 'string') {
        const scan = scanDesign(document, currentTokens(), {
          skip: (el) => overlay.containsTarget(el),
        });
        window.postMessage(
          { source: PAGE_SOURCE, type: 'design-scan-result', id: data.id, payload: scan },
          '*',
        );
      }
    });
  },
});
