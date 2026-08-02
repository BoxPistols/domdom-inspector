/**
 * MUI テーマ自動取得 (FR-14 / issue #8)。
 * ThemeProvider が React Context に流すテーマオブジェクトを Fiber から発見する。
 * ここは「発見」のみを担い、テーマ → TokenDict 変換は tokenDict.parseMuiTheme
 * (純関数・design 経路) が行う。design 経路からは import 禁止 (境界契約)。
 *
 * 発見は 2 戦略の併用:
 * - findMuiTheme: commit 済み FiberRoot からの下り走査 (document_start 注入の通常フロー)
 * - findMuiThemeFromDom: DOM 要素が持つ React 内部キーからの後備
 *   (mid-page 注入 = production サイトの「現在のサイトで有効化」で commit 未観測の場合)
 */

// Fiber 内部は React バージョン依存 (CLAUDE.md 地雷4)
type Fiber = any;

/**
 * MUI テーマのダックタイピング判定。Provider の tag/type は React バージョン差が
 * あるため見ず、context 値の形だけで判定する。通常テーマ = palette + typography +
 * shape、CssVarsProvider (v5 experimental / v6) は colorSchemes を持つ。
 */
export function isMuiThemeLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  const obj = (v: unknown) => v !== null && typeof v === 'object';
  if (!obj(t.typography) || !obj(t.shape)) return false;
  return obj(t.palette) || obj(t.colorSchemes);
}

/** 下り走査のノード上限 (Provider はルート近傍にあるのが通例。巨大アプリでの暴走防止) */
const MAX_VISITS = 5000;
/** return チェーン遡上の上限 (循環した Fiber でハングしないための保険) */
const MAX_ANCESTORS = 1000;

/** start 以下を DFS し、context Provider の value がテーマ形なら返す */
function searchDown(start: Fiber): unknown | null {
  let visits = 0;
  let node: Fiber = start;
  while (node && visits < MAX_VISITS) {
    visits += 1;
    const value = node.memoizedProps?.value;
    if (isMuiThemeLike(value)) return value;
    if (node.child) {
      node = node.child;
      continue;
    }
    while (node && node !== start && !node.sibling) {
      node = node.return;
    }
    if (!node || node === start) return null;
    node = node.sibling;
  }
  return null;
}

/** commit 済み FiberRoot 群からテーマを探す (最初に見つかった = 最外の Provider) */
export function findMuiTheme(roots: Set<unknown>): unknown | null {
  for (const root of roots) {
    const current: Fiber = (root as Fiber)?.current;
    if (!current) continue;
    const found = searchDown(current);
    if (found) return found;
  }
  return null;
}

/** 要素自身が持つ React 内部キー (__reactFiber$ / __reactContainer$) を直接読む */
function ownFiber(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$')) {
      return (el as any)[key];
    }
  }
  return null;
}

/**
 * DOM からの後備: 文書順の先頭要素群 (React ルートコンテナは通常浅い) から Fiber を
 * 拾い、return チェーンを遡って祖先 Provider を判定する。見つからなければ最上位
 * Fiber から下り走査する (Provider が別サブツリー側にある場合)。
 */
export function findMuiThemeFromDom(doc: Document = document): unknown | null {
  const body = doc.body;
  if (!body) return null;
  // 全要素の配列を作らずに先頭 200 要素だけ見る (巨大ページでの確保コストを避ける)
  const els: Element[] = [body];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  while (els.length <= 200 && walker.nextNode()) els.push(walker.currentNode as Element);
  // 同じ React ルートに属する要素が続くのが通例なので、下り走査は根ごとに 1 回だけ行う
  const searchedTops = new Set<Fiber>();
  for (const el of els) {
    const fiber = ownFiber(el);
    if (!fiber) continue;
    let node: Fiber = fiber;
    let top: Fiber = fiber;
    let hops = 0;
    while (node && hops < MAX_ANCESTORS) {
      const value = node.memoizedProps?.value;
      if (isMuiThemeLike(value)) return value;
      top = node;
      node = node.return;
      hops += 1;
    }
    if (searchedTops.has(top)) continue;
    searchedTops.add(top);
    const found = searchDown(top);
    if (found) return found;
  }
  return null;
}
