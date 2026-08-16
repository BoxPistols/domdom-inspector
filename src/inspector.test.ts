// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookState } from './hook';
import {
  drillToInnermost,
  Inspector,
  type InspectorOptions,
  LIVE_RESYNC_MS,
  liveResyncDelay,
  resolveOuterElement,
} from './inspector';
import type { Overlay } from './overlay';
import { DEFAULT_STRINGS, type InspectInfo } from './types';

/**
 * Overlay の記録用スタブ。closed shadow DOM を実際に作らせず、
 * 「どのメソッドが何で呼ばれたか」だけを観測する (配線の検証が目的)。
 */
function stubOverlay() {
  const calls = {
    toasts: [] as string[],
    hintCopies: 0,
    editorOpened: [] as { fileName: string; lineNumber: number }[],
    chainPanels: [] as InspectInfo[],
    shown: [] as Element[],
    pills: [] as string[],
    hidden: 0,
  };
  const overlay = {
    containsTarget: () => false,
    toast: (text: string) => calls.toasts.push(text),
    // 開けないときは理由 + 手がかりコピーのアクション付きトーストになる。
    // メッセージは同じ配列へ積む (既存の期待値をそのまま検証できる)
    toastAction: (text: string) => calls.toasts.push(text),
    copySearchHints: () => {
      calls.hintCopies += 1;
    },
    showModePill: () => calls.pills.push('show'),
    hideModePill: () => calls.pills.push('hide'),
    openEditor: (loc: { fileName: string; lineNumber: number; columnNumber: number }) =>
      calls.editorOpened.push({ fileName: loc.fileName, lineNumber: loc.lineNumber }),
    showChainPanel: (info: InspectInfo) => calls.chainPanels.push(info),
    show: (element: Element) => calls.shown.push(element),
    hideHighlight: () => {
      calls.hidden += 1;
    },
    hideAll: () => {},
    updateSettings: () => {},
    isChainPanelOpen: () => false,
    hideChainPanel: () => {},
  } as unknown as Overlay;
  return { overlay, calls };
}

function stubHook(devMode: boolean, hasReact = false): HookState {
  return {
    // renderers が空 = React がそのページに無い (installHook は React 読み込み時に登録する)
    renderers: hasReact ? new Map([[1, {}]]) : new Map(),
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

function make(devMode = true, hasReact = false, options: InspectorOptions = {}) {
  const { overlay, calls } = stubOverlay();
  const inspector = new Inspector(stubHook(devMode, hasReact), overlay, DEFAULT_STRINGS, options);
  created.push(inspector);
  return { inspector, calls };
}

/**
 * フレーム間の状態同期 (issue #14)。**iframe を含むページで Esc を押すと親だけ OFF になり、
 * iframe 内のクリックが死んだまま残る**という現象の土台をここで固定する。
 * 実際の配布経路 (bridge → background → 全フレーム) は e2e/iframe-sync.spec.ts が担保。
 */
describe('フレーム間同期の土台 (冪等 OFF / 状態通知 / 告知の抑止)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('disableOnly は OFF のとき何もしない (何度配っても位相が反転しない)', () => {
    const states: boolean[] = [];
    const { inspector, calls } = make(true, false, { onStateChange: (on) => states.push(on) });

    // 既に OFF。ここで disable が走ると「配るたびに ON/OFF が入れ替わる」バグになる
    inspector.disableOnly();
    inspector.disableOnly();
    expect(states).toEqual([]);
    expect(calls.toasts).toEqual([]);

    inspector.toggle(); // ON
    inspector.disableOnly(); // OFF
    inspector.disableOnly(); // 2 度目は無視される
    expect(states).toEqual([true, false]);
  });

  it('enableOnly も冪等 (ON のとき再通知しない)', () => {
    const states: boolean[] = [];
    const { inspector } = make(true, false, { onStateChange: (on) => states.push(on) });

    inspector.enableOnly();
    inspector.enableOnly();
    expect(states).toEqual([true]);
    expect(inspector.isEnabled()).toBe(true);
  });

  it('Esc でモードが切れたときも状態を通知する (親で押した Esc を子へ配れる)', () => {
    const states: boolean[] = [];
    const { inspector } = make(true, false, { onStateChange: (on) => states.push(on) });

    inspector.toggle();
    states.length = 0;
    expect(inspector.onEscape()).toBe(true);
    expect(states).toEqual([false]);
    expect(inspector.isEnabled()).toBe(false);

    // 既に OFF の Esc は消費しない = 通知も出ない (ページの Esc を奪わない)
    expect(inspector.onEscape()).toBe(false);
    expect(states).toEqual([false]);
  });

  it('announce:false ではピルと ON/OFF トーストを出さない (子フレームの重複を作らない)', () => {
    const { inspector, calls } = make(true, false, { announce: false });

    inspector.toggle(); // ON
    inspector.toggle(); // OFF
    expect(calls.pills).toEqual([]);
    expect(calls.toasts).toEqual([]);
  });

  it('既定 (announce 未指定) ではピルと ON/OFF トーストを出す', () => {
    const { inspector, calls } = make();

    inspector.toggle();
    expect(calls.pills).toEqual(['show']);
    expect(calls.toasts).toEqual([DEFAULT_STRINGS.inspectOnNoReact]);

    inspector.toggle();
    expect(calls.pills).toEqual(['show', 'hide']);
    expect(calls.toasts).toEqual([DEFAULT_STRINGS.inspectOnNoReact, DEFAULT_STRINGS.inspectOff]);
  });
});

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

    // モード ON のトーストが出て、対象が選択されている。
    // スタブは renderers 空 = React 無しなので inspectOnNoReact が正しい
    expect(calls.toasts).toContain(DEFAULT_STRINGS.inspectOnNoReact);
    expect(calls.shown).toEqual([el]);
  });
});

