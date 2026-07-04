import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { Overlay } from '../src/overlay';
import { RenderDebugger } from '../src/renderDebug';
import { DEV_MATCHES } from '../src/matches';
import { BRIDGE_SOURCE, DEFAULT_SETTINGS } from '../src/types';

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
    const overlay = new Overlay(DEFAULT_SETTINGS);
    const inspector = new Inspector(hookState, overlay);
    const renderDebugger = new RenderDebugger(hookState, overlay);

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') {
        inspector.applySettings(data.payload);
        overlay.updateSettings(data.payload);
      }
      if (data.type === 'toggle') inspector.toggle();
      if (data.type === 'toggle-render') renderDebugger.toggle();
    });
  },
});
