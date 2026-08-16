// @vitest-environment happy-dom
// buildTree は fiber.stateNode instanceof Element と document.contains を使うため DOM 環境が要る
import { describe, expect, it } from 'vitest';
import {
  buildNodeElementMap,
  buildTree,
  filterTree,
  resolveNodeIdFromElement,
  type TreeNode,
} from './tree';

type Fiber = Record<string, unknown>;

/** 最小の mock fiber。tag/type/stateNode/child/sibling のみ持つ */
function mk(
  tag: number,
  type: unknown,
  opts: { stateNode?: unknown; child?: Fiber | null; sibling?: Fiber | null } = {},
): Fiber {
  return {
    tag,
    type,
    stateNode: opts.stateNode ?? null,
    child: opts.child ?? null,
    sibling: opts.sibling ?? null,
  };
}

const root = (current: Fiber) => ({ current });
const source = (...roots: unknown[]) => ({ roots: new Set(roots) });
const liveHost = (tagName: string) => {
  const el = document.createElement(tagName);
  document.body.appendChild(el);
  return el;
};
const byName = (nodes: TreeNode[], name: string) => nodes.find((n) => n.name === name);

describe('buildTree', () => {
  it('物理階層 child/sibling から親子・depth を組み立てる', () => {
    // App(0) > div(5, live) > span(5, live)
    const span = mk(5, 'span', { stateNode: liveHost('span') });
    const div = mk(5, 'div', { stateNode: liveHost('div'), child: span });
    const app = mk(0, function App() {}, { child: div });

    const nodes = buildTree(source(root(app)));
    const a = byName(nodes, 'App')!;
    const d = byName(nodes, 'div')!;
    const s = byName(nodes, 'span')!;

    expect(a.depth).toBe(0);
    expect(a.parentId).toBeNull();
    expect(d.depth).toBe(1);
    expect(d.parentId).toBe(a.id);
    expect(s.depth).toBe(2);
    expect(s.parentId).toBe(d.id);
    expect(a.childIds).toEqual([d.id]);
    expect(d.childIds).toEqual([s.id]);
    // host fiber は自身の DOM 要素、composite は null
    expect(d.hostElement).toBe(div.stateNode);
    expect(a.hostElement).toBeNull();
  });

  it('sibling を出現順に childIds へ並べる', () => {
    const c1 = mk(5, 'span', { stateNode: liveHost('span') });
    const c2 = mk(5, 'p', { stateNode: liveHost('p') });
    c1.sibling = c2;
    const div = mk(5, 'div', { stateNode: liveHost('div'), child: c1 });
    const app = mk(0, function App() {}, { child: div });

    const nodes = buildTree(source(root(app)));
    const d = byName(nodes, 'div')!;
    expect(d.childIds.map((id) => nodes.find((n) => n.id === id)!.name)).toEqual(['span', 'p']);
  });

  it('detached root (host が document 外) はツリーから丸ごと除外する', () => {
    // root1: host は document に append しない → detached
    const detached = document.createElement('div'); // 未 append
    const app1 = mk(0, function App1() {}, {
      child: mk(5, 'div', { stateNode: detached }),
    });
    // root2: live
    const app2 = mk(0, function App2() {}, {
      child: mk(5, 'section', { stateNode: liveHost('section') }),
    });

    const nodes = buildTree(source(root(app1), root(app2)));
    expect(byName(nodes, 'App1')).toBeUndefined();
    expect(byName(nodes, 'App2')).toBeDefined();
    expect(byName(nodes, 'section')).toBeDefined();
  });

  it('host を全く持たない root は判定不能として残す', () => {
    const app = mk(0, function Pure() {}, { child: mk(0, function Inner() {}) });
    const nodes = buildTree(source(root(app)));
    expect(byName(nodes, 'Pure')).toBeDefined();
    expect(byName(nodes, 'Inner')).toBeDefined();
  });

  it('循環 (child が祖先を指す) で無限ループしない', () => {
    const a = mk(0, function A() {});
    const b = mk(0, function B() {});
    a.child = b;
    b.child = a; // A へ戻る循環
    const nodes = buildTree(source(root(a)));
    // visited で 1 度だけ訪問 → 2 ノードで終了 (ハングしない)
    expect(nodes.map((n) => n.name).sort()).toEqual(['A', 'B']);
  });

  it('roots が空なら空配列', () => {
    expect(buildTree(source())).toEqual([]);
    expect(buildTree(source(root(undefined as never)))).toEqual([]);
  });
});

/** filterTree 用に TreeNode を直接組む (buildTree 非依存の純ロジックテスト) */
function tn(id: number, fiberTag: number, name: string, parentId: number | null): TreeNode {
  return {
    id,
    fiberTag,
    name,
    classification: 'custom',
    hostElement: null,
    depth: 0,
    parentId,
    childIds: [],
  };
}
const find = (nodes: TreeNode[], name: string) => nodes.find((n) => n.name === name);

