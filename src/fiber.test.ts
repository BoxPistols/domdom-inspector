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

  it('React fiber が無ければ null', () => {
    const orphan = document.createElement('div');
    expect(inspectElement(orphan, true)).toBeNull();
  });
});