describe('モード ON の説明が 3 状態を区別する (理由を取り違えない)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('React が無いページでは「本番ビルド」と言わない', () => {
    const { inspector, calls } = make(false, false);
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.inspectAt(el);

    expect(calls.toasts).toContain(DEFAULT_STRINGS.inspectOnNoReact);
    // 以前は素の HTML でも「production build」と説明していた (理由が嘘)
    expect(calls.toasts).not.toContain(DEFAULT_STRINGS.inspectOnSafe);
  });

  it('React の production ビルドでは production と言う', () => {
    const { inspector, calls } = make(false, true);
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.inspectAt(el);

    expect(calls.toasts).toContain(DEFAULT_STRINGS.inspectOnSafe);
    expect(calls.toasts).not.toContain(DEFAULT_STRINGS.inspectOnNoReact);
  });

  it('React の dev ビルドでは全機能の案内を出す', () => {
    const { inspector, calls } = make(true, true);
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.inspectAt(el);

    expect(calls.toasts).toContain(DEFAULT_STRINGS.inspectOn);
  });
});

describe('クリック時に対象を引き直す (スクロール後の誤答を塞ぐ)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  /** happy-dom の document.elementFromPoint は座標判定をしないので差し替える */
  function stubElementFromPoint(el: Element | null) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => el,
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  it('カーソル下が別要素に変わっていれば、クリック時にそちらを選び直す', () => {
    const { inspector, calls } = make();
    const a = document.createElement('div');
    const b = document.createElement('span');
    document.body.append(a, b);

    inspector.inspectAt(a);
    expect(calls.shown).toEqual([a]);

    // スクロールや DOM 差し替えで、カーソル下が b になった状況を作る
    stubElementFromPoint(b);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));

    // クリック時に b を選び直している (a のソースを開かない)
    expect(calls.shown).toEqual([a, b]);
  });

  it('スクロールは currentInfo も落とす (残った情報でエディタを開かない)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.inspectAt(el);
    calls.toasts.length = 0;

    // ホイールスクロール相当。**Chrome はホイールで pointermove を出さない**ので
    // 再同期の機会が無く、currentInfo が残ると決定論的に誤答していた
    window.dispatchEvent(new Event('scroll'));
    stubElementFromPoint(null); // カーソル下が取れない状況
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));

    // 情報が無いので「位置を特定できない」と言う (別要素のソースを開かない)
    expect(calls.editorOpened).toEqual([]);
    expect(calls.toasts).toEqual([DEFAULT_STRINGS.jumpUnresolved]);
  });
});

