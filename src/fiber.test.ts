// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  getFiberName,
  getHostElementOfFiber,
  getParentComponentElement,
  inspectElement,
  resolveJumpTarget,
  summarizeProps,
} from './fiber';

type Fiber = Record<string, unknown>;

const src = (fileName: string, lineNumber = 1, columnNumber = 1) => ({
  fileName,
  lineNumber,
  columnNumber,
});

/** DOM 要素に React の __reactFiber$ キーで fiber を紐づける */
function attach(el: Element, fiber: Fiber) {
  (el as unknown as Record<string, unknown>)['__reactFiber$test'] = fiber;
}

describe('resolveJumpTarget', () => {
  it('muiSkip=true は node_modules ソースを飛ばして最初のアプリコードを返す', () => {
    const chain = [
      { _debugSource: src('/p/node_modules/@mui/material/Button/Button.js', 5) },
      { _debugSource: src('/p/src/App.tsx', 12) },
    ];
    expect(resolveJumpTarget(chain, true)?.lineNumber).toBe(12);
  });

  it('muiSkip=true でも全て node_modules なら先頭にフォールバックする', () => {
    const chain = [
      { _debugSource: src('/p/node_modules/@mui/material/Card/Card.js', 3) },
      { _debugSource: src('/p/node_modules/@mui/material/Paper/Paper.js', 7) },
    ];
    expect(resolveJumpTarget(chain, true)?.lineNumber).toBe(3);
  });

  it('muiSkip=false は node_modules でも先頭を返す', () => {
    const chain = [
      { _debugSource: src('/p/node_modules/@mui/material/Button/Button.js', 5) },
      { _debugSource: src('/p/src/App.tsx', 12) },
    ];
    expect(resolveJumpTarget(chain, false)?.lineNumber).toBe(5);
  });

  it('ソースが無ければ null', () => {
    expect(resolveJumpTarget([{}, {}], true)).toBeNull();
    expect(resolveJumpTarget([], false)).toBeNull();
  });
});

describe('getFiberName', () => {
  it('host は type 文字列、関数は displayName/name を返す', () => {
    expect(getFiberName({ type: 'div' })).toBe('div');
    function Card() {}
    expect(getFiberName({ type: Card })).toBe('Card');
    const Named = () => null;
    (Named as { displayName?: string }).displayName = 'MyCard';
    expect(getFiberName({ type: Named })).toBe('MyCard');
  });

  it('forwardRef / memo を解決する', () => {
    const fwd = { render: function Inner() {} };
    expect(getFiberName({ type: fwd })).toBe('Inner');
    function Base() {}
    expect(getFiberName({ type: { type: Base } })).toBe('Base');
  });
});

describe('summarizeProps', () => {
  it('primitive props を優先キー順に、children/className/style/sx を除いて要約', () => {
    const fiber = {
      memoizedProps: {
        children: 'x',
        className: 'c',
        onClick: () => {},
        title: 'Hello',
        variant: 'contained',
        color: 'primary',
      },
    };
    const out = summarizeProps(fiber);
    expect(out.children).toBeUndefined();
    expect(out.className).toBeUndefined();
    expect(out.onClick).toBeUndefined(); // 関数は除外
    // variant/color は PRIORITY_PROPS なので先に来る
    expect(Object.keys(out).slice(0, 2).sort()).toEqual(['color', 'variant']);
    expect(out.title).toBe('"Hello"');
  });

  it('最大件数を超えない', () => {
    const props: Record<string, string> = {};
    for (let i = 0; i < 10; i++) props[`p${i}`] = `v${i}`;
    expect(Object.keys(summarizeProps({ memoizedProps: props }, 3))).toHaveLength(3);
  });
});

describe('getHostElementOfFiber', () => {
  it('最初の host 子孫の DOM 要素を返す (兄弟バックトラック含む)', () => {
    const div = document.createElement('div');
    // component -> (composite child with no host) sibling -> host span
    const emptyComposite = { tag: 0, type: function Empty() {}, child: null, sibling: null };
    const hostSpan = { tag: 5, type: 'span', stateNode: div, child: null, sibling: null };
    (emptyComposite as Fiber).sibling = hostSpan;
    const parent = { tag: 0, type: function P() {}, child: emptyComposite };
    expect(getHostElementOfFiber(parent)).toBe(div);
  });
});

