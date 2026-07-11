// @vitest-environment happy-dom
// renderTracker は fiber.stateNode instanceof Element を判定するため DOM 環境が要る
import { describe, expect, it } from 'vitest';
import { RenderTracker } from './renderTracker';

/**
 * 最小の Fiber モック。判定は React DevTools と同じ基準:
 * - コンポーネント: flags & PerformedWork(=1) — render 関数が実際に走ったコミットにのみ立つ
 * - ホスト: alternate と memoizedProps の参照差分
 * - 走査: fiber.child === alternate.child のサブツリーはスキップ (bailout)
 * actualDuration は「自身+子」の累積値 (React の Profiler と同じ意味)。
 */
type F = {
  tag: number;
  type: unknown;
  flags?: number;
  actualDuration?: number;
  stateNode?: unknown;
  memoizedProps?: unknown;
  memoizedState?: unknown;
  alternate?: F | null;
  child?: F | null;
  sibling?: F | null;
};

const PERFORMED_WORK = 1;

function fiber(partial: Partial<F> & Pick<F, 'tag'>): F {
  return { type: null, child: null, sibling: null, alternate: null, ...partial };
}

/** update コミット: HostRoot(tag=3) に alternate を持たせ、子が差し替わった状態を作る */
function updateRoot(child: F, prevChild: F | null = null): { current: F } {
  const altRoot = fiber({ tag: 3, child: prevChild });
  const rootFiber = fiber({ tag: 3, alternate: altRoot, child });
  return { current: rootFiber };
}

function mockElement(): Element {
  return document.createElement('div');
}