describe('操作系の細部 (監査 2026-08-07 の未対応分を固定)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  function stubElementFromPoint(el: Element | null) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => el,
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  it('選択が無いときの ↑↓ はページに返す (キースクロールを殺さない)', () => {
    const { inspector } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.toggle(); // ON (選択は無い)

    // スクロール後 = 選択を捨てた状態と同じ。↑ を奪うと「無反応 + スクロールも死ぬ」
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true });
    window.dispatchEvent(up);
    expect(up.defaultPrevented, '選択が無い ↑ はページに返す').toBe(false);

    // 遡った履歴が無い ↓ もページに返す (履歴を積む前に確認する)
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented, '戻る先の無い ↓ はページに返す').toBe(false);

    // 選択があれば従来どおり奪ってナビゲートする
    inspector.inspectAt(el);
    const up2 = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true });
    window.dispatchEvent(up2);
    expect(up2.defaultPrevented, '選択がある ↑ はナビゲーションが消費').toBe(true);

    // ↑ で積んだ履歴がある ↓ は消費する
    const down2 = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    window.dispatchEvent(down2);
    expect(down2.defaultPrevented, '履歴がある ↓ はナビゲーションが消費').toBe(true);
  });

  it('shadow DOM 内の入力欄でも ↑↓ を奪わない (event.target はホストに再ターゲットされる)', () => {
    const { inspector } = make();
    const el = document.createElement('div');
    const host = document.createElement('x-field');
    document.body.append(el, host);
    inspector.inspectAt(el); // 選択あり = 奪う条件は揃っている

    // 実 UA では shadow 内の input からのキーイベントは target=ホスト /
    // composedPath()[0]=input で届く。その形を作る
    const innerInput = document.createElement('input');
    const ev = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: host });
    Object.defineProperty(ev, 'composedPath', { value: () => [innerInput, host, document.body] });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented, 'shadow 内の入力欄のカーソル移動を奪わない').toBe(false);
  });

  it('↓ は DOM から消えた履歴をまとめて捨て、生きた履歴があれば消費する', () => {
    const { inspector, calls } = make();
    const grandparent = document.createElement('section');
    const parent = document.createElement('div');
    const child = document.createElement('span');
    grandparent.appendChild(parent);
    parent.appendChild(child);
    document.body.appendChild(grandparent);

    inspector.inspectAt(child);
    // ↑↑ で履歴 [child, parent] を積む
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true }));

    // 先頭 (parent) だけ DOM から消す — child は parent の子なので一緒に消える。
    // 両方 stale になった状態で ↓ を押すと、以前は 1 件だけ pop してページに返していた
    // (履歴を消費したのにスクロールが走り、onViewportChange が全状態を消す)
    parent.remove();
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented, '全履歴が stale ならページに返す').toBe(false);

    // stale 履歴は掃除されている = もう一度押しても二重消費しない
    const down2 = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    window.dispatchEvent(down2);
    expect(down2.defaultPrevented).toBe(false);
    void calls;
  });

  it('テキスト入力中・修飾キー付きの ↑↓ は奪わない', () => {
    const { inspector } = make();
    const el = document.createElement('div');
    const input = document.createElement('input');
    document.body.append(el, input);
    inspector.inspectAt(el); // 選択あり = 奪う条件は揃っている

    // 実 UA では input からのイベントは target=input / composedPath()[0]=input で
    // window に届く。テストは window に直接 dispatch するため両方を偽装する
    const inInput = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true });
    Object.defineProperty(inInput, 'target', { value: input });
    Object.defineProperty(inInput, 'composedPath', { value: () => [input, document.body] });
    window.dispatchEvent(inInput);
    expect(inInput.defaultPrevented, '入力欄のカーソル移動を奪わない').toBe(false);

    const withMeta = new KeyboardEvent('keydown', {
      key: 'ArrowUp', metaKey: true, cancelable: true, bubbles: true,
    });
    window.dispatchEvent(withMeta);
    expect(withMeta.defaultPrevented, '⌘↑ (ページ先頭へ) を奪わない').toBe(false);
  });

  it('disable が未実行の rAF を捨てる (OFF 後に枠が復活してリロードまで残る事故)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    stubElementFromPoint(el);
    inspector.toggle();

    // pointermove が rAF を積む → 実行前に Esc で OFF
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    inspector.onEscape();
    const shownAtOff = calls.shown.length;

    // rAF が発火しても select は走らない (happy-dom の rAF は setTimeout ベース)
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(calls.shown.length, 'OFF 後に show が走らない').toBe(shownAtOff);
        resolve();
      });
    });
  });

  it('クリックは同一要素でも再計測する (ホバー中のスタイル書き換えを拾う)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    stubElementFromPoint(el);
    inspector.inspectAt(el);
    expect(calls.shown).toEqual([el]);

    // 同一要素のままクリック → 以前は「変わっていない」として再計測しなかった
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.shown, 'クリック時に同一要素を測り直す').toEqual([el, el]);
  });

  it('カーソル下に要素が無い Alt+Click は理由をトーストで言う (無反応にしない)', () => {
    const { inspector, calls } = make();
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.toggle();
    calls.toasts.length = 0;
    stubElementFromPoint(null); // 引き直しても対象が取れない

    el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    expect(calls.chainPanels).toEqual([]);
    expect(calls.toasts, '案内済みの操作を黙って無視しない').toEqual([
      DEFAULT_STRINGS.jumpUnresolved,
    ]);
  });
});

