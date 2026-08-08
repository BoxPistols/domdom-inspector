import { DEV_MATCHES } from '../src/matches';
import {
  BRIDGE_SOURCE,
  DEFAULT_SETTINGS,
  DEFAULT_STRINGS,
  PAGE_SOURCE,
  type UiStrings,
} from '../src/types';

/**
 * ISOLATED world ブリッジ: browser.storage の設定と background からのトグル指示を
 * postMessage で MAIN world に中継する。MAIN world は browser.i18n を使えないため、
 * ロケール解決済みの UI 文字列もここで作って渡す。
 */
export default defineContentScript({
  matches: DEV_MATCHES,
  runAt: 'document_start',
  // FR-13 PoC: 子フレーム (srcdoc/blob/data) にも bridge を注入 (inspector と対で必要)
  allFrames: true,
  matchOriginAsFallback: true,
  main() {
    // 静的登録 + 動的登録 + executeScript の二重実行を防ぐガード
    const w = window as unknown as { __MUI_BRIDGE_LOADED__?: boolean };
    if (w.__MUI_BRIDGE_LOADED__) return;
    w.__MUI_BRIDGE_LOADED__ = true;

    const pushSettings = async () => {
      const stored = await browser.storage.local.get('settings');
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: 'settings',
          payload: { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) },
        },
        '*',
      );
    };

    // **辞書の中継は行わない** (issue #13 / #16)。貼り付け UI が無いので書き込む側が存在せず、
    // かつ MAIN world はページと同一信頼境界なので、受信経路を開けておくと**ページ自身が
    // 辞書を注入して「一致」表示を偽装できる**。MAIN world 側の 'tokens' 受信も閉じた
    // (e2e はテスト用の経路ではなく、実供給元と同じ MUI テーマ自動検出で照合を検証する)。

    // UiStrings の各キーを _locales から解決 (欠落時は英語既定にフォールバック)
    const pushStrings = () => {
      const resolved = {} as UiStrings;
      for (const key of Object.keys(DEFAULT_STRINGS) as (keyof UiStrings)[]) {
        resolved[key] = browser.i18n.getMessage(key) || DEFAULT_STRINGS[key];
      }
      window.postMessage({ source: BRIDGE_SOURCE, type: 'i18n', payload: resolved }, '*');
    };

    // MAIN world 側がリスナ登録を終えた合図。executeScript による即時注入では
    // bridge → inspector の順で別々に注入されるため、下の初回 push は
    // **inspector のリスナ登録より前に飛ぶ**。同期の pushStrings は確実に失われ、
    // そのタブの overlay 文言が既定の英語で固定されていた (決定論的な取りこぼし)。
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== PAGE_SOURCE) return;
      if (d.type === 'ready') {
        pushStrings();
        void pushSettings();
        return;
      }
      // MAIN world でモードの ON/OFF が変わった → **同じタブの全フレームへ配る**よう
      // background に依頼する (issue #14)。ページが偽装しても起きるのは
      // 「そのタブのインスペクトモードが入る/切れる」だけで、ページ外への作用はない。
      if (d.type === 'inspect-state' && typeof d.on === 'boolean') {
        browser.runtime.sendMessage({ type: 'inspect-state', on: d.on }).catch(() => {
          // SW が落ちている / 応答が無い場合は諦める (次の操作で再送される)
        });
      }
    });

    pushStrings();
    void pushSettings();
    // 変更されたキーに対応する中継だけを行う (popupDevOpen 等の無関係な変更で
    // settings の再取得・postMessage を走らせない)
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('settings' in changes) void pushSettings();
    });

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'toggle-inspect') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle' }, '*');
      }
      // 冪等 ON / OFF (popup のサイト有効化直後 + フレーム間の状態同期)。
      // 既に同じ状態なら何もしない = 何度配っても位相が反転しない (issue #14)
      if (message?.type === 'inspect-on' || message?.type === 'inspect-off') {
        window.postMessage({ source: BRIDGE_SOURCE, type: message.type }, '*');
      }
      // 右クリックメニュー (background) → MAIN world。対象要素は MAIN world 側が
      // contextmenu イベントで控えているので、ここでは種別だけ渡す
      if (message?.type === 'inspect-at-context' || message?.type === 'open-editor-at-context') {
        window.postMessage({ source: BRIDGE_SOURCE, type: message.type }, '*');
      }
      // **design-scan の中継は v1 の配線から外した** (issue #10 — 送信側の popup UI が
      // 存在しない)。再導入時は「sendResponse + return true」の往復中継をここに戻す
      // (Chrome ネイティブ API ではリスナから Promise を返しても応答にならない)。
      return false;
    });
  },
});
