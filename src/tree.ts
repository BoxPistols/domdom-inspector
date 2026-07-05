import { classify } from './classify';
import { getFiberName, getFiberSource } from './fiber';
import { normalizeSourcePath } from './source';
import type { Classification } from './types';

type Fiber = any;

/** ビジュアルツリーの 1 ノード (物理階層 child/sibling 由来) */
export interface TreeNode {
  id: number;
  /** React WorkTag (HostComponent=5, Fragment=7, ContextProvider=10 等) */
  fiberTag: number;
  name: string;
  classification: Classification;
  /** この fiber 自身が host のとき対応する DOM 要素。composite は null */
  hostElement: Element | null;
  depth: number;
  parentId: number | null;
  childIds: number[];
}

/** buildTree が必要とする HookState の最小形 */
export interface TreeSource {
  roots: Set<unknown>;
}

function nodeName(fiber: Fiber): string {
  return getFiberName(fiber) ?? (typeof fiber.type === 'string' ? fiber.type : 'Anonymous');
}

function nodeClassification(fiber: Fiber, hostElement: Element | null): Classification {
  const source = getFiberSource(fiber);
  return classify(
    getFiberName(fiber),
    source ? normalizeSourcePath(source.fileName) : null,
    hostElement ? Array.from(hostElement.classList) : [],
  );
}

/**
 * 全 root から物理階層 (child/sibling/return) を歩いてツリーモデルを構築する。
 *
 * - 論理レンダー元 (_debugOwner) ではなく物理 child/sibling を辿る。同一ドキュメント内の
 *   Portal は Fiber child/sibling が境界を越えて論理親子を保持するため自然に繋がる。
 * - hook.roots は unmount で削除されず stale root が混入し得る。root ごとに walk して、
 *   その部分木の host 要素が 1 つも document 内に無ければ (= detached) 丸ごと除外する。
 * - 異常な循環 (child が祖先を指す等) は visited WeakSet で無限ループを防ぐ。
 */
export function buildTree(source: TreeSource): TreeNode[] {
  const result: TreeNode[] = [];
  let idSeq = 0;

  for (const root of source.roots) {
    const rootFiber: Fiber = (root as { current?: Fiber })?.current;
    if (!rootFiber || typeof rootFiber !== 'object') continue;

    // この root 部分木を一旦ローカルに集約し、live 判定後に採否を決める
    const local: TreeNode[] = [];
    const localById = new Map<number, TreeNode>();
    const visited = new WeakSet<object>();
    let anyHost = false;
    let anyHostInDoc = false;

    const stack: { fiber: Fiber; parentId: number | null; depth: number }[] = [
      { fiber: rootFiber, parentId: null, depth: 0 },
    ];
    while (stack.length) {
      const { fiber, parentId, depth } = stack.pop()!;
      if (!fiber || typeof fiber !== 'object' || visited.has(fiber)) continue;
      visited.add(fiber);

      const hostElement =
        typeof fiber.type === 'string' && fiber.stateNode instanceof Element
          ? (fiber.stateNode as Element)
          : null;
      if (hostElement) {
        anyHost = true;
        if (document.contains(hostElement)) anyHostInDoc = true;
      }

      const node: TreeNode = {
        id: idSeq++,
        fiberTag: fiber.tag,
        name: nodeName(fiber),
        classification: nodeClassification(fiber, hostElement),
        hostElement,
        depth,
        parentId,
        childIds: [],
      };
      local.push(node);
      localById.set(node.id, node);
      if (parentId !== null) localById.get(parentId)?.childIds.push(node.id);

      // 子を child→sibling で列挙し、逆順で積んで元の順序で処理する
      const children: Fiber[] = [];
      let c = fiber.child;
      while (c) {
        children.push(c);
        c = c.sibling;
      }
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ fiber: children[i], parentId: node.id, depth: depth + 1 });
      }
    }

    // detached root 除外: host を持つのに 1 つも document 内に無ければ捨てる。
    // host を全く持たない root (描画前など) は判定不能として残す。
    if (anyHost && !anyHostInDoc) continue;
    result.push(...local);
  }

  return result;
}

// ノイズ抑制で常に隠す WorkTag: HostRoot=3 / Fragment=7 / Mode=8 /
// ContextConsumer=9 / ContextProvider=10
const WRAPPER_TAGS = new Set([3, 7, 8, 9, 10]);
// HostComponent=5 / HostText=6 (hideHostComponents 時のみ隠す)
const HOST_TAGS = new Set([5, 6]);

