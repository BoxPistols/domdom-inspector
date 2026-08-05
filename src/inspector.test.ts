// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookState } from './hook';
import { drillToInnermost, Inspector, resolveOuterElement } from './inspector';
import type { Overlay } from './overlay';
import { DEFAULT_STRINGS, type InspectInfo } from './types';

/**
 * Overlay の記録用スタブ。closed shadow DOM を実際に作らせず、
 * 「どのメソッドが何で呼ばれたか」だけを観測する (配線の検証が目的)。
 */
function stubOverlay() {
  const calls = {
    toasts: [] as string[],
    editorOpened: [] as { fileName: string; lineNumber: number }[],
    chainPanels: [] as InspectInfo[],
    shown: [] as Element[],
  };
  const overlay = {
    containsTarget: () => false,
    toast: (text: string) => calls.toasts.push(text),
    openEditor: (loc: { fileName: string; lineNumber: number; columnNumber: number }) =>
      calls.editorOpened.push({ fileName: loc.fileName, lineNumber: loc.lineNumber }),
    showChainPanel: (info: InspectInfo) => calls.chainPanels.push(info),
    show: (element: Element) => calls.shown.push(element),
    hideHighlight: () => {},
    hideAll: () => {},
    showModePill: () => {},
    hideModePill: () => {},
    updateSettings: () => {},
    isChainPanelOpen: () => false,
    hideChainPanel: () => {},
  } as unknown as Overlay;
  return { overlay, calls };
}

function stubHook(devMode: boolean): HookState {
  return {
    renderers: new Map(),
    roots: new Set(),
    devMode,
    commitListeners: new Set(),
    onCommit: () => () => {},
  };
}

/** 要素に React Fiber を生やす (production / dev / バンドル出力 の 3 断面を作り分ける) */
function attachFiber(element: Element, componentFiber: Record<string, unknown>) {
  Object.assign(element, {
    __reactFiber$test: { tag: 5, stateNode: element, return: componentFiber },
  });
}

/**
 * 生成した Inspector は必ず後片付けする。**window のリスナが残ると次のテストを壊す**:
 * onIntercept は stopImmediatePropagation() を呼ぶため、前テストのインスタンスが
 * 先に登録されているとクリックを食ってしまい、当該テストのハンドラに届かない
 * (実行時は二重注入ガードで 1 インスタンスなので製品側の問題ではない)。
 */
const created: Inspector[] = [];

afterEach(() => {
  for (const inspector of created.splice(0)) inspector.onEscape();
});

function make(devMode = true) {
  const { overlay, calls } = stubOverlay();
  const inspector = new Inspector(stubHook(devMode), overlay, DEFAULT_STRINGS);
  created.push(inspector);
  return { inspector, calls };
}

describe('resolveOuterElement (↑ の親解決 + DOM フォールバック)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('コンポーネント親が取れればそれを優先する (React サイト)', () => {
    const outer = document.createElement('section');
    const inner = document.createElement('span');
    outer.appendChild(inner);
    document.body.appendChild(outer);

    // componentParent が非 null を返す = Fiber からコンポーネント親が取れたケース
    const result = resolveOuterElement(inner, () => outer);
    expect(result).toBe(outer);
  });

  it('コンポーネント親が無ければ DOM 親へフォールバックする (非 React サイト)', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    document.body.appendChild(parent);

    // Fiber 無し = componentParent は常に null → parentElement を返す
    const result = resolveOuterElement(child, () => null);
    expect(result).toBe(parent);
  });

  it('ルート (html) では親が無いので null を返す (トースト表示条件)', () => {
    const html = document.documentElement;
    expect(html.parentElement).toBeNull();
    expect(resolveOuterElement(html, () => null)).toBeNull();
  });

  it('DOM 親を 1 段ずつ遡れる (span → div → body)', () => {
    const div = document.createElement('div');
    const span = document.createElement('span');
    div.appendChild(span);
    document.body.appendChild(div);

    const step1 = resolveOuterElement(span, () => null);
    expect(step1).toBe(div);
    const step2 = resolveOuterElement(step1 as Element, () => null);
    expect(step2).toBe(document.body);
  });
});

