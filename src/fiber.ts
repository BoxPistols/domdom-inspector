import { classify } from './classify';
import { isNodeModulesPath, normalizeSourcePath, parseStackLocation } from './source';
import type { Classification, InspectInfo, OwnerEntry, SourceLocation } from './types';

// React の Fiber tag (dev/prod 共通の内部定数)
const FunctionComponent = 0;
const ClassComponent = 1;
const ForwardRef = 11;
const MemoComponent = 14;
const SimpleMemoComponent = 15;

export const COMPONENT_TAGS = new Set([
  FunctionComponent,
  ClassComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
]);

type Fiber = any;

/** DOM 要素から React Fiber を取得 (見つかるまで祖先を遡る) */
export function getFiberFromElement(element: Element): Fiber | null {
  let node: Element | null = element;
  while (node) {
    for (const key of Object.keys(node)) {
      if (key.startsWith('__reactFiber$')) {
        return (node as any)[key];
      }
    }
    node = node.parentElement;
  }
  return null;
}

/** Fiber の表示名を解決する */
export function getFiberName(fiber: Fiber): string | null {
  const t = fiber?.type;
  if (typeof t === 'string') return t;
  if (typeof t === 'function') return t.displayName || t.name || null;
  if (t && typeof t === 'object') {
    if (t.displayName) return t.displayName;
    // forwardRef
    if (typeof t.render === 'function') {
      return t.render.displayName || t.render.name || 'ForwardRef';
    }
    // memo
    if (t.type) {
      return getFiberName({ type: t.type });
    }
  }
  return null;
}

/**
 * Fiber の JSX callsite を多層戦略で解決する (v2.0 §8):
 * 1. _debugSource (React <= 18 の dev ビルド)
 * 2. _debugStack (React 19: enableOwnerStacks で element 生成時に捕捉される Error)
 */
export function getFiberSource(fiber: Fiber): SourceLocation | null {
  const src = fiber?._debugSource;
  if (src?.fileName) {
    return {
      fileName: src.fileName,
      lineNumber: src.lineNumber ?? 1,
      columnNumber: src.columnNumber ?? 1,
    };
  }
  const stack: unknown = fiber?._debugStack;
  const stackString =
    typeof stack === 'string' ? stack : (stack as Error | undefined)?.stack;
  if (stackString) return parseStackLocation(stackString);
  return null;
}

/** host fiber から最も近いコンポーネント Fiber (Function/Class/ForwardRef/Memo) へ遡る */
export function getNearestComponentFiber(fiber: Fiber): Fiber | null {
  let node = fiber;
  while (node) {
    if (COMPONENT_TAGS.has(node.tag)) return node;
    node = node.return;
  }
  return null;
}

/** コンポーネント Fiber がレンダリングする最初の host 要素を DFS で探す */
export function getHostElementOfFiber(fiber: Fiber): Element | null {
  let node: Fiber = fiber.child;
  while (node) {
    if (typeof node.type === 'string' && node.stateNode instanceof Element) {
      return node.stateNode;
    }
    if (node.child) {
      node = node.child;
      continue;
    }
    // sibling が無ければ subtree を抜けない範囲で親へ戻る
    while (node && node !== fiber && !node.sibling) {
      node = node.return;
    }
    if (!node || node === fiber) return null;
    node = node.sibling;
  }
  return null;
}

/**
 * ↑ キーによる親コンポーネント選択: 現在要素を DOM として包含する
 * 「1 つ外側のコンポーネント」の host 要素を Fiber ツリーから返す。
 * 同じ DOM を包むだけの wrapper (styled スロット等) は読み飛ばす。
 */
export function getParentComponentElement(element: Element): Element | null {
  const hostFiber = getFiberFromElement(element);
  if (!hostFiber) return null;
  const base = hostFiber.stateNode instanceof Element ? hostFiber.stateNode : element;
  let node = (getNearestComponentFiber(hostFiber) ?? hostFiber).return;
  while (node) {
    if (COMPONENT_TAGS.has(node.tag)) {
      const host = getHostElementOfFiber(node);
      if (host && host !== base && host.contains(base)) return host;
    }
    node = node.return;
  }
  return null;
}

/** _debugOwner を遡って owner チェーンを収集する */
export function getOwnerChain(fiber: Fiber, limit = 20): Fiber[] {
  const chain: Fiber[] = [];
  let node = fiber;
  while (node && chain.length < limit) {
    if (COMPONENT_TAGS.has(node.tag)) chain.push(node);
    node = node._debugOwner;
  }
  return chain;
}

