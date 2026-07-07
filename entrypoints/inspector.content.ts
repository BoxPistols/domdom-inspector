import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { Overlay } from '../src/overlay';
import { RenderDebugger } from '../src/renderDebug';
import { TreeView } from '../src/treeView';
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
    // executeScript による即時注入と、登録済みスクリプトの二重実行を防ぐガード
    const w = window as unknown as { __MUI_INSPECTOR_LOADED__?: boolean };
    if (w.__MUI_INSPECTOR_LOADED__) return;
    w.__MUI_INSPECTOR_LOADED__ = true;

    const hookState = installHook();
    // strings は 1 つの共有オブジェクト。bridge からの 'i18n' で in-place 更新すると
    // 参照を持つ全コンポーネントに反映される (英語を既定値として先に動作する)。
    const strings = { ...DEFAULT_STRINGS };
    const overlay = new Overlay(DEFAULT_SETTINGS, strings);
    const inspector = new Inspector(hookState, overlay, strings);
    const renderDebugger = new RenderDebugger(hookState, overlay, strings);
    const treeView = new TreeView(hookState, overlay, strings);

    // Esc は中央で所有し、インスペクタ (パネル > モード) → レンダー可視化 → ツリーの順に
    // 1 度で 1 つだけ閉じる。複数モード同時 ON でも競合しない。
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        if (inspector.onEscape() || renderDebugger.onEscape() || treeView.onEscape()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') {
        inspector.applySettings(data.payload);
        overlay.updateSettings(data.payload);
        renderDebugger.applySettings(data.payload.recordKey);
        treeView.applySettings(data.payload);
      }
      if (data.type === 'i18n' && data.payload) Object.assign(strings, data.payload);
      if (data.type === 'toggle') inspector.toggle();
      if (data.type === 'inspect-on') inspector.enableOnly();
      if (data.type === 'toggle-render') renderDebugger.toggle();
      if (data.type === 'toggle-tree') treeView.toggle();
    });
  },
});