describe('drillToInnermost — shadow root を貫通してカーソル直下の要素まで降りる', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  /** open shadow root を張り、elementFromPoint が inner を返すようにする */
  function withOpenShadow(host: Element, inner: Element) {
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(inner);
    Object.defineProperty(root, 'elementFromPoint', {
      configurable: true,
      value: () => inner,
    });
    return root;
  }

  it('1 段の shadow root を貫通する (ホストの値を誤って出さない)', () => {
    const host = document.createElement('div');
    const inner = document.createElement('button');
    document.body.appendChild(host);
    withOpenShadow(host, inner);

    expect(drillToInnermost(host, 10, 10)).toBe(inner);
  });

  it('入れ子の shadow root を最内まで降りる', () => {
    const host = document.createElement('div');
    const mid = document.createElement('div');
    const inner = document.createElement('span');
    document.body.appendChild(host);
    withOpenShadow(host, mid);
    withOpenShadow(mid, inner);

    expect(drillToInnermost(host, 10, 10)).toBe(inner);
  });

  it('closed shadow root ではホストで止まる (限界であって誤りではない)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });
    root.appendChild(document.createElement('button'));

    // closed root は element.shadowRoot が null なので外から辿れない
    expect(drillToInnermost(host, 10, 10)).toBe(host);
  });

  it('shadow root が無い普通の要素はそのまま返す', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(drillToInnermost(el, 10, 10)).toBe(el);
  });

  it('elementFromPoint が自分自身を返しても止まる (無限ループにしない)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    Object.defineProperty(root, 'elementFromPoint', {
      configurable: true,
      value: () => host,
    });

    expect(drillToInnermost(host, 10, 10)).toBe(host);
  });

  it('深さ上限で打ち切る (病的な入れ子で暴走しない)', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const c = document.createElement('div');
    document.body.appendChild(a);
    withOpenShadow(a, b);
    withOpenShadow(b, c);

    // maxDepth=1 なら 1 段だけ降りて b で止まる
    expect(drillToInnermost(a, 10, 10, 1)).toBe(b);
  });
});

describe('resolveOuterElement — shadow 境界を越える', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('shadow root の直下要素は ↑ でホストへ抜ける (行き止まりにしない)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('button');
    root.appendChild(inner);

    // shadow root の子は parentElement が null になる
    expect(inner.parentElement).toBeNull();
    expect(resolveOuterElement(inner, () => null)).toBe(host);
  });
});

describe('エディタ起動 — 開けないときは必ず理由を言う (無反応を作らない)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('素の DOM 要素は「React コンポーネントでない」と言う (production と別の理由)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);

    inspector.openEditorAt(el);

    expect(calls.editorOpened).toEqual([]);
    expect(calls.toasts).toEqual([DEFAULT_STRINGS.noSourceDom]);
  });

  it('production ビルド (dev フィールド剥離) は「本番ビルド」と言う', () => {
    const { inspector, calls } = make(false);
    const el = document.createElement('div');
    document.body.appendChild(el);
    // _debugOwner / _debugSource が無い component fiber = production 剥離相当
    attachFiber(el, { tag: 0, type: function App() {} });

    inspector.openEditorAt(el);

    expect(calls.editorOpened).toEqual([]);
    expect(calls.toasts).toEqual([DEFAULT_STRINGS.jumpProd]);
  });

  it('dev だがバンドル出力を指しているときは「バンドル出力」と言う', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    attachFiber(el, {
      tag: 0,
      type: function App() {},
      _debugOwner: null,
      _debugSource: { fileName: '/assets/index-4f2a.js', lineNumber: 1, columnNumber: 1 },
    });

    inspector.openEditorAt(el);

    expect(calls.editorOpened).toEqual([]);
    expect(calls.toasts).toEqual([DEFAULT_STRINGS.sourceMinified]);
  });

  it('dev の実ソースならエディタを開く (localhost の主導線)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    attachFiber(el, {
      tag: 0,
      type: function App() {},
      _debugOwner: null,
      _debugSource: {
        fileName: 'http://localhost:5173/src/App.tsx',
        lineNumber: 42,
        columnNumber: 7,
      },
    });

    inspector.openEditorAt(el);

    expect(calls.toasts).toEqual([]);
    expect(calls.editorOpened).toEqual([
      { fileName: 'http://localhost:5173/src/App.tsx', lineNumber: 42 },
    ]);
  });
});

describe('案内している操作が実際に動く (画面の指示と実装の一致)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('Alt+Click で描画元パネルを開く (トーストで案内している操作)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);

    // 右クリックメニュー経由でモード ON + 対象選択 (currentInfo を持たせる)
    inspector.inspectAt(el);
    expect(calls.shown).toEqual([el]);

    el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));

    expect(calls.chainPanels).toHaveLength(1);
    // エディタは開かない (Alt と ⌘/Ctrl は別操作)
    expect(calls.editorOpened).toEqual([]);
  });

  it('⌘/Ctrl+Click は開けない要素でも必ず応答する (旧実装は黙って何もしなかった)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.inspectAt(el);
    calls.toasts.length = 0; // enable() のトーストを捨てる

    el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));

    expect(calls.toasts).toEqual([DEFAULT_STRINGS.noSourceDom]);
  });

  it('修飾キー無しのクリックは何も起動しない (ページ誤操作の抑止だけ)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.inspectAt(el);
    calls.toasts.length = 0;

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(calls.toasts).toEqual([]);
    expect(calls.chainPanels).toEqual([]);
    expect(calls.editorOpened).toEqual([]);
  });

  it('右クリックメニューの「この要素を検査」はモード OFF から 1 アクションで到達する', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);

    inspector.inspectAt(el);

    // モード ON のトーストが出て、対象が選択されている
    expect(calls.toasts).toContain(DEFAULT_STRINGS.inspectOn);
    expect(calls.shown).toEqual([el]);
  });
});
