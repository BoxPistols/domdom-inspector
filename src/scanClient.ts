import type { DesignScan } from './designScan';

/**
 * 拡張ページ (popup / side panel) からページスキャンを頼むクライアント (issue #10 §5-2)。
 *
 * **この module は `browser.*` を使う拡張ページ専用**なので、design 経路の境界リスト
 * (`src/boundaries.test.ts` の `DESIGN_PATH` / `eslint.config.js`) には**入れない**。
 * design 計測の純ロジックではなく、面と content script をつなぐ配線である。
 */

/**
 * スキャンの結果。**失敗を 1 つの `null` に潰さない。**
 * 「重すぎて時間切れ」「content script が居ない (未有効化)」「ページ側でエラー」は
 * 利用者に出す説明が全部違うのに、以前は全部 null で返って区別できなかった。
 */
export type ScanOutcome =
  | { ok: true; scan: DesignScan; documentKey: string | null }
  | { ok: false; reason: 'timeout' | 'unreachable' | 'empty' };

/** bridge が返す生の形 (`entrypoints/bridge.content.ts` の design-scan 中継と対) */
interface RawScanReply {
  ok?: boolean;
  reason?: string;
  scan?: DesignScan | null;
  documentKey?: string | null;
}

/**
 * 対象タブにスキャンを依頼する。
 *
 * **`frameId: 0` を必ず指定する。** 指定しないと全フレームへ配信され、先に応答した
 * iframe が勝つ (広告 iframe の集計がページ全体の率として出る)。
 *
 * `sendMessage` の reject は「content script が居ない」= まだ有効化していないページ。
 * これは失敗ではなく**そのページの状態**なので、理由として区別して返す。
 */
export async function requestScan(
  tabId: number,
  sendMessage: (tabId: number, message: unknown, options: { frameId: number }) => Promise<unknown>,
): Promise<ScanOutcome> {
  let reply: unknown;
  try {
    reply = await sendMessage(tabId, { type: 'design-scan' }, { frameId: 0 });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  const raw = (reply ?? null) as RawScanReply | null;
  // 応答そのものが無い = 中継が居ない / 拡張の更新直後に古い content script が黙った
  if (!raw) return { ok: false, reason: 'unreachable' };
  if (raw.ok === false) {
    return { ok: false, reason: raw.reason === 'timeout' ? 'timeout' : 'unreachable' };
  }
  if (!raw.scan) return { ok: false, reason: 'empty' };
  return { ok: true, scan: raw.scan, documentKey: raw.documentKey ?? null };
}