export interface FilterOptions {
  /** HostComponent / HostText を折りたたむ (既定 false = host も表示) */
  hideHostComponents?: boolean;
}

/**
 * ツリーのノイズ抑制 (FR-06)。純関数で新配列を返す (入力は不変)。
 * - WRAPPER_TAGS (Provider/Consumer/Fragment/Mode/HostRoot) と styled ラッパー
 *   (name が "Styled(" 始まり) を常に隠す。
 * - hideHostComponents=true で Host 系も隠す。
 * - 隠したノードの子は、最も近い「可視の祖先」へ付け替える (階層を潰さず引き上げ)。
 *   parentId / childIds / depth は可視ツリーで再計算する。
 */
export function filterTree(nodes: TreeNode[], options: FilterOptions = {}): TreeNode[] {
  const hideHost = options.hideHostComponents ?? false;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const isHidden = (n: TreeNode): boolean => {
    if (WRAPPER_TAGS.has(n.fiberTag)) return true;
    if (hideHost && HOST_TAGS.has(n.fiberTag)) return true;
    if (/^Styled\(/.test(n.name)) return true;
    return false;
  };

  // 最も近い可視の祖先 id (無ければ null)
  const visibleParentId = (n: TreeNode): number | null => {
    let p = n.parentId;
    while (p !== null) {
      const pn = byId.get(p);
      if (!pn) return null;
      if (!isHidden(pn)) return pn.id;
      p = pn.parentId;
    }
    return null;
  };

  // 可視ノードを元の順序を保って抽出し、親付け替え + childIds/depth 再計算
  const result: TreeNode[] = nodes
    .filter((n) => !isHidden(n))
    .map((n) => ({ ...n, parentId: visibleParentId(n), childIds: [] as number[] }));
  const resultById = new Map(result.map((n) => [n.id, n]));
  for (const n of result) {
    if (n.parentId !== null) resultById.get(n.parentId)?.childIds.push(n.id);
  }
  const depthOf = (n: TreeNode): number => {
    let d = 0;
    let p = n.parentId;
    while (p !== null) {
      const pn = resultById.get(p);
      if (!pn) break;
      d++;
      p = pn.parentId;
    }
    return d;
  };
  for (const n of result) n.depth = depthOf(n);
  return result;
}

export interface NodeElementMap {
  /** ノード id → ハイライト対象 DOM (composite は代表 host) */
  nodeToElement: Map<number, Element>;
  /** host DOM → その host ノード id (逆引き用) */
  elementToNode: Map<Element, number>;
}

/**
 * ツリーと DOM の双方向対応を作る (FR-07 の純ロジック部)。
 * - host ノードは自身の要素、host を持たない composite は最も近い子孫 host を代表として割当。
 * - childIds は buildTree/filterTree が作る非循環ツリーなので visited 不要。
 */
export function buildNodeElementMap(nodes: TreeNode[]): NodeElementMap {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeToElement = new Map<number, Element>();
  const elementToNode = new Map<Element, number>();

  for (const n of nodes) {
    if (n.hostElement) {
      nodeToElement.set(n.id, n.hostElement);
      if (!elementToNode.has(n.hostElement)) elementToNode.set(n.hostElement, n.id);
    }
  }

  // 最も近い子孫 host を BFS で探す (代表 host)
  const representativeHost = (n: TreeNode): Element | null => {
    const queue = [...n.childIds];
    while (queue.length) {
      const c = byId.get(queue.shift()!);
      if (!c) continue;
      if (c.hostElement) return c.hostElement;
      queue.push(...c.childIds);
    }
    return null;
  };
  for (const n of nodes) {
    if (!n.hostElement) {
      const rep = representativeHost(n);
      if (rep) nodeToElement.set(n.id, rep);
    }
  }

  return { nodeToElement, elementToNode };
}

/**
 * 実 DOM 要素から、それを内包する最近傍のツリーノード id を解決する。
 * DOM 祖先を遡り最初に elementToNode に載る要素のノードを返す。該当なしは null。
 */
export function resolveNodeIdFromElement(
  element: Element,
  elementToNode: Map<Element, number>,
): number | null {
  let el: Element | null = element;
  while (el) {
    const id = elementToNode.get(el);
    if (id !== undefined) return id;
    el = el.parentElement;
  }
  return null;
}
