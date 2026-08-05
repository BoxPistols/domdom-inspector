import { scanDesign } from '../src/designScan';
import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { findMuiTheme, findMuiThemeFromDom } from '../src/muiTheme';
import { Overlay } from '../src/overlay';
import { DEV_MATCHES } from '../src/matches';
import {
  EMPTY_TOKEN_DICT,
  mergeTokenDicts,
  parseMuiTheme,
  type TokenDict,
} from '../src/tokenDict';
import { BRIDGE_SOURCE, DEFAULT_SETTINGS, DEFAULT_STRINGS, PAGE_SOURCE } from '../src/types';

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
    // v1 はデザイン計測 (inspect) のみ。コンポーネントツリー / レンダー可視化 / vitals は
    // 実装を温存したまま配線から外している (本番ビルドでは React が名前を minify するため
    // 原理的に判読不能で、dev でも React DevTools が優れるため)。復活は地雷3 の 4 点配線。

    // MUI テーマ自動取得 (FR-14 / issue #8): 手動貼り付け (pasted) とテーマ由来 (theme) の
    // 2 辞書を持ち、併合して overlay に配る (手動優先)。テーマは commit 後に throttle 付きで
    // 探し、参照が変わったとき (テーマ切替等) だけ再変換してトーストで知らせる。
    let pastedTokens: TokenDict = EMPTY_TOKEN_DICT;
    let themeTokens: TokenDict = EMPTY_TOKEN_DICT;
    let autoTheme = DEFAULT_SETTINGS.autoTheme;
    /** 直近に採用したテーマの内容署名。参照比較だと render 内 createTheme で毎回変わる */
    let themeSignature = '';
    let themeAttemptAt = 0;
    let themeRetryTimer: ReturnType<typeof setTimeout> | undefined;
    const THEME_THROTTLE_MS = 2000;
    const currentTokens = () =>
      mergeTokenDicts(pastedTokens, autoTheme ? themeTokens : EMPTY_TOKEN_DICT);
    const pushMergedTokens = () => {
      overlay.updateTokens(currentTokens());
    };
    /** 辞書の内容署名 (件数 + 先頭数件の名前)。同内容の再取得でトーストを繰り返さないため */
    const signatureOf = (dict: TokenDict) =>
      [
        dict.colors.length,
        dict.sizes.length,
        dict.colors.slice(0, 3).map((c) => `${c.name}:${c.r},${c.g},${c.b},${c.a}`).join('|'),
        dict.sizes.slice(0, 3).map((s) => `${s.name}:${s.px}`).join('|'),
      ].join('#');
    const attemptThemeExtract = () => {
      if (!autoTheme) return;
      const now = Date.now();
      // throttle 中の呼び出しは捨てず窓明けに 1 度だけ再試行する (trailing)。
      // 捨てるだけだと「document_start の失敗が窓を消費 → 初回 commit が窓内 →
      // 以後 commit の来ない静的ページでは永久に取得できない」が起きる。
      if (now - themeAttemptAt < THEME_THROTTLE_MS) {
        if (themeRetryTimer === undefined) {
          themeRetryTimer = setTimeout(() => {
            themeRetryTimer = undefined;
            attemptThemeExtract();
          }, THEME_THROTTLE_MS - (now - themeAttemptAt));
        }
        return;
      }
      themeAttemptAt = now;
      let dict: TokenDict;
      try {
        const theme = findMuiTheme(hookState.roots) ?? findMuiThemeFromDom();
        if (!theme) return;
        dict = parseMuiTheme(theme);
      } catch {
        // 壊れた Fiber / getter が throw するテーマでも抽出を恒久停止させない
        return;
      }
      if (!dict.colors.length && !dict.sizes.length) return;
      const signature = signatureOf(dict);
      if (signature === themeSignature) return;
      themeSignature = signature;
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

    // Esc は中央で所有する (単一モードでも将来のモード追加時に競合しない構え)
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        if (inspector.onEscape()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );

    // 右クリックされた要素を控える。contextMenus API は座標も要素も渡さないため、
    // これが無いとメニュー項目が「どの要素に対する操作か」を知りようがない。
    // インスペクトモードの ON/OFF と無関係に常時観測する必要があるが、
    // preventDefault は一切しない (ページのカスタムメニューを壊さない)。
    let contextTarget: Element | null = null;
    window.addEventListener(
      'contextmenu',
      (event) => {
        // composedPath()[0] は open shadow root の内側の実要素を返す。event.target は
        // shadow 境界で再ターゲットされてホストになるため、これが無いと Web Components の
        // 内部を右クリックしてもホストの値が出る (closed root では仕様上ホストのまま)
        const inner = event.composedPath?.()[0];
        const t = inner instanceof Element ? inner : event.target;
        contextTarget = t instanceof Element ? t : null;
      },
      { capture: true, passive: true },
    );

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') {
        inspector.applySettings(data.payload);
        overlay.updateSettings(data.payload);
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
      if (data.type === 'toggle') {
        inspector.toggle();
        attemptThemeExtract();
      }
      if (data.type === 'inspect-on') {
        inspector.enableOnly();
        attemptThemeExtract();
      }
      // 右クリックメニューからの 2 操作。対象要素が無い (メニューを開いた記録が無い) 場合は
      // 何もしない — 別フレームの右クリックがここへ届いた場合に他要素を掴まないため
      if (data.type === 'inspect-at-context' && contextTarget) {
        inspector.inspectAt(contextTarget);
        attemptThemeExtract();
      }
      if (data.type === 'open-editor-at-context' && contextTarget) {
        inspector.openEditorAt(contextTarget);
      }
      // AI 監査 (popup) からのページスキャン依頼 (bridge が往復中継)。
      // 集計はスタイル値と件数のみで、テキスト・URL 等のページ内容は含めない。
      if (data.type === 'design-scan' && typeof data.id === 'string') {
        // 辞書の出所内訳は 2 辞書を持つここでしか作れない (併合後の合計だけでは
        // 「自動テーマの密なラダーで一致率が上がっている」ことが読み取れない)
        const themeInUse = autoTheme ? themeTokens : EMPTY_TOKEN_DICT;
        const scan = scanDesign(document, currentTokens(), {
          skip: (el) => overlay.containsTarget(el),
          tokenSources: {
            pasted: { colors: pastedTokens.colors.length, sizes: pastedTokens.sizes.length },
            theme: { colors: themeInUse.colors.length, sizes: themeInUse.sizes.length },
          },
        });
        window.postMessage(
          { source: PAGE_SOURCE, type: 'design-scan-result', id: data.id, payload: scan },
          '*',
        );
      }
    });

    // **リスナ登録が済んだことを bridge に知らせる。**
    // popup の「このサイトで有効化」は executeScript を bridge → inspector の順に
    // 2 回に分けて呼ぶため、bridge の初回 push は inspector がまだ存在しない時点で飛ぶ。
    // 同期の i18n push は確実に失われ、そのタブの overlay 文言が英語で固定されていた。
    // 押し込みではなく「受け手が用意できたら引き取る」形にして取りこぼしを消す。
    window.postMessage({ source: PAGE_SOURCE, type: 'ready' }, '*');
  },
});
