import type { SourceLocation } from './types';

/**
 * ソース注釈属性からのジャンプ位置解決 (FR-08 の非 React フォールバック)。
 *
 * ブラウザは「この DOM 要素がどのソース行から出たか」を知らない。React dev ビルドの
 * `_debugSource` はその例外で、無いフレームワーク (Express/EJS/Rails/素の HTML) では
 * **サーバー側がソース位置を DOM に書き出さない限り、原理的にジャンプできない**。
 *
 * そこで、書き出してあるページでは読む。既存規格を初めから拾い、独自属性も
 * Settings.sourceAttr で追加できる:
 * - `data-v-inspector="src/App.vue:12:3"` — vite-plugin-vue-inspector (Vue / Nuxt devtools)
 * - `data-inspector-relative-path` + `data-inspector-line` / `-column` — react-dev-inspector
 * - `data-source` / `data-source-loc` / `data-loc` — 汎用 (`path:line[:col]` 形式)
 *
 * ここは **design 経路 (Fiber 非依存)**。boundaries.test.ts の契約対象。
 */

/** `path:line[:col]` を分解する。line が無ければ 1 行目扱い (path だけでも開ける) */
export function parseSourceRef(raw: string): SourceLocation | null {
  const text = raw.trim();
  if (!text) return null;
  // Windows のドライブレター (C:\…) を行番号と取り違えないよう、末尾から数字を剥がす
  const m = text.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/);
  if (!m) return null;
  const [, file, line, col] = m;
  if (!file || !/[/.]/.test(file)) return null; // ファイルらしくないものは拾わない
  return {
    fileName: file,
    lineNumber: line ? Number(line) : 1,
    columnNumber: col ? Number(col) : 1,
  };
}

/** 単一属性 (`path:line:col` 形式) の規格。先に書いたものが勝つ */
const SINGLE_ATTRS = ['data-v-inspector', 'data-source-loc', 'data-source', 'data-loc'];

/** react-dev-inspector 形式 (パスと行が別属性) */
function fromReactDevInspector(el: Element): SourceLocation | null {
  const file = el.getAttribute('data-inspector-relative-path');
  if (!file) return null;
  const line = el.getAttribute('data-inspector-line');
  const col = el.getAttribute('data-inspector-column');
  return {
    fileName: file,
    lineNumber: line ? Number(line) : 1,
    columnNumber: col ? Number(col) : 1,
  };
}

function fromElement(el: Element, customAttr: string): SourceLocation | null {
  // ユーザーの独自属性を最優先 (既存規格より対象ページに固有なので意図が明確)
  if (customAttr) {
    const v = el.getAttribute(customAttr);
    if (v) {
      const loc = parseSourceRef(v);
      if (loc) return loc;
    }
  }
  for (const attr of SINGLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) {
      const loc = parseSourceRef(v);
      if (loc) return loc;
    }
  }
  return fromReactDevInspector(el);
}

/**
 * 要素と祖先から注釈を探す。**shadow 境界も越える** (parentElement が null になったら
 * ホストへ抜ける — getFiberFromElement と同じ理由で、貫通選択した要素から遡れないと
 * 注釈を持つホストが見えない)。
 *
 * 祖先の注釈は「その要素を含むテンプレートの位置」なので、要素自身の注釈より粗いが
 * 開けないよりよい。探索は近い順で、最初に見つかったものを返す。
 */
export function resolveSourceAttr(element: Element, customAttr = ''): SourceLocation | null {
  let node: Element | null = element;
  let depth = 0;
  // 上限は保険 (壊れた DOM の循環を想定)。通常のページ深さでは届かない値
  while (node && depth < 200) {
    const loc = fromElement(node, customAttr);
    if (loc) return loc;
    const root = node.getRootNode?.();
    node =
      node.parentElement ??
      (root && root !== document && 'host' in root ? ((root as ShadowRoot).host ?? null) : null);
    depth += 1;
  }
  return null;
}

/**
 * どの経路でも開けなかったときに渡す「エディタ側で検索するための手がかり」。
 * grep できる具体値だけを入れる (曖昧な説明文はエディタに貼れない)。
 */
export function buildSearchHints(
  element: Element,
  css: { href: string | null; selector: string } | null,
): string {
  const lines: string[] = [];
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList);
  lines.push(`selector: ${tag}${id}${classes.map((c) => `.${c}`).join('')}`);
  if (classes.length) lines.push(`class: ${classes.join(' ')}`);
  const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (text) lines.push(`text: ${text}`);
  if (css) {
    lines.push(`css: ${css.href ?? '(inline <style>)'}${css.selector ? ` — ${css.selector}` : ''}`);
  }
  return lines.join('\n');
}
