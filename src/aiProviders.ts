/**
 * BYOK AI プロバイダ定義 (FR-24 / issue #9)。
 * リクエスト構築・レスポンス解釈の純関数のみ。fetch 自体は background (SW) が行う
 * (MV3 リモートコード禁止に適合 — 取得するのはデータのみ)。
 * モデル ID はハードコードせず設定値 (ここにあるのは「最安クラス既定 + 次点」の初期値)。
 */

// Geminiは既定のgemini-2.5-flash-liteが新規利用者に404を返すため外した
export type AiProviderId = 'openai';

export interface AiProviderDef {
  id: AiProviderId;
  label: string;
  /** optional host permission の origin パターン (公式エンドポイントのみ) */
  originPattern: string;
  /** 既定モデル (設定で変更可能) */
  defaultModel: string;
  /**
   * 過去に既定だったモデル ID。既定を差し替えたとき、**保存済み設定が古い既定のままだと
   * 新しい既定が反映されない**ため、これに一致する保存値は新既定へ移行する
   * (ユーザーが自分で入力した値は移行しない)。
   */
  supersededDefaults: string[];
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderDef> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    originPattern: 'https://api.openai.com/*',
    defaultModel: 'gpt-6-luna',
    // gemini-2.5-flash-liteはGemini時代の既定。保存値に残っていたら既定へ戻す
    supersededDefaults: ['gpt-5-nano', 'gpt-5.6-luna', 'gemini-2.5-flash-lite'],
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
  // 現在はOpenAIのみ。プロバイダを戻すときに分岐できるよう引数は残す
  void provider;
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

/** provider 別のレスポンス JSON から講評テキストを取り出す。形が合わなければ null */
export function parseAiResponse(provider: AiProviderId, json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  // 現在はOpenAIのみ（引数はbuildAiRequestと同じ理由で残す）
  void provider;
  try {
    const choices = j.choices as { message?: { content?: unknown } }[] | undefined;
    const content = choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? content : null;
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

/**
 * 保存済みモデル ID を現在の既定へ移行する純関数。
 * 旧既定のまま保存されている場合だけ差し替え、ユーザーが自分で入れた値は尊重する。
 */
export function migrateModelId(provider: AiProviderId, stored: string | undefined): string {
  const def = AI_PROVIDERS[provider];
  if (!stored) return def.defaultModel;
  return def.supersededDefaults.includes(stored) ? def.defaultModel : stored;
}
