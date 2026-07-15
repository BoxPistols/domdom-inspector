import { installHook } from '../src/hook';
import { Inspector } from '../src/inspector';
import { Overlay } from '../src/overlay';
import { DEV_MATCHES } from '../src/matches';
import { EMPTY_TOKEN_DICT } from '../src/tokenDict';
import { BRIDGE_SOURCE, DEFAULT_SETTINGS, DEFAULT_STRINGS } from '../src/types';

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
    const w = window as unknown as { __MUI_INSPECTOR_LOADED__?: boolean };
    if (w.__MUI_INSPECTOR_LOADED__) return;
    w.__MUI_INSPECTOR_LOADED__ = true;

    const hookState = installHook();
    // strings は 1 つの共有オブジェクト。bridge からの 'i18n' で in-place 更新すると
    // 参照を持つ全コンポーネントに反映される (英語を既定値として先に動作する)。
    const strings = { ...DEFAULT_STRINGS };
    const overlay = new Overlay(DEFAULT_SETTINGS, strings);
    const inspector = new Inspector(hookState, overlay, strings);
    // 初回リリースはデザイン計測 (inspect) のみ。render/tree/vitals の配線は
    // issue #4-#9 で将来化 (実装ファイルは温存、到達不能)。

    // Esc は中央で所有する (単一モードでも将来のモード追加時に競合しない構え)
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

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'settings') {
        inspector.applySettings(data.payload);
        overlay.updateSettings(data.payload);
      }
      if (data.type === 'i18n' && data.payload) Object.assign(strings, data.payload);
      if (data.type === 'tokens') {
        // payload の shape を検証 (同一 window の任意ページからの postMessage を素通しにしない)。
        // colors/sizes 配列を欠く不正 payload は EMPTY にフォールバックしバッジ描画を守る。
        const p = data.payload;
        overlay.updateTokens(
          p && Array.isArray(p.colors) && Array.isArray(p.sizes) ? p : EMPTY_TOKEN_DICT,
        );
      }
      if (data.type === 'toggle') inspector.toggle();
      if (data.type === 'inspect-on') inspector.enableOnly();
    });
  },
});