describe('非 React ページのエディタジャンプ (3 段フォールバック)', () => {
  it('ソース注釈属性があれば React 無しでも開く (Express/EJS の道)', () => {
    const { overlay, calls } = stubOverlay();
    const inspector = new Inspector(stubHook(false), overlay, DEFAULT_STRINGS);
    const el = document.createElement('div');
    el.setAttribute('data-source', 'views/index.ejs:42');
    document.body.appendChild(el);
    inspector.openEditorAt(el);
    expect(calls.editorOpened).toEqual([{ fileName: 'views/index.ejs', lineNumber: 42 }]);
    expect(calls.toasts).toEqual([]);
  });

  it('祖先の注釈でも開く (要素自身に無くても)', () => {
    const { overlay, calls } = stubOverlay();
    const inspector = new Inspector(stubHook(false), overlay, DEFAULT_STRINGS);
    const wrap = document.createElement('section');
    wrap.setAttribute('data-v-inspector', 'src/App.vue:7:3');
    const leaf = document.createElement('span');
    wrap.appendChild(leaf);
    document.body.appendChild(wrap);
    inspector.openEditorAt(leaf);
    expect(calls.editorOpened).toEqual([{ fileName: 'src/App.vue', lineNumber: 7 }]);
  });

  it('何も無ければ理由トースト + 手がかりコピーの導線 (無反応にしない)', () => {
    const { overlay, calls } = stubOverlay();
    const inspector = new Inspector(stubHook(false), overlay, DEFAULT_STRINGS);
    const el = document.createElement('div');
    document.body.appendChild(el);
    inspector.openEditorAt(el);
    expect(calls.editorOpened).toEqual([]);
    expect(calls.toasts).toEqual([DEFAULT_STRINGS.noSourceDom]);
  });
});

/**
 * 選択中の要素の live 追従 (issue #19)。
 * 「マウスを止めて見ている間にページ側がスタイルを書き換えても、バッジが古い値のまま
 * 残る」を閉じる。**古い値を出し続けるのは欠測ではなく誤答**なので、追従できない状況では
 * 枠ごと畳む (対象が DOM から外れた場合) ことまで含めて固定する。
 */
