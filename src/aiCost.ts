/**
 * AI 呼び出しのトークン概算 (FR-27)。送信前プレビューに「概算入力トークン」を出すための
 * 決定論ヒューリスティック。正確なトークナイザは持たない (依存とサイズを増やさない):
 * ASCII ≈ 4 文字/トークン、非 ASCII (CJK 等) ≈ 1.5 文字/トークン で近似する。
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! <= 0x7f) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4 + other / 1.5);
}

/** 1 セッション (ブラウザ起動中) の講評呼び出し上限 (FR-27 コストガバナンス) */
export const AI_SESSION_CALL_LIMIT = 20;
