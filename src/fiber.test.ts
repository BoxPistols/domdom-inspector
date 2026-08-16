// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectReactOnPage,
  getFiberFromElement,
  getFiberName,
  getFiberSource,
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

describe('detectReactOnPage — DOM から React の有無と dev 判定を取る', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  /** 要素に React の内部キーを生やす (DevTools と無関係に React が必ず付けるもの) */
  const attach = (el: Element, fiber: Record<string, unknown>) =>
    Object.assign(el, { __reactFiber$abc: fiber });

  it('Fiber を持つ要素が無ければ React 無しと判定する', () => {
    document.body.appendChild(document.createElement('div'));
    expect(detectReactOnPage(document)).toEqual({ hasReact: false, devMode: false });
  });

  it('_debugSource を持てば dev ビルド', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    attach(el, {
      tag: 5,
      stateNode: el,
      return: { tag: 0, type: function App() {}, _debugSource: { fileName: '/src/App.tsx' } },
    });
    expect(detectReactOnPage(document)).toEqual({ hasReact: true, devMode: true });
  });

  it('dev フィールドが無ければ production と判定する (React はある)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    attach(el, { tag: 5, stateNode: el, return: { tag: 0, type: function App() {} } });
    expect(detectReactOnPage(document)).toEqual({ hasReact: true, devMode: false });
  });

  it('探索範囲を超えた位置の Fiber は見ない (巨大ページで暴走しない)', () => {
    for (let i = 0; i < 5; i += 1) document.body.appendChild(document.createElement('div'));
    const deep = document.createElement('span');
    document.body.appendChild(deep);
    attach(deep, { tag: 5, stateNode: deep, return: { tag: 0, type: function App() {} } });
    // maxElements=2 では届かない
    expect(detectReactOnPage(document, 2).hasReact).toBe(false);
    expect(detectReactOnPage(document, 50).hasReact).toBe(true);
  });
});

describe('getFiberFromElement と shadow 境界', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('通常の祖先の Fiber を見つける', () => {
    const host = document.createElement('div');
    attach(host, { tag: 5 });
    const child = document.createElement('span');
    host.appendChild(child);
    expect(getFiberFromElement(child)).not.toBeNull();
  });

  it('shadow root をまたいでホスト側の Fiber を見つける (web component 内の要素)', () => {
    // インスペクタは open shadow を貫通して最内要素を選べる。そこから Fiber へ遡れないと
    // React アプリ内の web component を「React ではない」と誤答する (実際に踏んだ)
    const host = document.createElement('div');
    attach(host, { tag: 5 });
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const wrapper = document.createElement('div');
    const inner = document.createElement('span');
    wrapper.appendChild(inner);
    root.appendChild(wrapper);
    expect(getFiberFromElement(inner)).not.toBeNull();
  });

  it('多段の shadow でも遡れる', () => {
    const outerHost = document.createElement('div');
    attach(outerHost, { tag: 5 });
    document.body.appendChild(outerHost);
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('div');
    outerRoot.appendChild(innerHost);
    const innerRoot = innerHost.attachShadow({ mode: 'open' });
    const leaf = document.createElement('span');
    innerRoot.appendChild(leaf);
    expect(getFiberFromElement(leaf)).not.toBeNull();
  });

  it('本当に React が無ければ null (誤検出しない)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    root.appendChild(inner);
    expect(getFiberFromElement(inner)).toBeNull();
  });
});

/**
 * React 19 の Owner Stacks からジャンプ先を選ぶとき、**React 内部のフレームを選ばない**。
 *
 * 実測 (2026-08-16, Next.js 16 + Turbopack): Turbopack はチャンク名にライブラリ名を
 * 残さないため、React 本体が `_0ro62as._.js` という名前で配信される。URL だけを見る
 * 除外 (`react-dom` 等) はこれに当たらず、**jsxDEV のフレームがジャンプ先になっていた**。
 */
describe('getFiberSource — Owner Stacks から利用者のコードを選ぶ', () => {
  const REAL_STACK = [
    'Error: react-stack-top-frame',
    '    at exports.jsxDEV (http://localhost:3001/_next/static/chunks/_0ro62as._.js:641:33)',
    '    at http://localhost:3001/_next/static/chunks/_1dffrib._.js:1921:245',
    '    at Array.map (<anonymous>)',
    '    at SampleBrowser (http://localhost:3001/_next/static/chunks/_1dffrib._.js:1908:32)',
  ].join('\n');

  it('**jsxDEV のフレームを選ばない** (チャンク名にライブラリ名が出ない構成でも)', () => {
    const source = getFiberSource({ _debugStack: { stack: REAL_STACK } } as never);
    expect(source?.fileName).not.toContain('_0ro62as');
  });

  it('その要素の JSX 呼び出し (内部を除いた先頭) を選ぶ', () => {
    const source = getFiberSource({ _debugStack: { stack: REAL_STACK } } as never);
    expect({ line: source?.lineNumber, column: source?.columnNumber }).toEqual({
      line: 1921,
      column: 245,
    });
  });

  it('_debugSource があるときは従来どおりそちらを優先する (React 18 以前)', () => {
    const source = getFiberSource({
      _debugSource: { fileName: '/src/App.tsx', lineNumber: 5, columnNumber: 2 },
      _debugStack: { stack: REAL_STACK },
    } as never);
    expect(source).toEqual({ fileName: '/src/App.tsx', lineNumber: 5, columnNumber: 2 });
  });
});
