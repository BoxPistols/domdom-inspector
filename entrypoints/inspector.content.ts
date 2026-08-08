import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { findMuiTheme, findMuiThemeFromDom } from '../src/muiTheme';
import { Overlay } from '../src/overlay';
import { DEV_MATCHES } from '../src/matches';
import { EMPTY_TOKEN_DICT, parseMuiTheme, type TokenDict } from '../src/tokenDict';
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

    /**
     * トップフレームか。iframe を持つページでは content script が全フレームに入るため、
     * **告知 (モードピル / ON・OFF トースト) はトップだけが出す** (issue #14)。
     * 参照比較なので cross-origin でも例外にならないが、念のため保険を置く。
     */
    let isTopFrame = true;
    try {
      isTopFrame = window.top === window;
    } catch {
      isTopFrame = false;
    }
    /**
     * ON/OFF が変わったら **同じタブの全フレームへ同じ状態を配る**よう background に依頼する。
     * これが無いと Esc / ピルの ✕ がそのフレームにしか効かず、iframe が ON のまま残って
     * **iframe 内のクリックが死んだまま**になる (さらにショートカットを押すと親子で位相が
     * 反転し、何度押しても両方 OFF にできない)。MAIN world は browser.* を使えないので
     * bridge に投げる。受け側の enableOnly/disableOnly は冪等なので配り直しても反転しない。
     */
    /** 配られた状態を適用している間は投げ返さない (フレーム数ぶんの無駄な往復を作らない) */
    let applyingRemoteState = false;
    const broadcastState = (enabled: boolean) => {
      if (applyingRemoteState) return;
      window.postMessage({ source: PAGE_SOURCE, type: 'inspect-state', on: enabled }, '*');
    };
    /** 配られた状態の適用 (冪等)。適用中の onStateChange は上のフラグで抑止される */
    const applyRemoteState = (apply: () => void) => {
      applyingRemoteState = true;
      try {
        apply();
      } finally {
        applyingRemoteState = false;
      }
    };
    const inspector = new Inspector(hookState, overlay, strings, {
      announce: isTopFrame,
      onStateChange: (enabled) => {
        // OFF 中に発見して保留していたテーマ通知をここで出す (告知フレームのみ =
        // iframe の数だけ重複させない)。ON トーストより後に出すことで上書きされない
        if (enabled && isTopFrame && pendingThemeToast) {
          overlay.toast(pendingThemeToast);
          pendingThemeToast = null;
        }
        broadcastState(enabled);
      },
    });
    // v1 はデザイン計測 (inspect) のみ。コンポーネントツリー / レンダー可視化 / vitals は
    // 実装を温存したまま配線から外している (本番ビルドでは React が名前を minify するため
    // 原理的に判読不能で、dev でも React DevTools が優れるため)。復活は地雷3 の 4 点配線。

    // MUI テーマ自動取得 (FR-14 / issue #8) が **v1 の唯一の辞書供給元**。
    // テーマは commit 後に throttle 付きで探し、内容が変わったとき (テーマ切替等) だけ
    // 再変換してトーストで知らせる。
    //
    // **ページからの辞書注入は受け付けない** (issue #16)。以前は bridge を騙った
    // `{type:'tokens'}` を受理していたため、ページ側 JS が自前の辞書を注入して
    // バッジに「一致: 好きなトークン名」を出させられた。この製品の出力は
    // 「実装がデザイン定義に従っているか」の**検証結果**なので、ページから検証結果を
    // 偽装できてはいけない。v1 は送り手 (貼り付け UI) が存在しないので経路ごと閉じる。
    // 再導入する時も、受け入れ経路を作るなら出所を UI に出すこと (issue #13)。
    let themeTokens: TokenDict = EMPTY_TOKEN_DICT;
    let autoTheme = DEFAULT_SETTINGS.autoTheme;
    /** モード OFF 中に発見したテーマの通知を保留する (次の ON で 1 度だけ出す) */
    let pendingThemeToast: string | null = null;
    /** 直近に採用したテーマの内容署名。参照比較だと render 内 createTheme で毎回変わる */
    let themeSignature = '';
    let themeAttemptAt = 0;
    let themeRetryTimer: ReturnType<typeof setTimeout> | undefined;
    const THEME_THROTTLE_MS = 2000;
    const currentTokens = () => (autoTheme ? themeTokens : EMPTY_TOKEN_DICT);
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
      const message = strings.themeTokensLoaded
        .replace('{colors}', String(dict.colors.length))
        .replace('{sizes}', String(dict.sizes.length));
      // **モードを一度も ON にしていないページでトーストを出さない** (= overlay の DOM 注入も
      // しない)。拡張を使う意思を示していない閲覧中に UI が湧くのは越権で、ページの DOM を
      // 不要に変える。OFF 中に見つけた場合は保留し、次の ON で知らせる
      if (inspector.isEnabled()) {
        overlay.toast(message);
      } else {
        pendingThemeToast = message;
      }
    };
    hookState.onCommit(() => attemptThemeExtract());
    // mid-page 注入 (production の「現在のサイトで有効化」) では commit が来ないことが
    // あるため、注入直後にも一度 DOM 経由で試す
    setTimeout(attemptThemeExtract, 1000);

    // Esc は中央で所有する (単一モードでも将来のモード追加時に競合しない構え)。
    //
    // **Esc は押されたフレームの window にしか届かない** (各フレームが独立に所有する)。
    // モードが切れたら onStateChange → broadcastState が全フレームへ OFF を配るので、
    // 親で押しても iframe が ON のまま残ることはない (issue #14)。
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
    let contextAt = 0;
    /**
     * 控えた対象を使ってよい時間。**MAIN world は同一信頼境界で、ページ側の JS は
     * bridge からの postMessage を偽装できる** (source 文字列を真似るだけ)。
     * `open-editor-at-context` を偽装されると、ページが自前で偽装した `__reactFiber$` の
     * `_debugSource` を使ってユーザーのエディタで任意のパスを開かせられる。
     * 実際の右クリック (信頼済みイベント) の直後だけ有効にすることで、
     * 「ユーザーが右クリックした要素に対してしか作用しない」に絞る。
     */
    const CONTEXT_TARGET_TTL_MS = 15000;
    window.addEventListener(
      'contextmenu',
      (event) => {
        // **信頼済みイベントに限る。** ページは dispatchEvent で contextmenu を合成できるが
        // isTrusted は付けられないので、合成イベントで対象を仕込むことはできない
        if (!event.isTrusted) return;
        // composedPath()[0] は open shadow root の内側の実要素を返す。event.target は
        // shadow 境界で再ターゲットされてホストになるため、これが無いと Web Components の
        // 内部を右クリックしてもホストの値が出る (closed root では仕様上ホストのまま)
        const inner = event.composedPath?.()[0];
        const t = inner instanceof Element ? inner : event.target;
        contextTarget = t instanceof Element ? t : null;
        contextAt = Date.now();
      },
      { capture: true, passive: true },
    );
    /** 控えた対象がまだ有効か (信頼済みの右クリック直後のみ) */
    const freshContextTarget = (): Element | null => {
      if (!contextTarget || Date.now() - contextAt > CONTEXT_TARGET_TTL_MS) return null;
      return contextTarget;
    };

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') {
        // applySettings が DEFAULT_SETTINGS と merge した結果を overlay にも配る。
        // **生 payload を overlay へ直接渡してはいけない**: ページが
        // `{source:BRIDGE_SOURCE,type:'settings',payload:{}}` を 1 回投げるだけで colors が
        // 消え、以後 show() が例外で落ちて「前の要素の値を出し続ける」状態を外部から作れた
        // (実測)。tokens 側は shape 検証済みなのに settings だけ素通しだった
        inspector.applySettings(data.payload);
        autoTheme = data.payload.autoTheme !== false;
        pushMergedTokens();
        attemptThemeExtract();
      }
      if (data.type === 'i18n' && data.payload) Object.assign(strings, data.payload);
      // **'tokens' (辞書注入) は受けない** — 上の宣言部のコメントと issue #16 を参照。
      if (data.type === 'toggle') {
        inspector.toggle();
        attemptThemeExtract();
      }
      // 冪等 ON / OFF。**タブ内の全フレームへ配られる**ので、ここが冪等でないと
      // フレーム間で位相が反転する (issue #14)
      if (data.type === 'inspect-on') {
        applyRemoteState(() => inspector.enableOnly());
        attemptThemeExtract();
      }
      if (data.type === 'inspect-off') {
        applyRemoteState(() => inspector.disableOnly());
      }
      // 右クリックメニューからの 2 操作。**信頼済みの右クリック直後の対象しか使わない**
      // (別フレームの右クリックが届いた場合に他要素を掴まないため + ページによる
      // postMessage 偽装で任意要素に作用させられないため)
      if (data.type === 'inspect-at-context') {
        const target = freshContextTarget();
        if (target) {
          inspector.inspectAt(target);
          attemptThemeExtract();
        }
      }
      if (data.type === 'open-editor-at-context') {
        const target = freshContextTarget();
        if (target) inspector.openEditorAt(target);
      }
      // **design-scan (ページ全体の集計) の受信は v1 の配線から外した** (issue #10)。
      // 送信側 (popup のカバレッジ UI) が存在しないのに受信側だけ残すと、
      // ページからの postMessage 偽装で全ページスキャンを起動できる攻撃面と、
      // designScan/coverage 一式 (約 5.7 kB) を bundle に引き込む理由だけが残る。
      // side panel として再導入するとき、この位置に受信側を戻す (実装は温存)。
    });

    // **リスナ登録が済んだことを bridge に知らせる。**
    // popup の「このサイトで有効化」は executeScript を bridge → inspector の順に
    // 2 回に分けて呼ぶため、bridge の初回 push は inspector がまだ存在しない時点で飛ぶ。
    // 同期の i18n push は確実に失われ、そのタブの overlay 文言が英語で固定されていた。
    // 押し込みではなく「受け手が用意できたら引き取る」形にして取りこぼしを消す。
    window.postMessage({ source: PAGE_SOURCE, type: 'ready' }, '*');
  },
});