describe('filterTree', () => {
  it('Provider/Consumer/Fragment/Mode を隠し、子を最近傍の可視祖先へ付け替える', () => {
    // App(0) > Provider(10) > Fragment(7) > Child(0)
    const nodes = [
      tn(0, 0, 'App', null),
      tn(1, 10, 'Ctx.Provider', 0),
      tn(2, 7, 'Fragment', 1),
      tn(3, 0, 'Child', 2),
    ];
    const out = filterTree(nodes);
    expect(out.map((n) => n.name).sort()).toEqual(['App', 'Child']);
    const child = find(out, 'Child')!;
    const app = find(out, 'App')!;
    expect(child.parentId).toBe(app.id); // Provider/Fragment を飛ばして App 直下へ
    expect(child.depth).toBe(1);
    expect(app.childIds).toEqual([child.id]);
  });

  it('hideHostComponents=true で Host/HostText を隠しコンポーネントだけ残す', () => {
    // App(0) > div(5) > Button(0) > span(5)
    const nodes = [
      tn(0, 0, 'App', null),
      tn(1, 5, 'div', 0),
      tn(2, 0, 'Button', 1),
      tn(3, 5, 'span', 2),
    ];
    const out = filterTree(nodes, { hideHostComponents: true });
    expect(out.map((n) => n.name).sort()).toEqual(['App', 'Button']);
    expect(find(out, 'Button')!.parentId).toBe(find(out, 'App')!.id);
  });

  it('既定では Host を残す', () => {
    const nodes = [tn(0, 0, 'App', null), tn(1, 5, 'div', 0)];
    expect(filterTree(nodes).map((n) => n.name).sort()).toEqual(['App', 'div']);
  });

  it('styled ラッパー (Styled( 始まり) を隠す', () => {
    const nodes = [
      tn(0, 0, 'App', null),
      tn(1, 0, 'Styled(Button)', 0),
      tn(2, 0, 'Label', 1),
    ];
    const out = filterTree(nodes);
    expect(find(out, 'Styled(Button)')).toBeUndefined();
    expect(find(out, 'Label')!.parentId).toBe(find(out, 'App')!.id);
  });

  it('純関数: 入力を破壊しない', () => {
    const nodes = [tn(0, 0, 'App', null), tn(1, 10, 'Provider', 0), tn(2, 0, 'C', 1)];
    const snapshot = JSON.parse(JSON.stringify(nodes));
    filterTree(nodes);
    expect(nodes).toEqual(snapshot); // 元配列・各ノードが不変
  });
});

describe('buildNodeElementMap / resolveNodeIdFromElement', () => {
  const withHost = (id: number, fiberTag: number, name: string, parentId: number | null, host: Element | null) => ({
    ...tn(id, fiberTag, name, parentId),
    hostElement: host,
    childIds: [] as number[],
  });

  it('host ノードは自身、composite は代表(最近傍子孫 host)を割当', () => {
    const divEl = document.createElement('div');
    const spanEl = document.createElement('span');
    // App(0,host無) > div(5,host=divEl) > span(5,host=spanEl)
    const app = withHost(0, 0, 'App', null, null);
    const div = withHost(1, 5, 'div', 0, divEl);
    const span = withHost(2, 5, 'span', 1, spanEl);
    app.childIds = [1];
    div.childIds = [2];
    const { nodeToElement, elementToNode } = buildNodeElementMap([app, div, span]);

    expect(nodeToElement.get(1)).toBe(divEl);
    expect(nodeToElement.get(2)).toBe(spanEl);
    // composite App の代表は最近傍子孫 host = divEl
    expect(nodeToElement.get(0)).toBe(divEl);
    // 逆引き
    expect(elementToNode.get(divEl)).toBe(1);
    expect(elementToNode.get(spanEl)).toBe(2);
  });

  it('実 DOM 要素から最近傍のツリーノード id を解決 / 該当なしは null', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('span');
    const leaf = document.createElement('b'); // map に無い深い子
    inner.appendChild(leaf);
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const elementToNode = new Map<Element, number>([
      [outer, 10],
      [inner, 20],
    ]);
    // leaf は map に無い → 祖先 inner(20) が最近傍
    expect(resolveNodeIdFromElement(leaf, elementToNode)).toBe(20);
    // inner 自身 → 20
    expect(resolveNodeIdFromElement(inner, elementToNode)).toBe(20);
    // 無関係な要素 → null
    expect(resolveNodeIdFromElement(document.createElement('p'), elementToNode)).toBeNull();
  });
});

describe('host を隠したツリーと要素対応の関係 (回帰防止)', () => {
  // hostElement を持つのは host ノードだけ。したがって filterTree で host を隠した結果から
  // buildNodeElementMap を作ると対応が空になり、ツリー ⇔ DOM の双方向連動が死ぬ。
  // treeView は「表示はフィルタ後 / 対応はフィルタ前」で作る必要がある。
  const host = document.createElement('div');

  const nodes = [
    { id: 0, fiberTag: 1, name: 'App', classification: 'custom' as const,
      hostElement: null, depth: 0, parentId: null, childIds: [1] },
    { id: 1, fiberTag: 5, name: 'div', classification: 'third-party' as const,
      hostElement: host, depth: 1, parentId: 0, childIds: [] },
  ];

  it('フィルタ後から対応を作ると空になる (これをやってはいけない)', () => {
    const filtered = filterTree(nodes, { hideHostComponents: true });
    expect(filtered.some((n) => n.hostElement)).toBe(false);
    const map = buildNodeElementMap(filtered);
    expect(map.elementToNode.size).toBe(0);
    expect(map.nodeToElement.size).toBe(0);
  });

  it('フィルタ前から作れば、host を隠しても composite に代表要素が割り当たる', () => {
    const map = buildNodeElementMap(nodes);
    expect(map.elementToNode.get(host)).toBe(1);
    // App (composite) は子孫 host を代表として持つ → 行 hover でハイライトできる
    expect(map.nodeToElement.get(0)).toBe(host);
  });

  it('DOM から解決した id が非表示でも、親を辿れば表示ノードに行き着く', () => {
    const filtered = filterTree(nodes, { hideHostComponents: true });
    const visible = new Set(filtered.map((n) => n.id));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let id: number | null = resolveNodeIdFromElement(host, buildNodeElementMap(nodes).elementToNode);
    expect(id).toBe(1);
    expect(visible.has(id!)).toBe(false); // host は非表示
    while (id !== null && !visible.has(id)) id = byId.get(id)?.parentId ?? null;
    expect(id).toBe(0); // App まで繰り上がる
  });
});