describe('liveResyncDelay (測り直しの待ち時間)', () => {
  it('直前に測ったばかりなら interval だけ待つ', () => {
    expect(liveResyncDelay(1000, 1000, 150)).toBe(150);
  });
  it('interval 経過後は待たない', () => {
    expect(liveResyncDelay(1150, 1000, 150)).toBe(0);
    expect(liveResyncDelay(9999, 1000, 150)).toBe(0);
  });
  it('途中なら残り時間だけ待つ', () => {
    expect(liveResyncDelay(1100, 1000, 150)).toBe(50);
  });
  it('時計が巻き戻っても interval を超えて待たない (バッジが数分止まらない)', () => {
    // NTP 補正やスリープ復帰で now < lastSync になりうる。素朴な引き算だと
    // interval を超える待ちになり、追従が止まったように見える
    expect(liveResyncDelay(1000, 60_000, 150)).toBe(150);
  });
});

describe('選択中の要素の live 追従 (issue #19)', () => {
  /** 条件が満たされるまで待つ (MutationObserver はマイクロタスク + throttle のタイマー) */
  const waitFor = async (predicate: () => boolean, timeout = LIVE_RESYNC_MS * 8) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeout) return false;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return true;
  };

  beforeEach(() => {
    document.body.replaceChildren();
    document.documentElement.className = '';
  });

  it('選択中の要素の style 書き換えで測り直す', async () => {
    const { inspector, calls } = make();
    const target = document.createElement('div');
    document.body.append(target);

    inspector.inspectAt(target);
    const shownAtSelect = calls.shown.length;
    expect(shownAtSelect).toBeGreaterThan(0);

    target.style.color = 'rgb(255, 0, 0)';
    expect(await waitFor(() => calls.shown.length > shownAtSelect)).toBe(true);
    // 測り直しは選択を動かさない (同じ要素を出し直す)
    expect(calls.shown.at(-1)).toBe(target);
  });

  it('テーマ切替 (html の class 差し替え) でも測り直す — 対象自身は変わらない', async () => {
    const { inspector, calls } = make();
    const target = document.createElement('div');
    document.body.append(target);

    inspector.inspectAt(target);
    const before = calls.shown.length;

    document.documentElement.classList.add('dark');
    expect(await waitFor(() => calls.shown.length > before)).toBe(true);
  });

  it('連続変化は 1 回にまとめる (トランジション中に毎フレーム測らない)', async () => {
    const { inspector, calls } = make();
    const target = document.createElement('div');
    document.body.append(target);

    inspector.inspectAt(target);
    const before = calls.shown.length;

    // **1 tick にまとめて書かない。** 同期的に 10 回書くと MutationObserver 側が
    // 1 コールバックに束ねてしまい、throttle を通らずに緑になる (検証にならない)。
    // tick を挟んで通知を 10 回起こし、それでも測り直しが 1 回であることを見る
    for (let i = 0; i < 10; i += 1) {
      target.style.opacity = String(i / 10);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await waitFor(() => calls.shown.length > before)).toBe(true);
    // 追従は 1 回だけ。10 回測り直していたら 60fps が壊れている
    expect(calls.shown.length - before).toBe(1);
  });

  it('モードを OFF にした後の変化では測り直さない', async () => {
    const { inspector, calls } = make();
    const target = document.createElement('div');
    document.body.append(target);

    inspector.inspectAt(target);
    inspector.onEscape();
    const before = calls.shown.length;

    target.style.color = 'rgb(0, 255, 0)';
    // 追従しないことの確認なので、待ってから増えていないことを見る
    await new Promise((resolve) => setTimeout(resolve, LIVE_RESYNC_MS * 2));
    expect(calls.shown.length).toBe(before);
  });

  it('対象がページから外れたらハイライトを畳む (消えた要素の枠を残さない)', async () => {
    const { inspector, calls } = make();
    const target = document.createElement('div');
    document.body.append(target);

    inspector.inspectAt(target);
    const hiddenBefore = calls.hidden;

    // 外す前に変化を起こしておく (測り直しのタイミングで既に外れている状況を作る)
    target.style.color = 'rgb(0, 0, 255)';
    target.remove();

    expect(await waitFor(() => calls.hidden > hiddenBefore)).toBe(true);
  });
});
