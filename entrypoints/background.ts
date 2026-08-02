import {
  buildAiRequest,
  parseAiError,
  parseAiResponse,
  type AiProviderId,
} from '../src/aiProviders';

// v1 はデザイン計測のみ (tree/render は配線外し、実装は温存)
const COMMANDS = new Set(['toggle-inspect']);

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
