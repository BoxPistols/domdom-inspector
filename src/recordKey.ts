/**
 * 記録トグルキーの正規化。単一文字のみ受け付け、小文字化して返す。
 * 空文字・複数文字は fallback (既定キー) へ倒す。
 * RenderDebugger.applySettings と popup の save の二重実装を単一化する。
 */
export function normalizeRecordKey(input: string, fallback: string): string {
  return input.length === 1 ? input.toLowerCase() : fallback;
}
