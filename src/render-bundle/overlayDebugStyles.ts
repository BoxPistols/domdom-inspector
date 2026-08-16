/**
 * 温存サーフェス (render-canvas / stats / rctl / tree) の CSS。
 *
 * v1 の配線からは到達しないため、本体の OVERLAY_CSS から切り出して**出荷 bundle に
 * 載せない** (issue #17)。OverlayDebugSurfaces が初回描画時に shadow root へ注入する。
 * 本体 CSS (`overlayStyles.ts`) と同じ shadow root に同居する前提で書く。
 */
export const DEBUG_OVERLAY_CSS = `
      /* ダークページで背景と同化しないための輪郭線 (本体側は .badge/.toast/.panel を持つ) */
      .stats, .rctl, .tree { border: 1px solid rgba(255,255,255,0.18); }
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
      .tree .trow .dot { width: 7px; height: 7px; flex: none; }
      .tree .trow .dot.circle { border-radius: 50%; }
      .tree .trow .dot.square { border-radius: 0; }
      .tree .trow .dot.diamond { border-radius: 2px; transform: rotate(45deg); }
      .tree .trow .nm { overflow: hidden; text-overflow: ellipsis; }
      .tree .trow .tag { opacity: 0.4; font-size: 10px; }
      .tree .empty { padding: 8px 12px; opacity: 0.6; }
    `;
