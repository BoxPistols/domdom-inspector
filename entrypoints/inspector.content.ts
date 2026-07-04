import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { Overlay } from '../src/overlay';
import { RenderDebugger } from '../src/renderDebug';
import { DEV_MATCHES } from '../src/matches';
import { BRIDGE_SOURCE, DEFAULT_SETTINGS, DEFAULT_STRINGS } from '../src/types';

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
    // strings は 1 つの共有オブジェクト。bridge からの 'i18n' で in-place 更新すると
    // 参照を持つ全コンポーネントに反映される (英語を既定値として先に動作する)。
    const strings = { ...DEFAULT_STRINGS };
    const overlay = new Overlay(DEFAULT_SETTINGS, strings);
    const inspector = new Inspector(hookState, overlay, strings);
    const renderDebugger = new RenderDebugger(hookState, overlay, strings);

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') {
        inspector.applySettings(data.payload);
        overlay.updateSettings(data.payload);
        renderDebugger.applySettings(data.payload.recordKey);
      }
      if (data.type === 'i18n' && data.payload) Object.assign(strings, data.payload);
      if (data.type === 'toggle') inspector.toggle();
      if (data.type === 'toggle-render') renderDebugger.toggle();
    });
  },
});
