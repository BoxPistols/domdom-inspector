import {
  buildAiRequest,
  parseAiError,
  parseAiResponse,
  type AiProviderId,
} from '../src/aiProviders';

// v1 はデザイン計測のみ (tree/render は配線外し、実装は温存)
const COMMANDS = new Set(['toggle-inspect']);

/**
 * 右クリックメニュー。id はそのまま content script へ送るメッセージ型になる。
 * **要素は Chrome から渡されない** (contextMenus API は座標も要素も持たない) ため、
 * MAIN world 側が contextmenu イベントで対象要素を控えておき、それを使う。
 */
const CONTEXT_ITEMS = [
  { id: 'inspect-at-context', titleKey: 'ctxInspectElement' },
  { id: 'open-editor-at-context', titleKey: 'ctxOpenInEditor' },
] as const;

/** メニューを作り直す (重複 id で create が失敗するため removeAll してから) */
function createContextMenus(): void {
  try {
    browser.contextMenus.removeAll(() => {
      for (const item of CONTEXT_ITEMS) {
        browser.contextMenus.create({
          id: item.id,
          title: browser.i18n.getMessage(item.titleKey),
          // 注入できないページ (chrome:// 等) では出さない。出して無反応が一番わかりにくい
          documentUrlPatterns: ['http://*/*', 'https://*/*'],
          contexts: ['all'],
        });
      }
    });
  } catch {
    // contextMenus が使えない環境では黙って諦める (他機能は動く)
  }
}

/** popup からの AI 講評依頼 (FR-24)。キーは載せ替えるだけで保存しない */
interface AiReviewMessage {
  type: 'ai-review';
  provider: AiProviderId;
  model: string;
  apiKey: string;
  system: string;
  user: string;
}

type AiReviewResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * BYOK AI 通信 (FR-24)。公式エンドポイントへ background (SW) から直接 fetch する。
 * optional host permission は popup が送信ボタンの gesture 内で request 済み。
 * 呼び出しは常にユーザーの明示操作起点 (FR-25) — background から自発的に呼ばない。
 */
async function handleAiReview(msg: AiReviewMessage): Promise<AiReviewResult> {
  try {
    const req = buildAiRequest(msg.provider, msg.model, msg.apiKey, msg.system, msg.user);
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = parseAiError(json);
      return { ok: false, error: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}` };
    }
    const text = parseAiResponse(msg.provider, json);
    return text ? { ok: true, text } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


/**
 * 許可済みオリジンへの content script 動的登録を復元する。
 *
 * **これが無いと「また有効化を押さないと動かない」が起きる。**
 * `permissions.request` で得た許可はブラウザ再起動をまたいで残るが、
 * `scripting.registerContentScripts` の登録は**拡張の再読込・更新で消える**。
 * その結果「許可はあるのにスクリプトが入らない」という無言の不整合が残り、
 * 利用者からは機能が止まったようにしか見えない。
 * 起動時と更新時に許可の実態から登録を作り直すことで、押し直しを不要にする。
 */
async function restoreRegistrations(): Promise<void> {
  let origins: string[] = [];
  try {
    const granted = await browser.permissions.getAll();
    origins = granted.origins ?? [];
  } catch {
    return;
  }
  if (!origins.length) return;

  const scripts: Parameters<typeof browser.scripting.registerContentScripts>[0] = [];
  const add = (id: string, matches: string[]) => {
    scripts.push(
      {
        id: `${id}_bridge`,
        matches,
        js: ['content-scripts/bridge.js'],
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
      {
        id: `${id}_inspector`,
        matches,
        js: ['content-scripts/inspector.js'],
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
    );
  };

  // 全サイト許可があれば個別オリジンは不要 (包含されるため登録数を最小化する)
  if (origins.some((o) => o === '*://*/*' || o === '<all_urls>')) {
    add('all', ['*://*/*']);
  } else {
    for (const pattern of origins) {
      // popup が登録するのと同じ id 規則にし、二重登録・取り残しを防ぐ
      const origin = pattern.replace(/\/\*$/, '');
      const key = origin.replace(/[^a-z0-9]/gi, '_');
      add(`dyn_${key}`, [pattern]);
    }
  }
  if (!scripts.length) return;

  try {
    // 既存の登録は消してから作り直す (id 重複で全体が失敗するのを避ける)
    const existing = await browser.scripting.getRegisteredContentScripts();
    const ids = existing.map((s) => s.id).filter((id) => scripts.some((n) => n.id === id));
    if (ids.length) await browser.scripting.unregisterContentScripts({ ids });
    await browser.scripting.registerContentScripts(scripts);
  } catch {
    // 登録できない環境 (権限剥奪直後等) では黙って諦める。次の起動で再試行される
  }
}

export default defineBackground(() => {
  // 拡張の再読込・更新・ブラウザ起動のいずれでも登録を復元する
  browser.runtime.onInstalled.addListener(() => void restoreRegistrations());
  browser.runtime.onStartup.addListener(() => void restoreRegistrations());
  void restoreRegistrations();

  // 右クリックメニューは onInstalled/onStartup で作り直す (SW が寝ても項目は残る)
  browser.runtime.onInstalled.addListener(createContextMenus);
  browser.runtime.onStartup.addListener(createContextMenus);

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id == null) return;
    if (!CONTEXT_ITEMS.some((i) => i.id === info.menuItemId)) return;
    // **frameId を必ず指定する**: 未指定だと全フレームの bridge に配信され、
    // 右クリックしていない iframe 側でも検査が始まる (info.frameId は右クリックされたフレーム)
    browser.tabs
      .sendMessage(tab.id, { type: info.menuItemId }, { frameId: info.frameId ?? 0 })
      .catch(() => {
        // content script が未注入のページ (未許可オリジン) は無視。
        // popup 側の有効化導線が同じ理由を文言で説明する
      });
  });

  // キーボードショートカット (manifest commands) → アクティブタブへトグル指示 (FR-01)
  browser.commands.onCommand.addListener(async (command, tab) => {
    if (!COMMANDS.has(command)) return;
    const tabId =
      tab?.id ??
      (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId != null) {
      browser.tabs.sendMessage(tabId, { type: command }).catch(() => {
        // 対象外オリジン (content script 未注入) は無視
      });
    }
  });

  // 非同期応答は sendResponse + return true で返す (Chrome ネイティブ API では
  // リスナから Promise を返しても応答にならない。polyfill 非導入のため必須)
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ai-review') return false;
    void handleAiReview(message as AiReviewMessage).then(sendResponse);
    return true;
  });
});
