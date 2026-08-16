import { extractDesignStyle } from './designStyle';
import { visibleElements } from './designScan';

/**
 * 「この値を使っている要素」をページ上で指すための再発見 (issue #10 §5-4)。
 *
 * **なぜ再走査が要るか**: 集計 (`Occurrence`) は `{label, value, count, origin}` しか
 * 持たず、`scanDesign` も要素参照を残さない。よって `padding 13px` を光らせるには
 * DOM を走査し直して `extractDesignStyle` を再実行し、`label+value` を突き合わせる
 * しかない。
 *
 * **走査述語は計測と共有する** (`visibleElements`)。skip / `checkVisibility()` / 上限の
 * どれか 1 つでもズレると「96 件中 96 件を表示」と計測時の ×96 が食い違い、
 * 検算のための画面が検算に使えなくなる。
 *
 * **要素への強参照を保持しない**: 返した配列は呼び出し側が即座に矩形へ変換して捨てる。
 * SPA は DOM を入れ替えるので、保持するとリークし、しかも古い要素を指し続ける。
 * 押すたびに引き直す。
 */

/** 一度に描く上限。数千を一斉に塗ると重い上に、部分表示を全体と誤読させる */
export const HIGHLIGHT_MAX = 200;

export interface HighlightTarget {
  label: string;
  value: string;
}

export interface HighlightMatch {
  /** 描画対象 (上限適用後)。**保持しないこと** */
  elements: Element[];
  /** いま見つかった総数 (上限適用前) */
  total: number;
  /** 上限に当たったら上限値、当たっていなければ null */
  cappedAt: number | null;
  /** 走査自体が上限で打ち切られたか (計測側と同じ意味) */
  truncated: boolean;
}

export function findElementsForValue(
  root: ParentNode,
  target: HighlightTarget,
  opts: { skip?: (el: Element) => boolean; max?: number; drawMax?: number } = {},
): HighlightMatch {
  const drawMax = opts.drawMax ?? HIGHLIGHT_MAX;
  const scanned = visibleElements(root, { skip: opts.skip, max: opts.max });
  const elements: Element[] = [];
  let total = 0;

  for (const el of scanned.elements) {
    // 計測側と同じ抽出条件。value は withOrigin/withVars に影響されないが、
    // **同じ呼び方をする**ことで将来どちらかが value に触ったときに揃って動く
    for (const prop of extractDesignStyle(el, { withOrigin: false, withVars: false })) {
      if (prop.label !== target.label || prop.value !== target.value) continue;
      total += 1;
      if (elements.length < drawMax) elements.push(el);
      break; // 同じ要素を二重に数えない (1 要素 1 ラベル)
    }
  }

  return {
    elements,
    total,
    cappedAt: total > drawMax ? drawMax : null,
    truncated: scanned.truncated,
  };
}
