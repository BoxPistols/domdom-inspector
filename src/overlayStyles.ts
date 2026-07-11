/**
 * overlay の closed Shadow DOM に注入する CSS。
 * ダーク基調 + 各サーフェス (box/badge/toast/panel/stats/rctl/inspect-pill/tree) のスタイル。
 * overlay.ts から分離しただけで内容は不変 (behavior-preserving)。
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
      .badge, .toast, .panel, .stats, .rctl, .tree { border: 1px solid rgba(255,255,255,0.18); }
      .badge .name { font-weight: 700; display: block; }
      .badge .meta { opacity: 0.8; display: block; }
      .badge .file { opacity: 0.95; display: block; margin-top: 2px; }
      /* デザイン情報は 1 プロパティ = 1 チップで折返し表示 (1 行連結より読める) */
      .badge .design { display: flex; flex-wrap: wrap; gap: 3px 6px; margin-top: 4px; color: #a5d8ff; }
      .badge .chip {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,0.08);
      }
      .badge .chip .lb { opacity: 0.65; }
      .badge .chip .sw {
        width: 10px; height: 10px; border-radius: 3px; flex: none;
        border: 1px solid rgba(255,255,255,0.6);
      }
      /* デザイントークン照合の注釈: 一致=緑でトークン名 / 野良値=黄で最近傍 */
      .badge .chip .tk { font-size: 10px; padding-left: 2px; }
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
      .panel .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
      .panel .file { opacity: 0.65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .render-canvas { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
      .stats {
        position: fixed;
        z-index: 2147483647;
        display: none;
        pointer-events: auto;
        top: 12px;
        right: 12px;
        width: 340px;
        max-height: 70vh;
        overflow: auto;
        border-radius: 8px;
        background: rgba(20, 20, 24, 0.96);
        color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      }
      .stats .head {
        display: flex; justify-content: space-between; align-items: center; gap: 6px 8px;
        flex-wrap: wrap;
        padding: 8px 12px; font-weight: 700; position: sticky; top: 0;
        background: rgba(20,20,24,0.98); z-index: 1;
      }
      .stats .head .ttl { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
      .stats .head .acts { display: inline-flex; align-items: center; gap: 8px; flex: none; }
      .stats .head button {
        all: unset; cursor: pointer; opacity: 0.75; font-size: 12px; padding: 2px 6px;
        border-radius: 6px;
      }
      .stats .head button.act {
        background: rgba(96,165,250,0.18); color: #a5d8ff; font-weight: 700;
        border: 1px solid rgba(96,165,250,0.45);
      }
      .stats .head button.x { font-size: 15px; padding: 0 5px; }
      .stats .head button:hover { opacity: 1; }
      /* Page vitals チップ (good=緑 / needs-improvement=黄 / poor=赤) */
      .stats .vit {
        display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px;
        padding: 2px 12px 6px;
      }
      .stats .vit .vlb { opacity: 0.6; font-size: 11px; margin-right: 2px; }
      .stats .vchip {
        display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px;
        border-radius: 999px; background: rgba(255,255,255,0.07); font-size: 11px;
      }
      .stats .vchip .vd { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; }
      .stats .vchip.ok .vd { background: #34d399; }
      .stats .vchip.ni .vd { background: #fbbf24; }
      .stats .vchip.bad .vd { background: #f87171; }
      .stats .sum { padding: 0 12px 2px; font-weight: 700; }
      .stats .sub { padding: 0 12px 8px; opacity: 0.6; font-size: 11px; }
      .stats .r {
        display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px;
        padding: 4px 12px; align-items: baseline;
      }
      .stats .r:nth-child(even) { background: rgba(255,255,255,0.04); }
      .stats .r.hd { opacity: 0.55; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
      .stats .r .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stats .r .ct { font-weight: 700; text-align: right; }
      .stats .r .ws { text-align: right; opacity: 0.55; min-width: 3ch; }
      .stats .r .ws.warn { color: #fbbf24; opacity: 1; font-weight: 700; }
      .stats .r .ms { opacity: 0.6; text-align: right; min-width: 5ch; }
      .stats .foot { padding: 6px 12px 8px; font-size: 11px; color: #fbbf24; opacity: 0.9; }
      .rctl {
        position: fixed; z-index: 2147483647; display: none;
        pointer-events: auto; left: 12px; bottom: 12px;
        align-items: center; gap: 10px; padding: 8px 12px;
        border-radius: 999px; background: rgba(20,20,24,0.94); color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.4);
      }
      .rctl.on { display: inline-flex; }
      .rctl .st { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
      .rctl .st .d { width: 8px; height: 8px; border-radius: 50%; background: #34d399; }
      .rctl.rec .st .d { background: #ef4444; animation: rctlblink 1s steps(2, start) infinite; }
      @keyframes rctlblink { 50% { opacity: 0.25; } }
      .rctl button {
        all: unset; cursor: pointer; padding: 4px 12px; border-radius: 999px;
        background: #ef4444; color: #fff; font-weight: 700; font-size: 12px;
      }
      .rctl.rec button { background: #6b7280; }
      .rctl button:hover { filter: brightness(1.1); }
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
      .tree {
        position: fixed; z-index: 2147483647; display: none;
        pointer-events: auto; top: 12px; left: 12px;
        width: 360px; max-height: 78vh; overflow: auto;
        border-radius: 8px; background: rgba(20,20,24,0.96); color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      }
      .tree .head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; font-weight: 700; position: sticky; top: 0;
        background: rgba(20,20,24,0.98);
      }
      .tree .head button { all: unset; cursor: pointer; opacity: 0.6; font-size: 14px; padding: 0 4px; }
      .tree .head button:hover { opacity: 1; }
      .tree .trow {
        display: flex; align-items: center; gap: 6px;
        padding: 3px 12px 3px 0; cursor: pointer; white-space: nowrap;
      }
      .tree .trow:hover { background: rgba(255,255,255,0.08); }
      .tree .trow.hl { background: rgba(96,165,250,0.35); }
      .tree .trow .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .tree .trow .nm { overflow: hidden; text-overflow: ellipsis; }
      .tree .trow .tag { opacity: 0.4; font-size: 10px; }
      .tree .empty { padding: 8px 12px; opacity: 0.6; }
      /* a11y: キーボード操作時のフォーカスリング (全ボタン共通) */
      button:focus-visible {
        outline: 2px solid #60a5fa;
        outline-offset: 2px;
        opacity: 1;
      }
    `;
