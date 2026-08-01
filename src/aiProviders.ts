/**
 * BYOK AI プロバイダ定義 (FR-24 / issue #9)。
 * リクエスト構築・レスポンス解釈の純関数のみ。fetch 自体は background (SW) が行う
 * (MV3 リモートコード禁止に適合 — 取得するのはデータのみ)。
 * モデル ID はハードコードせず設定値 (ここにあるのは「最安クラス既定 + 次点」の初期値)。
 */

export type AiProviderId = 'openai' | 'gemini';

export interface AiProviderDef {
  id: AiProviderId;
  label: string;
  /** optional host permission の origin パターン (公式エンドポイントのみ) */
  originPattern: string;
  /** 最安クラスの既定モデル (設定で変更可能) */
  defaultModel: string;
  /** 次点モデル (品質寄り) */
  altModel: string;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderDef> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    originPattern: 'https://api.openai.com/*',
    defaultModel: 'gpt-5-nano',
    altModel: 'gpt-5-mini',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    originPattern: 'https://generativelanguage.googleapis.com/*',
    defaultModel: 'gemini-2.5-flash-lite',
    altModel: 'gemini-2.5-flash',
  },
};

export interface AiHttpRequest {
  url: string;
  headers: Record<string, string>;
  /** JSON.stringify 前の body */
  body: unknown;
}

/** provider 別の HTTP リクエストを構築する (API キーはヘッダ/クエリに載せる) */
export function buildAiRequest(
  provider: AiProviderId,
  model: string,
  apiKey: string,
  system: string,
  user: string,
): AiHttpRequest {
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
    };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
    },
  };
}

/** provider 別のレスポンス JSON から講評テキストを取り出す。形が合わなければ null */
export function parseAiResponse(provider: AiProviderId, json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  try {
    if (provider === 'openai') {
      const choices = j.choices as { message?: { content?: unknown } }[] | undefined;
      const content = choices?.[0]?.message?.content;
      return typeof content === 'string' && content.trim() ? content : null;
    }
    const candidates = j.candidates as
      | { content?: { parts?: { text?: unknown }[] } }[]
      | undefined;
    const parts = candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('');
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** API のエラーレスポンス JSON から人間可読なメッセージを取り出す (無ければ null) */
export function parseAiError(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null;
  const err = (json as { error?: unknown }).error;
  if (typeof err === 'string') return err;
  if (err !== null && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return null;
}
