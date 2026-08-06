/**
 * **v1 の実際の辞書供給元と同じ経路**でテーマを渡すための fixture (issue #15 / #16)。
 *
 * 以前は e2e とスクリーンショット生成が bridge を騙った `{type:'tokens'}` postMessage で
 * 辞書を注入していた。しかしこの経路は
 *   - 利用者からは到達できない (v1 に貼り付け UI は無い) ので**実物と一致しない画面**を作り、
 *   - MAIN world はページと同一信頼境界なので、開けておくと**ページ自身が「一致」表示を
 *     偽装できる**穴になっていた。
 * そこで受信経路そのものを閉じ、テストと撮影は**製品と同じ発見経路**を使う:
 * `src/muiTheme.ts` の `findMuiThemeFromDom` が DOM 要素の React 内部キー
 * (`__reactFiber$*`) から `return` チェーンを遡り、Provider の `memoizedProps.value` が
 * テーマ形なら採用する。ここではその形の Fiber を fixture 側に用意するだけで、
 * **拡張側は本番と同じコードで自力に発見する** (注入しない)。
 */

/** MUI テーマの最小形 (isMuiThemeLike: typography + shape + palette が必須) */
export interface MuiThemeLike {
  palette: Record<string, unknown>;
  /** 数値なら px 基準として倍数展開される (spacing(1) = spacing × 1) */
  spacing: number;
  shape: { borderRadius: number };
  typography: Record<string, unknown>;
}

/**
 * ThemeProvider を持つ React ルートを模した `<script>` + ホスト要素の HTML を返す。
 *
 * **計測対象の祖先には置かない。** `getFiberFromElement` は親を遡って Fiber を探すため、
 * 祖先に置くと計測対象が「React 要素」と判定され、バッジの体裁が変わってしまう
 * (テーマ発見だけが目的なので、独立した非表示要素に持たせる)。
 */
export function muiThemeRootHtml(theme: MuiThemeLike, id = 'theme-root'): string {
  return `<div id="${id}" hidden></div>
<script>
  (function () {
    // ThemeProvider が context に流すテーマ = MUI アプリの実物と同じ形
    var theme = ${JSON.stringify(theme)};
    var provider = { memoizedProps: { value: theme } };
    var hostFiber = { tag: 5, memoizedProps: {}, return: provider };
    var el = document.getElementById(${JSON.stringify(id)});
    if (el) el['__reactFiber\$e2e'] = hostFiber;
  })();
</script>`;
}
