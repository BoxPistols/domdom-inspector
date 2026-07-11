import { DEV_MATCHES } from '../src/matches';
import { BRIDGE_SOURCE, DEFAULT_SETTINGS, DEFAULT_STRINGS, type UiStrings } from '../src/types';

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
        {
          source: BRIDGE_SOURCE,
          type: 'tokens',
          payload: tokenDict ?? { colors: [], sizes: [] },
        },
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

    pushStrings();
    void pushSettings();
    void pushTokens();
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      void pushSettings();
      if ('tokenDict' in changes) void pushTokens();
    });

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'toggle-inspect') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle' }, '*');
      }
      // 冪等 ON (popup のサイト有効化直後に使う。既に ON でも OFF に倒れない)
      if (message?.type === 'inspect-on') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'inspect-on' }, '*');
      }
      if (message?.type === 'toggle-render') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle-render' }, '*');
      }
      if (message?.type === 'toggle-tree') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle-tree' }, '*');
      }
    });
  },
});
