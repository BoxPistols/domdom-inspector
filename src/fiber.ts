import { classify } from './classify';
import { extractDesignStyle } from './designStyle';
import { authoredFrames, pickAuthoredFrame, stackStringOf } from './ownerStack';
import { isNodeModulesPath, normalizeSourcePath, parseStackLocation } from './source';
import type { Classification, InspectInfo, OwnerEntry, SourceLocation } from './types';

// React の Fiber tag (dev/prod 共通の内部定数)。値は React の WorkTag に対応:
// FunctionComponent / ClassComponent / ForwardRef / MemoComponent / SimpleMemoComponent
const TAG_FUNCTION_COMPONENT = 0;
const TAG_CLASS_COMPONENT = 1;
const TAG_FORWARD_REF = 11;
const TAG_MEMO_COMPONENT = 14;
const TAG_SIMPLE_MEMO_COMPONENT = 15;

export const COMPONENT_TAGS = new Set([
  TAG_FUNCTION_COMPONENT,
  TAG_CLASS_COMPONENT,
  TAG_FORWARD_REF,
  TAG_MEMO_COMPONENT,
  TAG_SIMPLE_MEMO_COMPONENT,
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
    // **parentElement だけで遡らない。** shadow root の直下では parentElement が null に
    // なるため、web component 内の要素が React アプリ上でも「React ではない」と誤答した
    // (インスペクタは open shadow を貫通して最内要素を選べるので、この経路は普通に踏む)。
    // ホストへ抜けて遡りを続ける。
    node = node.parentElement ?? hostOf(node);
  }
  return null;
}

/** node が shadow root 直下なら、その root のホスト要素 (無ければ null) */
function hostOf(node: Element): Element | null {
  const root = node.getRootNode?.();
  return root && root !== document && 'host' in root ? ((root as ShadowRoot).host ?? null) : null;
}

/**
 * ページに React があるか / dev ビルドかを **DOM 側から** 判定する。
 *
 * グローバルフックを自分では設置しない (React DevTools を沈黙させるため) 一方で、
 * モード ON の説明文は「dev / production / React 無し」を区別しなければならない
 * (取り違えると理由が嘘になる)。`__reactFiber$` は DevTools と無関係に React が必ず
 * 付けるので、これを直接探すのが最も確実。
 *
 * 先頭の限られた要素だけ見る (巨大ページでの暴走防止)。React があるページなら
 * ルート近傍の要素が既に Fiber を持っているため、この範囲で足りる。
 */
