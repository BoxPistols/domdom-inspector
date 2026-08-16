import { DEV_MATCHES } from '../src/matches';
import {
  BRIDGE_SOURCE,
  DEFAULT_SETTINGS,
  DEFAULT_STRINGS,
  PAGE_SOURCE,
  type UiStrings,
} from '../src/types';

/**
 * ページスキャンの往復に待つ上限。超えたら諦めるが、**null ではなく理由を返す** —
 * 「重すぎて時間切れ」と「そもそも失敗」を呼び出し側が区別できないと、
 * 利用者に出す説明が嘘になる (どちらも「計測できませんでした」になってしまう)。
 */
const SCAN_TIMEOUT_MS = 5000;

/**
 * ISOLATED world ブリッジ: browser.storage の設定と background からのトグル指示を
 * postMessage で MAIN world に中継する。MAIN world は browser.i18n を使えないため、
 * ロケール解決済みの UI 文字列もここで作って渡す。
 */
export default defineContentScript({
  matches: DEV_MATCHES,
  runAt: 'document_start',
  // FR-13 PoC: 子フレーム (srcdoc/blob/data) にも bridge を注入 (inspector と対で必要)
  allFrames: true,
  matchOriginAsFallback: true,
  main() {
    // 静的登録 + 動的登録 + executeScript の二重実行を防ぐガード。
    // **「生きている」ことまで見る。** 拡張を再読み込み/更新すると、既に開いていた
    // タブにこの content script が孤児として残る。旗だけ見て早期 return すると、
    // 新しく注入された側が黙って降りて**そのタブは再読み込みするまで直らない**
    const w = window as unknown as { __MUI_BRIDGE_LOADED__?: () => boolean };
    if (w.__MUI_BRIDGE_LOADED__?.()) return;

    /**
     * 拡張コンテキストが生きているか。無効化された content script では
     * `browser.runtime.id` が undefined になり、以後の `browser.*` は
     * **同期的に「Extension context invalidated」を throw する**
     * (Promise を返さないので `.catch()` では拾えない)。
     */
    const alive = (): boolean => {
      try {
        return !!browser.runtime?.id;
      } catch {
        return false;
      }
    };
    w.__MUI_BRIDGE_LOADED__ = alive;

    /**
     * 拡張 API 呼び出しの共通ラッパ。無効化されたら**自分を畳む**:
     * 旗を落として次の注入に道を譲り、window のリスナも外す。
     * 黙って例外を出し続けると、利用者のページのコンソールを汚し続ける。
     */
    let retired = false;
    const retire = () => {
      if (retired) return;
      retired = true;
      if (w.__MUI_BRIDGE_LOADED__ === alive) delete w.__MUI_BRIDGE_LOADED__;
      window.removeEventListener('message', onPageMessage);
    };
    const safe = <T>(fn: () => T): T | undefined => {
      if (retired) return undefined;
      if (!alive()) {
        retire();
        return undefined;
      }
      try {
        return fn();
      } catch {
        // 呼び出し中に無効化された (alive() の直後に更新が入るレース)
        if (!alive()) retire();
        return undefined;
      }
    };

    const pushSettings = async () => {
      const stored = await safe(() => browser.storage.local.get('settings'));
      if (!stored) return;
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: 'settings',
          payload: { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) },
        },
        '*',
      );
    };

    // **辞書の中継は行わない** (issue #13 / #16)。貼り付け UI が無いので書き込む側が存在せず、
    // かつ MAIN world はページと同一信頼境界なので、受信経路を開けておくと**ページ自身が
    // 辞書を注入して「一致」表示を偽装できる**。MAIN world 側の 'tokens' 受信も閉じた
    // (e2e はテスト用の経路ではなく、実供給元と同じ MUI テーマ自動検出で照合を検証する)。

    // UiStrings の各キーを _locales から解決 (欠落時は英語既定にフォールバック)
    const pushStrings = () => {
      const resolved = safe(() => {
        const out = {} as UiStrings;
        for (const key of Object.keys(DEFAULT_STRINGS) as (keyof UiStrings)[]) {
          out[key] = browser.i18n.getMessage(key) || DEFAULT_STRINGS[key];
        }
        return out;
      });
      if (!resolved) return;
      window.postMessage(
        { source: BRIDGE_SOURCE, type: 'i18n', payload: resolved },
        '*',
      );
    };

    // MAIN world 側がリスナ登録を終えた合図。executeScript による即時注入では
    // bridge → inspector の順で別々に注入されるため、下の初回 push は
    // **inspector のリスナ登録より前に飛ぶ**。同期の pushStrings は確実に失われ、
    // そのタブの overlay 文言が既定の英語で固定されていた (決定論的な取りこぼし)。
    function onPageMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== PAGE_SOURCE) return;
      if (d.type === 'ready') {
        pushStrings();
        void pushSettings();
        return;
      }
      // MAIN world でモードの ON/OFF が変わった → **同じタブの全フレームへ配る**よう
      // background に依頼する (issue #14)。ページが偽装しても起きるのは
      // 「そのタブのインスペクトモードが入る/切れる」だけで、ページ外への作用はない。
      // MAIN world が集めた「プロジェクトのルート候補」を保存する (popup が提示する)。
      // **ページが仕込める文字列**なので、ここでは保存するだけで一切適用しない。
      // 実際にパスの対応表へ入れるかは popup で人が選ぶ (拡張 UI での確認を必ず挟む)。
      // オリジン単位に保存し、他サイトの候補が混ざらないようにする
      if (d.type === 'source-roots' && Array.isArray(d.roots)) {
        const roots = d.roots
          .filter((r: unknown): r is string => typeof r === 'string' && r.startsWith('/'))
          .slice(0, 5)
          .map((r: string) => r.slice(0, 300));
        if (roots.length) {
          safe(() =>
            browser.storage.local.set({ [`roots:${location.host}`]: roots }),
          )?.catch(() => {
            // 保存できなくても本体機能には影響しない (候補提示が出ないだけ)
          });
        }
      }
      if (d.type === 'inspect-state' && typeof d.on === 'boolean') {
        // sendMessage は無効化コンテキストでは**同期 throw** するので、
        // `.catch()` だけでは素通りする (実機でこれが uncaught になっていた)
        safe(() =>
          browser.runtime
            .sendMessage({ type: 'inspect-state', on: d.on })
            .catch(() => {
              // SW が落ちている / 応答が無い場合は諦める (次の操作で再送される)
            }),
        );
      }
    }
    window.addEventListener('message', onPageMessage);

    pushStrings();
    void pushSettings();
    // 変更されたキーに対応する中継だけを行う (popupDevOpen 等の無関係な変更で
    // settings の再取得・postMessage を走らせない)
    safe(() =>
      browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if ('settings' in changes) void pushSettings();
      }),
    );

    safe(() =>
      browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'toggle-inspect') {
          window.postMessage({ source: BRIDGE_SOURCE, type: 'toggle' }, '*');
        }
        // 冪等 ON / OFF (popup のサイト有効化直後 + フレーム間の状態同期)。
        // 既に同じ状態なら何もしない = 何度配っても位相が反転しない (issue #14)
        if (message?.type === 'inspect-on' || message?.type === 'inspect-off') {
          window.postMessage(
            { source: BRIDGE_SOURCE, type: message.type },
            '*',
          );
        }
        // 右クリックメニュー (background) → MAIN world。対象要素は MAIN world 側が
        // contextmenu イベントで控えているので、ここでは種別だけ渡す
        if (
          message?.type === 'inspect-at-context' ||
          message?.type === 'open-editor-at-context'
        ) {
          window.postMessage(
            { source: BRIDGE_SOURCE, type: message.type },
            '*',
          );
        }
        // side panel のページ上ハイライト (issue #10 §5-4)。**新規経路はこの 2 つだけ。**
        // 応答を返さない片道なので往復中継は要らない
        if (message?.type === 'design-highlight' || message?.type === 'design-highlight-clear') {
          window.postMessage(
            {
              source: BRIDGE_SOURCE,
              type: message.type,
              label: message.label,
              value: message.value,
              measured: message.measured,
            },
            '*',
          );
        }
        // side panel のページスキャン依頼を MAIN world へ**往復**中継する (issue #10)。
        // 非同期応答は `sendResponse` + `return true`。**Promise を返しても応答にならない**
        // (Chrome ネイティブ API の仕様。ここの順序を崩すと無言で null が返る)。
        if (message?.type === 'design-scan') {
          const id = Math.random().toString(36).slice(2);
          // 5 秒で諦める。**「重すぎて時間切れ」と「失敗」を呼び出し側が区別できる**よう、
          // タイムアウトは null ではなく理由つきで返す (前は両方 null で潰れていた)
          const timer = setTimeout(() => {
            window.removeEventListener('message', onResult);
            sendResponse({ ok: false, reason: 'timeout' });
          }, SCAN_TIMEOUT_MS);
          const onResult = (event: MessageEvent) => {
            const d = event.data;
            if (event.source !== window || !d || d.source !== PAGE_SOURCE) return;
            if (d.type !== 'design-scan-result' || d.id !== id) return;
            clearTimeout(timer);
            window.removeEventListener('message', onResult);
            sendResponse({ ok: true, scan: d.payload ?? null, documentKey: d.documentKey ?? null });
          };
          window.addEventListener('message', onResult);
          window.postMessage({ source: BRIDGE_SOURCE, type: 'design-scan', id }, '*');
          return true;
        }
        return false;
      }),
    );
  },
});
