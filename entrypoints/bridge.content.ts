import { DEV_MATCHES } from '../src/matches';
import { EMPTY_TOKEN_DICT } from '../src/tokenDict';
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

    // デザイントークン辞書 (popup で解析済み) を MAIN world へ中継
    const pushTokens = async () => {
      const { tokenDict } = await browser.storage.local.get('tokenDict');
      window.postMessage(
        { source: BRIDGE_SOURCE, type: 'tokens', payload: tokenDict ?? EMPTY_TOKEN_DICT },
        '*',
      );
    };

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
      if (!d || d.source !== PAGE_SOURCE || d.type !== 'ready') return;
      pushStrings();
      void pushSettings();
      void pushTokens();
    });

    pushStrings();
    void pushSettings();
    void pushTokens();
    // 変更されたキーに対応する中継だけを行う (popupDevOpen 等の無関係な変更で
    // settings の再取得・postMessage を走らせない)
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('settings' in changes) void pushSettings();
      if ('tokenDict' in changes) void pushTokens();
    });

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'toggle-inspect') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle' }, '*');
      }
      // 冪等 ON (popup のサイト有効化直後に使う。既に ON でも OFF に倒れない)
      if (message?.type === 'inspect-on') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'inspect-on' }, '*');
      }
      // 右クリックメニュー (background) → MAIN world。対象要素は MAIN world 側が
      // contextmenu イベントで控えているので、ここでは種別だけ渡す
      if (message?.type === 'inspect-at-context' || message?.type === 'open-editor-at-context') {
        window.postMessage({ source: BRIDGE_SOURCE, type: message.type }, '*');
      }
      // popup のページスキャン依頼を MAIN world へ往復中継する (AI 監査の入力収集)。
      // 非同期応答は sendResponse + return true (Chrome ネイティブ API では
      // リスナから Promise を返しても応答にならない)
      if (message?.type === 'design-scan') {
        const id = Math.random().toString(36).slice(2);
        const timer = setTimeout(() => {
          window.removeEventListener('message', onResult);
          sendResponse(null);
        }, 5000);
        const onResult = (event: MessageEvent) => {
          const d = event.data;
          if (event.source !== window || !d || d.source !== PAGE_SOURCE) return;
          if (d.type !== 'design-scan-result' || d.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', onResult);
          sendResponse(d.payload ?? null);
        };
        window.addEventListener('message', onResult);
        window.postMessage({ source: BRIDGE_SOURCE, type: 'design-scan', id }, '*');
        return true;
      }
      return false;
    });
  },
});
