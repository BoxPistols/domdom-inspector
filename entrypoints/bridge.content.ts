import { DEV_MATCHES } from '../src/matches';
import { BRIDGE_SOURCE, DEFAULT_SETTINGS } from '../src/types';

/**
 * ISOLATED world ブリッジ: browser.storage の設定と background からのトグル指示を
 * postMessage で MAIN world に中継する。
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

    void pushSettings();
    browser.storage.onChanged.addListener((_changes, area) => {
      if (area === 'local') void pushSettings();
    });

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'toggle-inspect') {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle' }, '*');
      }
    });
  },
});