export function detectReactOnPage(
  doc: Document = document,
  maxElements = 200,
): { hasReact: boolean; devMode: boolean } {
  const body = doc.body;
  if (!body) return { hasReact: false, devMode: false };
  let seen = 0;
  let node: Element | null = body;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  while (node && seen < maxElements) {
    const fiber = getFiberFromElement(node);
    if (fiber) {
      // dev ビルドは _debugOwner / _debugSource を持つ (production では剥離される)。
      // host fiber 自身に無くても、コンポーネント Fiber 側にあることがある
      const component = getNearestComponentFiber(fiber);
      const devMode =
        '_debugOwner' in fiber ||
        fiber._debugSource != null ||
        (!!component && ('_debugOwner' in component || component._debugSource != null));
      return { hasReact: true, devMode };
    }
    seen += 1;
    node = walker.nextNode() as Element | null;
  }
  return { hasReact: false, devMode: false };
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
  // **React 内部のフレームを名前で落とす。** URL だけで判定すると取りこぼす —
  // Turbopack はチャンク名にライブラリ名を残さない (実測: React 本体が
  // `_0ro62as._.js` という名前で出るため `react-dom` の除外に当たらず、
  // **jsxDEV のフレーム = React の内部**をジャンプ先にしてしまっていた)
  const stackString = stackStringOf(fiber?._debugStack);
  if (stackString) {
    const frame = pickAuthoredFrame(stackString);
    if (frame) {
      return { fileName: frame.url, lineNumber: frame.line, columnNumber: frame.column };
    }
    // 名前で判別できない形の stack は従来の経路へ (取りこぼすより弱い判定でも拾う)
    return parseStackLocation(stackString);
  }
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
/**
 * ジャンプ先の**候補**をバンドル座標のまま並べる (解決は click 時に非同期で行う)。
 *
 * 順序が肝: **要素自身 → owner チェーン**。
 * - 要素自身の Owner Stack が最も正確 (その JSX が書かれた行そのもの)
 * - ただし React は実捕捉を先頭 1 万要素までに制限しており、超えると
 *   **React 内部の共有スタック**が入る。そのときは要素自身から何も得られないので、
 *   owner チェーン (そのコンポーネントが書かれた場所) へ落とす。
 *   1 段浅いが**利用者のコードではある** — React の実装を開くよりはるかに良い
 *   (2026-08-17 の実機報告: `react-jsx-dev-runtime.development.js` が開いた)
 */
export function ownerStackCandidates(hostFiber: Fiber, chain: Fiber[] = []): SourceLocation[] {
  const out: SourceLocation[] = [];
  const seen = new Set<string>();
  const push = (stack: string | null) => {
    if (!stack) return;
    for (const f of authoredFrames(stack)) {
      const key = `${f.url}:${f.line}:${f.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ fileName: f.url, lineNumber: f.line, columnNumber: f.column });
    }
  };
  push(stackStringOf(hostFiber?._debugStack));
  for (const fiber of chain) push(stackStringOf(fiber?._debugStack));
  return out.slice(0, 12);
}

export function resolveJumpTarget(
  chain: Fiber[],
  muiSkip: boolean,
  hostFiber?: Fiber,
): SourceLocation | null {
  // **React 19 では要素自身の fiber を優先する。**
  //
  // `_debugSource` (React 18 以前) は「そのコンポーネントの JSX callsite」だったので、
  // owner チェーンを辿るのが正しかった。Owner Stacks (React 19) の `_debugStack` は
  // 意味が違い「**その要素の JSX が作られた場所**」を指す。したがって
  // `<Page>` の fiber を見ると「フレームワークが `<Page/>` を作った場所」になる。
  //
  // 実測 (2026-08-16, Next.js 16 + React 19 + Turbopack、拡張を積んだ実ブラウザ):
  // `<img>` を ⌘Click したのに `next/src/client/components/client-page.tsx:56` が開いた。
  // 正解は利用者の `app/page.tsx:12` で、それは**要素自身の fiber** の stack にあった。
  //
  // muiSkip が真のときは従来どおりチェーンを優先する (ライブラリ内部の JSX ではなく、
  // 利用者が書いた callsite へ飛ばすための機能なので、意図が逆になる)
  if (hostFiber && !hostFiber._debugSource) {
    const own = getFiberSource(hostFiber);
    if (own && !(muiSkip && isNodeModulesPath(normalizeSourcePath(own.fileName)))) {
      return own;
    }
  }
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
    design: extractDesignStyle(element),
    classification: muiClass ? 'mui' : 'third-party',
    props: {},
    jumpTarget: null,
    ownerChain: [],
    devMode: false,
    isReact: true,
  };
}

/**
 * 非 React の素の DOM 要素向け (フレームワーク非依存デザイン検査)。
 * React Fiber が無い要素・非 React サイトでも、computed style ベースのデザイン情報を返す。
 * デザイナーが「あらゆるデプロイ済みサイト」の見た目を検査できるようにする。
 */
function domOnlyInfo(element: Element): InspectInfo {
  return {
    name: element.tagName.toLowerCase(),
    internalName: null,
    design: extractDesignStyle(element),
    classification: 'third-party',
    props: {},
    jumpTarget: null,
    ownerChain: [],
    devMode: false,
    isReact: false,
  };
}

/** ホバー要素 1 つ分の InspectInfo を組み立てるエントリポイント */
export function inspectElement(element: Element, muiSkip: boolean): InspectInfo | null {
  const hostFiber = getFiberFromElement(element);
  if (!hostFiber) return domOnlyInfo(element);

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
    // detailed バッジ用に多めに収集し、表示側 (overlay) が detail に応じてスライスする
    props: summarizeProps(semanticFiber ?? componentFiber, 10),
    jumpTarget: resolveJumpTarget(chain, muiSkip, hostFiber),
    jumpCandidates: ownerStackCandidates(hostFiber, chain),
    ownerChain,
    devMode: true,
    isReact: true,
    design: extractDesignStyle(element),
  };
}
