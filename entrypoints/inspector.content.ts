import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { DEV_MATCHES } from '../src/matches';
import { BRIDGE_SOURCE } from '../src/types';

/**
 * MAIN world / document_start: React 読み込み前に DevTools フックを確立し、
 * ブリッジ (ISOLATED) からの設定・トグル指示を受けてインスペクタを駆動する。
 */
export default defineContentScript({
  matches: DEV_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const hookState = installHook();
    const inspector = new Inspector(hookState);

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') inspector.applySettings(data.payload);
      if (data.type === 'toggle') inspector.toggle();
    });
  },
});
