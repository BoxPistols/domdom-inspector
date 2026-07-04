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
  main() {
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
    browser.storage.onChanged.addListener((_changes, area) => {
      if (area === 'local') void pushSettings();
    });

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'toggle-inspect') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle' }, '*');
      }
      if (message?.type === 'toggle-render') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle-render' }, '*');
      }
    });
  },
});