describe('getParentComponentElement', () => {
  it('子要素から 1 つ外側のコンポーネントの host 要素へ遡る', () => {
    const cardDiv = document.createElement('div');
    const contentSpan = document.createElement('span');
    cardDiv.appendChild(contentSpan);
    document.body.appendChild(cardDiv);

    const cardFiber: Fiber = { tag: 0, type: function Card() {} };
    const cardHost: Fiber = { tag: 5, type: 'div', stateNode: cardDiv, return: cardFiber };
    const contentFiber: Fiber = { tag: 0, type: function CardContent() {}, return: cardHost };
    const contentHost: Fiber = {
      tag: 5,
      type: 'span',
      stateNode: contentSpan,
      return: contentFiber,
    };
    cardFiber.child = cardHost;
    cardHost.child = contentFiber;
    contentFiber.child = contentHost;
    attach(contentSpan, contentHost);
    attach(cardDiv, cardHost);

    expect(getParentComponentElement(contentSpan)).toBe(cardDiv);
  });

  // 不変条件: ↑ で返る host は必ず現在要素の DOM 祖先 (host.contains(base))。
  // getHostElementOfFiber は component subtree の DFS 最初の host を返すため、
  // 別サブツリーの host (現在要素を包含しない) を拾いうる。その場合に誤ジャンプせず
  // スキップ (= null) することを固定する。a7346c5 と同類型「Fiber は取れるが誤答」の予防。
  it('包含しない host (別サブツリー) は返さず、DOM 祖先でなければ null', () => {
    const child = document.createElement('span');
    document.body.appendChild(child);
    // 別サブツリーの要素 (child を包含しない)
    const lone = document.createElement('div');
    document.body.appendChild(lone);

    const childComp: Fiber = { tag: 0, type: function Inner() {} };
    const childHost: Fiber = { tag: 5, type: 'span', stateNode: child, return: childComp };
    childComp.child = childHost;
    // outerComp の最初の host は lone (child を包含しない)
    const loneHost: Fiber = { tag: 5, type: 'div', stateNode: lone };
    const outerComp: Fiber = { tag: 0, type: function Outer() {}, child: loneHost };
    childComp.return = outerComp;
    attach(child, childHost);

    // outerComp の host=lone は child を包含しないので採用されず、祖先が無いため null
    expect(getParentComponentElement(child)).toBeNull();
  });
});

describe('inspectElement', () => {
  it('セマンティック名を解決し、内部名を internalName に退避する', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const cardFiber: Fiber = {
      tag: 0,
      type: function Card() {},
      _debugSource: src('/src/SurfacesPage.tsx', 218),
      _debugOwner: null,
      memoizedProps: { variant: 'outlined' },
    };
    // 内部 styled スロット (node_modules) が最近傍コンポーネント
    const styledFiber: Fiber = {
      tag: 0,
      type: function MuiCardContentRoot() {},
      _debugSource: src('/p/node_modules/@mui/material/Card/Card.js', 3),
      _debugOwner: cardFiber,
      memoizedProps: {},
      return: null,
    };
    const host: Fiber = { tag: 5, type: 'div', stateNode: div, return: styledFiber };
    attach(div, host);

    const info = inspectElement(div, true);
    expect(info?.name).toBe('Card');
    expect(info?.internalName).toBe('MuiCardContentRoot');
    expect(info?.jumpTarget?.lineNumber).toBe(218);
    expect(info?.devMode).toBe(true);
  });

  it('React fiber が無い素の DOM は design-only 情報を返す (非 React サイト対応)', () => {
    const orphan = document.createElement('section');
    document.body.appendChild(orphan);
    const info = inspectElement(orphan, true);
    expect(info).not.toBeNull();
    expect(info?.isReact).toBe(false);
    expect(info?.name).toBe('section');
    expect(info?.jumpTarget).toBeNull();
    expect(info?.ownerChain).toEqual([]);
    expect(Array.isArray(info?.design)).toBe(true); // computed style は取得される
  });

  // 4象限 (React有無 × dev/prod) のうち「React有 × production」を固定。
  // production ビルドは _debugOwner/_debugSource が剥がれる → safeMode に縮退し、
  // devMode:false / jumpTarget:null でも design 配列は必ず取得できる (デザイナー主価値の不変条件)。
  it('production 相当 fiber (_debug* なし) は safeMode に縮退し design は保つ', () => {
    const el = document.createElement('div');
    el.className = 'MuiButton-root';
    document.body.appendChild(el);
    // component fiber だが _debugOwner も _debugSource も無い = production 剥離相当
    const comp: Fiber = { tag: 0, type: function Button() {} };
    const host: Fiber = { tag: 5, type: 'div', stateNode: el, return: comp };
    comp.child = host;
    attach(el, host);

    const info = inspectElement(el, true);
    expect(info?.isReact).toBe(true);
    expect(info?.devMode).toBe(false); // dev フィールドが無い
    expect(info?.jumpTarget).toBeNull(); // ソース位置は取れない
    expect(info?.classification).toBe('mui'); // Mui* クラスから推定
    expect(info?.name).toBe('MuiButton');
    expect(Array.isArray(info?.design)).toBe(true); // design は常に取得できる
  });
});
