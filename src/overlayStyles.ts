/**
 * overlay の closed Shadow DOM に注入する CSS。
 * ダーク基調 + **v1 で到達する**サーフェス (box/badge/toast/panel/inspect-pill) のスタイル。
 *
 * 温存サーフェス (render-canvas/stats/rctl/tree) の CSS は
 * `render-bundle/overlayDebugStyles.ts` にある — v1 の出荷 bundle に載せないため (issue #17)。
 * 再配線時は OverlayDebugSurfaces が自分で注入するので、ここへ戻す必要はない。
 */
export const OVERLAY_CSS = `
      :host { all: initial; }
      .box, .badge, .toast, .panel {
        position: fixed;
        z-index: 2147483647;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .box {
        pointer-events: none;
        border: 2px solid transparent;
        background: transparent;
        display: none;
      }
      .badge {
        pointer-events: none;
        display: none;
        max-width: 560px;
        padding: 6px 10px;
        border-radius: 6px;
        background: rgba(20, 20, 24, 0.92);
        color: #fff;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        /* 複数行を許可し肝心な file:line を省略しない */
        white-space: normal;
        overflow-wrap: anywhere;
      }
      /* ダークページで背景と同化しないための輪郭線 */
      .badge, .toast, .panel { border: 1px solid rgba(255,255,255,0.18); }
      .badge .name { font-weight: 700; display: block; }
      .badge .name .cdot {
        display: inline-block; width: 9px; height: 9px;
        margin-right: 6px; border: 1px solid rgba(255,255,255,0.7);
      }
      .badge .name .cdot.circle { border-radius: 50%; }
      .badge .name .cdot.square { border-radius: 0; }
      .badge .name .cdot.diamond { border-radius: 2px; transform: rotate(45deg); }
      .badge .meta { opacity: 0.8; display: block; }
      .badge .file { opacity: 0.95; display: block; margin-top: 2px; }
      /* エディタで開く操作ヒント (⌘Click) */
      .badge .file .ehint { opacity: 0.75; font-size: 11px; }
      /* デザイン情報は 1 プロパティ = 1 チップで折返し表示 (1 行連結より読める) */
      .badge .design { display: flex; flex-wrap: wrap; gap: 3px 6px; margin-top: 4px; color: #a5d8ff; }
      .badge .chip {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,0.08);
      }
      .badge .chip .lb { opacity: 0.8; }
      .badge .chip .sw {
        width: 10px; height: 10px; border-radius: 3px; flex: none;
        border: 1px solid rgba(255,255,255,0.6);
        background-size: auto, 6px 6px;
      }
      /* 宣言された CSS 変数名 (実装トークン): 主表示は紫系 (Figma tk=緑/黄・design 値=青と分離) */
      .badge .chip .var { color: #c0a5ff; font-weight: 600; }
      /* 変数名優先時の生値: 従属表示 (淡色・小) */
      .badge .chip .raw { opacity: 0.75; font-size: 11px; }
      /* デザイントークン照合の注釈: 一致=緑でトークン名 / 野良値=黄で最近傍 */
      .badge .chip .tk { font-size: 11px; padding-left: 2px; }
      .badge .chip .tk.ok { color: #7ddb99; }
      .badge .chip .tk.ng { color: #ffd43b; }
      .badge .chip.stray { outline: 1px solid rgba(255,212,59,0.55); }
      .badge .warn { display: block; margin-top: 3px; color: #ffd43b; }
      .toast {
        display: none;
        left: 50%;
        transform: translateX(-50%);
        bottom: 24px;
        padding: 8px 14px;
        border-radius: 8px;
        background: rgba(20, 20, 24, 0.92);
        color: #fff;
        font-size: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      }
      /* 操作可能トースト (エディタが開かなかったときのコピー導線)。
         既定の .toast は pointer-events: none なので、この時だけ有効化する */
      .toast.interactive {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: min(560px, 90vw);
      }
      /* 本文は折り返して全部見せる (パスは長い)。ボタンは縮めない */
      .toast.interactive .tmsg { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
      .toast.interactive button {
        flex: none;
        font: inherit;
        color: #fff;
        background: rgba(255,255,255,0.14);
        border: 1px solid rgba(255,255,255,0.45);
        border-radius: 6px;
        padding: 3px 10px;
        cursor: pointer;
      }
      /* 閉じる。自動で消さない代わりに、必ず自分で消せるようにする */
      .toast.interactive button.tx { padding: 3px 8px; opacity: 0.7; }
      .toast.interactive button.tx:hover { opacity: 1; }
      .toast.interactive button:hover { background: rgba(255,255,255,0.24); }
      .panel {
        display: none;
        pointer-events: auto;
        min-width: 320px;
        max-width: 560px;
        max-height: 60vh;
        overflow: auto;
        padding: 8px 0;
        border-radius: 8px;
        background: rgba(20, 20, 24, 0.96);
        color: #fff;
        font-size: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      }
      .panel .title { padding: 4px 12px 8px; font-weight: 700; opacity: 0.85; }
      .panel .row {
        display: flex;
        gap: 8px;
        align-items: baseline;
        padding: 5px 12px;
        cursor: default;
      }
      .panel .row.jumpable { cursor: pointer; }
      .panel .row.jumpable:hover { background: rgba(255,255,255,0.08); }
      .panel .row.jumpable:focus-visible { outline: 2px solid #60a5fa; outline-offset: -2px; }
      .panel .dot { width: 8px; height: 8px; flex: none; align-self: center; }
      .panel .dot.circle { border-radius: 50%; }
      .panel .dot.square { border-radius: 0; }
      .panel .dot.diamond { border-radius: 2px; transform: rotate(45deg); }
      .panel .file { opacity: 0.65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inspect-pill {
        position: fixed; z-index: 2147483647; display: none;
        pointer-events: auto; right: 12px; bottom: 12px;
        align-items: center; gap: 8px; padding: 7px 12px;
        border-radius: 999px; background: rgba(20,20,24,0.94); color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18);
      }
      .inspect-pill.on { display: inline-flex; }
      .inspect-pill .lbl { opacity: 0.85; }
      .inspect-pill button {
        all: unset; cursor: pointer; font-size: 14px; opacity: 0.6; padding: 0 2px;
        line-height: 1;
      }
      .inspect-pill button:hover { opacity: 1; }
      /* 値ハイライト (issue #10 §5-4)。率の根拠を実画面で検算させるための面 */
      .hl {
        position: fixed; z-index: 2147483646; pointer-events: none;
        border: 2px solid #ffd43b; background: rgba(255,212,59,0.14);
        border-radius: 2px;
      }
      .hlchip {
        position: fixed; z-index: 2147483647; display: none;
        pointer-events: auto; left: 50%; transform: translateX(-50%); top: 12px;
        align-items: center; gap: 10px; padding: 7px 12px;
        border-radius: 999px; background: rgba(20,20,24,0.94); color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18);
        max-width: min(560px, 90vw);
      }
      .hlchip.on { display: inline-flex; }
      .hlchip .hlv { font-weight: 700; }
      .hlchip .hln { opacity: 0.8; }
      /* 計測時と件数が食い違ったら黄色で言う (黙って別の数を出さない) */
      .hlchip .hlwarn { color: #ffd43b; }
      .hlchip button {
        all: unset; cursor: pointer; flex: none;
        padding: 2px 10px; border-radius: 999px;
        background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.45);
      }
      .hlchip button:hover { background: rgba(255,255,255,0.24); }
      /* a11y: キーボード操作時のフォーカスリング (全ボタン共通) */
      button:focus-visible {
        outline: 2px solid #60a5fa;
        outline-offset: 2px;
        opacity: 1;
      }
    `;