describe('RenderTracker (PerformedWork フラグ判定)', () => {
  it('PerformedWork が立った composite だけを再描画とカウントする', () => {
    // Child は flags=1 (render 実行)、Wrapper は flags=0 (伝播のみ)
    const altChild = fiber({ tag: 0, type: function Child() {} });
    const child = fiber({
      tag: 0,
      type: function Child() {},
      flags: PERFORMED_WORK,
      alternate: altChild,
      actualDuration: 5,
      memoizedProps: {},
    });
    const altWrapper = fiber({ tag: 0, type: function Wrapper() {} });
    const wrapper = fiber({
      tag: 0,
      type: function Wrapper() {},
      flags: 0,
      alternate: altWrapper,
      actualDuration: 5, // 子の伝播分のみ
      child,
    });

    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    const result = tracker.handleCommit(updateRoot(wrapper));

    expect(result.rendered).toBe(1);
    expect(result.supported).toBe(true);
    expect(tracker.snapshot().stats.map((s) => s.name)).toEqual(['Child']);
  });

  it('自己時間は actualDuration から直下の子の合計を引いた値', () => {
    const child = fiber({
      tag: 0,
      type: function Child() {},
      flags: PERFORMED_WORK,
      alternate: fiber({ tag: 0 }),
      actualDuration: 5,
      memoizedProps: {},
    });
    const parent = fiber({
      tag: 0,
      type: function Parent() {},
      flags: PERFORMED_WORK,
      alternate: fiber({ tag: 0 }),
      actualDuration: 6, // 自己 1ms + 子 5ms
      memoizedProps: {},
      child,
    });

    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    const result = tracker.handleCommit(updateRoot(parent));
    expect(result.rendered).toBe(2);
    expect(result.durationMs).toBeCloseTo(6); // Parent 1 + Child 5

    const stats = tracker.snapshot().stats;
    expect(stats.find((s) => s.name === 'Parent')?.selfMs).toBeCloseTo(1);
    expect(stats.find((s) => s.name === 'Child')?.selfMs).toBeCloseTo(5);
  });

  it('bailout サブツリー (child === alternate.child) はスキップし stale フラグを拾わない', () => {
    // 共有サブツリー: 前コミットで render され PerformedWork が残ったままの Fiber
    const stale = fiber({
      tag: 0,
      type: function Stale() {},
      flags: PERFORMED_WORK,
      alternate: fiber({ tag: 0 }),
    });
    const sharedChild = stale;
    const altMid = fiber({ tag: 0, type: function Mid() {}, child: sharedChild });
    const mid = fiber({
      tag: 0,
      type: function Mid() {},
      flags: 0,
      alternate: altMid,
      child: sharedChild, // 同一参照 = bailout
      memoizedProps: {},
    });

    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    const result = tracker.handleCommit(updateRoot(mid));
    expect(result.rendered).toBe(0);
    expect(tracker.snapshot().stats).toHaveLength(0);
  });

  it('初回マウント (root に alternate 無し) は記録するがフラッシュしない', () => {
    const el = mockElement();
    const host = fiber({ tag: 5, type: 'div', stateNode: el, memoizedProps: {} });
    const comp = fiber({ tag: 0, type: function App() {}, child: host, memoizedProps: {} });
    const rootFiber = fiber({ tag: 3, child: comp });

    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    const result = tracker.handleCommit({ current: rootFiber });
    expect(result.rendered).toBe(1); // App が mount として記録される
    expect(result.flashes).toHaveLength(0); // 全画面フラッシュのノイズは出さない
    expect(tracker.snapshot().stats[0].causes.mount).toBe(1);
  });

  it('ホストは props 参照が変わったときだけフラッシュし、heat が累積する', () => {
    const el = mockElement();
    const makeHost = (changed: boolean) => {
      const prevProps = {};
      const alt = fiber({ tag: 5, type: 'div', memoizedProps: prevProps });
      return fiber({
        tag: 5,
        type: 'div',
        stateNode: el,
        alternate: alt,
        memoizedProps: changed ? {} : prevProps,
      });
    };

    const tracker = new RenderTracker(() => 0);
    const first = tracker.handleCommit(updateRoot(makeHost(true)));
    expect(first.flashes).toHaveLength(1);
    expect(first.flashes[0].heat).toBe(1);

    const second = tracker.handleCommit(updateRoot(makeHost(true)));
    expect(second.flashes[0].heat).toBe(2);

    // props 参照が同じ (親の JSX が再評価されていない) ならフラッシュしない
    const none = tracker.handleCommit(updateRoot(makeHost(false)));
    expect(none.flashes).toHaveLength(0);
  });

  it('flags が読めない環境では memoizedProps 参照差分にフォールバックする', () => {
    const props = { a: 1 };
    const make = (changed: boolean) =>
      fiber({
        tag: 0,
        type: function C() {},
        alternate: fiber({ tag: 0, memoizedProps: props }),
        memoizedProps: changed ? { a: 2 } : props,
      });

    const tracker = new RenderTracker(() => 0);
    expect(tracker.handleCommit(updateRoot(make(false))).rendered).toBe(0);
    expect(tracker.handleCommit(updateRoot(make(true))).rendered).toBe(1);
  });

  it('再描画原因 (state/props/parent) を stats に内訳として記録する', () => {
    const hook = (v: unknown) => ({ memoizedState: v, queue: {}, next: null });
    const make = (kind: 'state' | 'props' | 'parent') => {
      const alt = fiber({
        tag: 0,
        memoizedProps: { a: 1 },
        memoizedState: hook(0),
      });
      return fiber({
        tag: 0,
        type: function Target() {},
        flags: PERFORMED_WORK,
        alternate: alt,
        memoizedProps: kind === 'props' ? { a: 2 } : { a: 1 },
        memoizedState: kind === 'state' ? hook(1) : hook(0),
      });
    };

    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    tracker.handleCommit(updateRoot(make('state')));
    tracker.handleCommit(updateRoot(make('props')));
    tracker.handleCommit(updateRoot(make('parent')));
    tracker.handleCommit(updateRoot(make('parent')));

    const snap = tracker.snapshot();
    const stat = snap.stats[0];
    expect(stat.causes.state).toBe(1);
    expect(stat.causes.props).toBe(1);
    expect(stat.causes.parent).toBe(2);
    expect(stat.lastChangedProps).toEqual(['a']);
    expect(stat.lastChangedHooks).toEqual([0]);
    expect(snap.totalWasted).toBe(2);
  });

  it('タイムラインと実時間 (wallMs) を注入時計で記録する', () => {
    let t = 0;
    const tracker = new RenderTracker(() => t);
    tracker.startRecording();
    t = 100;
    tracker.handleCommit(
      updateRoot(
        fiber({
          tag: 0,
          type: function A() {},
          flags: PERFORMED_WORK,
          alternate: fiber({ tag: 0 }),
          memoizedProps: {},
        }),
      ),
    );
    t = 250;
    tracker.stopRecording();

    const snap = tracker.snapshot();
    expect(snap.commits).toBe(1);
    expect(snap.wallMs).toBe(250);
    expect(snap.timeline).toEqual([{ t: 100, rendered: 1, selfMs: 0 }]);
  });

  it('snapshot は自己時間の大きい順 (時間なしは回数順) に並ぶ', () => {
    const make = (name: string, actual: number) =>
      fiber({
        tag: 0,
        type: { displayName: name },
        flags: PERFORMED_WORK,
        alternate: fiber({ tag: 0 }),
        actualDuration: actual,
        memoizedProps: {},
      });
    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    tracker.handleCommit(updateRoot(make('Fast', 1)));
    tracker.handleCommit(updateRoot(make('Slow', 5)));
    const snap = tracker.snapshot();
    expect(snap.stats[0].name).toBe('Slow');
    expect(snap.stats[1].name).toBe('Fast');
    expect(snap.totalSelfMs).toBeCloseTo(6);
  });

  it('stopRecording 後のコミットは stats に加算しない', () => {
    const make = (name: string) =>
      fiber({
        tag: 0,
        type: { displayName: name },
        flags: PERFORMED_WORK,
        alternate: fiber({ tag: 0 }),
        memoizedProps: {},
      });
    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    tracker.handleCommit(updateRoot(make('A')));
    tracker.stopRecording();
    tracker.handleCommit(updateRoot(make('B')));
    expect(tracker.snapshot().stats.map((s) => s.name)).toEqual(['A']);
  });

  it('reset は stats / timeline / heat をクリアする', () => {
    const el = mockElement();
    const makeHost = () =>
      fiber({
        tag: 5,
        type: 'div',
        stateNode: el,
        alternate: fiber({ tag: 5, memoizedProps: {} }),
        memoizedProps: {},
      });
    const tracker = new RenderTracker(() => 0);
    tracker.startRecording();
    tracker.handleCommit(updateRoot(makeHost()));
    expect(tracker.handleCommit(updateRoot(makeHost())).flashes[0].heat).toBe(2);

    tracker.reset();
    expect(tracker.snapshot().stats).toHaveLength(0);
    expect(tracker.snapshot().timeline).toHaveLength(0);
    expect(tracker.handleCommit(updateRoot(makeHost())).flashes[0].heat).toBe(1);
  });
});
