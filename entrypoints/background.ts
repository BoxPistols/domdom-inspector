import {
  buildAiRequest,
  parseAiError,
  parseAiResponse,
  type AiProviderId,
} from '../src/aiProviders';

const COMMANDS = new Set(['toggle-inspect', 'toggle-render', 'toggle-tree']);

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

export default defineBackground(() => {
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
