/**
 * React 19 の Owner Stacks (`fiber._debugStack`) から、JSX を書いた位置を取り出す。
 *
 * **なぜ要るか** (2026-08-16 実測): React 19 は `_debugSource` を削除した。
 * 現行のソースジャンプはそれ 1 本に頼っていたため、React 19 のアプリでは位置が
 * **1 つも取れない** (Next.js 16 の実機で祖先 25 世代すべて 0 件)。
 * 代わりに `_debugStack` (JSX 生成時に捕まえた Error) が 23 件入っていた。
 *
 * ここで得られるのは**バンドル後の座標**なので、元ファイルへ戻すのは
 * `src/sourceMap.ts` の役目。この module は文字列処理だけを持つ (テスト可能に保つ)。
 */

export interface StackFrame {
  /** スクリプトの URL (バンドル後) */
  url: string;
  /** 1 起点 */
  line: number;
  /** 1 起点 */
  column: number;
  /** 関数名 (取れれば) */
  name: string | null;
}

/**
 * React 本体・ランタイムのフレーム。**ここを飛ばさないと、利用者のコードではなく
 * React の内部を開いてしまう**。実測で出た形をそのまま拾う。
 */
const INTERNAL_FRAME =
  /(?:^|[/\\])(?:react|react-dom|react-server-dom|scheduler)[-.@/\\]|react_stack_bottom_frame|react-stack-top-frame|\bjsxDEV\b|\bjsxs?\b\s*\(|\bUnknownOwner\b/;

/** `at name (url:line:col)` / `at url:line:col` の両形に対応 */
const FRAME_RE = /^\s*at\s+(?:(.*?)\s+\()?((?:[a-z][a-z0-9+.-]*:)?\/\/[^\s)]+?|\/[^\s)]+?):(\d+):(\d+)\)?\s*$/i;

/**
 * Error のスタック文字列をフレーム列にする。
 * **React 内部と、位置を持たない行 (`Array.map (<anonymous>)` 等) は落とす。**
 */
export function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    if (INTERNAL_FRAME.test(raw)) continue;
    const m = FRAME_RE.exec(raw);
    if (!m) continue;
    const [, name, url, line, column] = m;
    frames.push({
      url,
      line: Number(line),
      column: Number(column),
      name: name ? name.trim() : null,
    });
  }
  return frames;
}

/**
 * その要素の JSX が書かれた位置として**最も確からしいフレーム**を選ぶ。
 *
 * Owner Stack の先頭は「その JSX を生成した呼び出し」なので、**内部フレームを除いた
 * 先頭**を採る。実測 (Next.js 16) では:
 *
 * ```
 * at exports.jsxDEV (…)                 ← 内部。落とす
 * at …/_1dffrib._.js:1921:245           ← これ (= <img> の JSX 呼び出し)
 * at Array.map (<anonymous>)            ← 位置なし。落とす
 * at SampleBrowser (…:1908:32)          ← 親コンポーネント本体
 * ```
 *
 * 先頭が取れないときだけ次を見る (どれも無ければ null)。
 */
export function pickAuthoredFrame(stack: string): StackFrame | null {
  const frames = parseStackFrames(stack);
  return frames[0] ?? null;
}

/**
 * 候補フレームを**順に**返す (先頭が最有力)。
 *
 * **1 つ目が当たりとは限らない。** React は Owner Stack を実際に捕まえるのを
 * 先頭 1 万要素までに制限しており (`1e4 > recentlyCreatedOwnerStacks++`)、それを超えると
 * **React 内部で作られた共有スタック**が入る。その中身は React ランタイムのフレームなので、
 * バンドル名だけを見る除外では素通りし、source map で戻すと React の実装ファイルが開く
 * (2026-08-17 の実機報告: `react-jsx-dev-runtime.development.js` が開いた)。
 *
 * よって呼び出し側は「戻した結果が利用者のコードか」を見て、駄目なら次の候補へ進む。
 */
export function authoredFrames(stack: string, max = 6): StackFrame[] {
  return parseStackFrames(stack).slice(0, max);
}

/**
 * `_debugStack` は Error か、その `stack` 文字列。**どちらでも受ける**
 * (React の版で形が変わりうるので、呼び出し側に分岐を持たせない)。
 */
export function stackStringOf(debugStack: unknown): string | null {
  if (typeof debugStack === 'string') return debugStack;
  if (debugStack && typeof debugStack === 'object') {
    const stack = (debugStack as { stack?: unknown }).stack;
    if (typeof stack === 'string') return stack;
  }
  return null;
}
