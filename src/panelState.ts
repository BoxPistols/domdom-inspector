/**
 * side panel の状態モデル (issue #10 / `docs/design-coverage-screen.md` §5-2)。
 *
 * **パネル常駐が新しく生む嘘はただ 1 つ**: popup は外側をクリックすると必ず閉じるので
 * 「表示中の数字が別ページのもの」になりえないが、パネルは開いたまま残るため、
 * タブを切り替えても・ページが遷移しても・トークンを編集しても、**古い率を新鮮な顔で
 * 出し続けられる**。これは欠測ではなく誤答なので、描画より先にここを固める。
 *
 * 純関数にしてあるのは e2e の限界のため (§6-6): Playwright に side panel を開く API は
 * 無く、`sidePanel.open()` は user gesture 必須で service worker からも呼べない。
 * つまり**本設計で最も壊してはいけない箇所が、実機目視でしか確認できない**。
 * だから状態遷移は全部ここに集め、`panelState.test.ts` で網羅する。
 */

/** パネルが「今どのタブを見ているか」について知っていること */
export interface PanelTarget {
  /** 対象タブ。まだ解決できていなければ null */
  tabId: number | null;
  /**
   * 読めた origin。**読めないこと自体に意味がある。**
   * パネルはタブ切替のたびに invocation を受けないので `activeTab` が付かず、
   * host permission の無いタブでは `tab.url` が undefined になる。よって
   * 「http(s) だが未許可」と「chrome:// でそもそも検査できない」は**区別できない** (§6-2)。
   * 区別できない事実を設計に織り込み、理由を断定しない文言に倒す。
   */
  origin: string | null;
  /**
   * ページの世代を表す鍵。ナビゲーションで変わる。
   * **`tab.url` からは作らない** — 上記の理由で未許可タブでは取れないため、
   * 計測の往復でページ側から受け取った値と、`tabs.onUpdated` の loading 遷移で
   * 無効化した結果を呼び出し側が入れる。不明なら null。
   */
  documentKey: string | null;
}

/** 直近の計測が「どの条件で」取られたか */
export interface PanelMeasurement {
  tabId: number;
  documentKey: string | null;
  /**
   * 計測に使った辞書の署名。トークンが編集されたら変わる。
   * 中身の形式は問わない (件数 + 出所などの安定した文字列) が、
   * **同じ辞書なら同じ文字列**になること。
   */
  tokenSignature: string;
  /** 計測時刻 (epoch ms) */
  at: number;
}

/**
 * パネルがそのタブについて言えること。
 * `unknown` は「検査できない」ではなく「**判断材料が無い**」— 断定しないための状態。
 */
export type PanelAvailability = 'ok' | 'unknown';

export type PanelFreshness =
  | 'none'
  | 'fresh'
  | 'stale-tokens'
  | 'stale-navigation'
  | 'stale-tab';

export interface PanelState {
  availability: PanelAvailability;
  freshness: PanelFreshness;
  /** 数字をそのまま信じさせてよいか。false なら dim + バナーで視覚的に切り離す */
  trustNumbers: boolean;
  /**
   * ページ上ハイライトを許してよいか。**古い結果で塗ると別ページを塗る**ので、
   * fresh のときだけ true。availability とは独立 (origin が読めなくても、
   * たった今そのタブを計測できたのなら塗る先は正しい)。
   */
  canHighlight: boolean;
}

export interface DerivePanelStateInput {
  target: PanelTarget;
  /** 直近の計測。まだ 1 度も測っていなければ null */
  measurement: PanelMeasurement | null;
  /** **今の**辞書署名。measurement.tokenSignature と比べて編集を検出する */
  tokenSignature: string;
}

/**
 * 状態を導出する。**優先順位は tab > navigation > tokens。**
 * 食い違いが複数あるときは「より根本的にズレている方」を出す — タブが違うのに
 * 「トークンを編集しました」と出ると、利用者は再計測すれば直ると誤解する。
 */
export function derivePanelState({
  target,
  measurement,
  tokenSignature,
}: DerivePanelStateInput): PanelState {
  const availability: PanelAvailability = target.origin ? 'ok' : 'unknown';
  const freshness = deriveFreshness(target, measurement, tokenSignature);
  const fresh = freshness === 'fresh';
  return { availability, freshness, trustNumbers: fresh, canHighlight: fresh };
}

function deriveFreshness(
  target: PanelTarget,
  measurement: PanelMeasurement | null,
  tokenSignature: string,
): PanelFreshness {
  if (!measurement) return 'none';
  // 対象タブが分からない = その計測が今の対象のものだと言えない。
  // **「たぶん同じ」に倒さない** — パネルの嘘はここからしか生まれない
  if (target.tabId === null || measurement.tabId !== target.tabId) return 'stale-tab';
  // documentKey は「不明 (null)」も 1 つの値として扱う。計測時に鍵があったのに
  // 今は無い = 見失っている、なので同一とは言えない (安全側の stale)
  if (measurement.documentKey !== target.documentKey) return 'stale-navigation';
  if (measurement.tokenSignature !== tokenSignature) return 'stale-tokens';
  return 'fresh';
}

/**
 * 辞書の署名を作る。**件数だけでは足りない** — 同じ件数で中身が入れ替わった編集を
 * 見逃す。名前の集合まで含めて、同じ辞書なら同じ文字列になるようにする。
 *
 * `TokenDict` に直接依存させず、呼び出し側が名前を渡す形にしてあるのは、
 * この module を design 経路の依存関係から独立に保つため。
 */
export function tokenSignatureOf(names: {
  colors: readonly string[];
  sizes: readonly string[];
}): string {
  const colors = [...names.colors].sort();
  const sizes = [...names.sizes].sort();
  return `c${colors.length}:${colors.join(',')}|s${sizes.length}:${sizes.join(',')}`;
}