function classifyFiber(fiber: Fiber, element: Element | null): Classification {
  const source = getFiberSource(fiber);
  return classify(
    getFiberName(fiber),
    source ? normalizeSourcePath(source.fileName) : null,
    element ? Array.from(element.classList) : [],
  );
}

/**
 * ジャンプ先の決定 (FR-04 / FR-09)。
 * muiSkip 有効時は「callsite が node_modules 外」の最初の Fiber を owner チェーンから選ぶ。
 * 見つからなければソースを持つ最初の Fiber へフォールバック。
 */
export function resolveJumpTarget(chain: Fiber[], muiSkip: boolean): SourceLocation | null {
  if (muiSkip) {
    for (const fiber of chain) {
      const source = getFiberSource(fiber);
      if (source && !isNodeModulesPath(normalizeSourcePath(source.fileName))) {
        return source;
      }
    }
  }
  for (const fiber of chain) {
    const source = getFiberSource(fiber);
    if (source) return source;
  }
  return null;
}

const PRIORITY_PROPS = ['variant', 'color', 'size', 'severity', 'component'];

/** バッジ表示用に primitive props を要約する (FR-03) */
export function summarizeProps(fiber: Fiber, max = 4): Record<string, string> {
  const props = fiber?.memoizedProps;
  const out: Record<string, string> = {};
  if (!props || typeof props !== 'object') return out;
  const keys = Object.keys(props).sort(
    (a, b) =>
      (PRIORITY_PROPS.includes(a) ? 0 : 1) - (PRIORITY_PROPS.includes(b) ? 0 : 1),
  );
  for (const key of keys) {
    if (Object.keys(out).length >= max) break;
    if (key === 'children' || key === 'className' || key === 'style' || key === 'sx') continue;
    const value = props[key];
    if (typeof value === 'string') out[key] = JSON.stringify(value);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

/**
 * production ビルド向けセーフモード (FR-12):
 * Fiber の dev フィールドが無くても DOM の Mui* クラスから名前だけ推定する。
 */
function safeModeInfo(element: Element): InspectInfo {
  const muiClass = Array.from(element.classList).find((c) => /^Mui[A-Z][A-Za-z]*-/.test(c));
  const name = muiClass ? muiClass.split('-')[0] : element.tagName.toLowerCase();
  return {
    name,
    internalName: null,
    classification: muiClass ? 'mui' : 'third-party',
    props: {},
    jumpTarget: null,
    ownerChain: [],
    devMode: false,
  };
}

/** ホバー要素 1 つ分の InspectInfo を組み立てるエントリポイント */
export function inspectElement(element: Element, muiSkip: boolean): InspectInfo | null {
  const hostFiber = getFiberFromElement(element);
  if (!hostFiber) return null;

  const componentFiber = getNearestComponentFiber(hostFiber);
  if (!componentFiber) return safeModeInfo(element);

  // dev ビルド判定: _debugOwner フィールドの存在 (prod ビルドでは剥がされる)
  const devMode = '_debugOwner' in componentFiber || componentFiber._debugSource != null;
  if (!devMode) return safeModeInfo(element);

  const chain = getOwnerChain(componentFiber);
  const ownerChain: OwnerEntry[] = chain.map((fiber, i) => {
    const source = getFiberSource(fiber);
    return {
      name: getFiberName(fiber) ?? 'Anonymous',
      classification: classifyFiber(fiber, i === 0 ? element : null),
      source,
    };
  });

  // セマンティック名: callsite が node_modules 外の最初の owner (= ユーザーが JSX に書いた
  // コンポーネント)。MuiCardContentRoot のような内部 styled スロット名の代わりに
  // CardContent / Card を主名として表示し、ジャンプ先とバッジの意味を一致させる。
  const rawName = getFiberName(componentFiber) ?? 'Anonymous';
  const semanticFiber = chain.find((fiber) => {
    const source = getFiberSource(fiber);
    return source && !isNodeModulesPath(normalizeSourcePath(source.fileName));
  });
  const semanticName = semanticFiber ? getFiberName(semanticFiber) : null;
  const name = semanticName ?? rawName;

  return {
    name,
    internalName: name !== rawName ? rawName : null,
    classification: classifyFiber(componentFiber, element),
    props: summarizeProps(semanticFiber ?? componentFiber),
    jumpTarget: resolveJumpTarget(chain, muiSkip),
    ownerChain,
    devMode: true,
  };
}
