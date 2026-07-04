// @vitest-environment happy-dom
// renderTracker は fiber.stateNode instanceof Element を判定するため DOM 環境が要る
import { describe, expect, it } from 'vitest';
import { RenderTracker } from './renderTracker';

// 最小の Fiber モックを組み立てるヘルパ。
// tag: 0=FunctionComponent(composite), 5=HostComponent。
// actualDuration は「自身+子」の累積値を渡す (React の Profiler と同じ意味)。
function mockElement(): Element {
  return document.createElement('div');
}

interface F {
  tag: number;
  type: unknown;
  actualDuration: number;
  stateNode?: unknown;
  child?: F | null;
  sibling?: F | null;
}

function fiber(partial: Partial<F> & Pick<F, 'tag' | 'actualDuration'>): F {
  return { type: null, child: null, sibling: null, ...partial };
}

function root(current: F) {
  return { current };
}

describe('RenderTracker', () => {
  it('自己時間が正の composite だけを再描画としてカウントする', () => {
    // Parent(self=1, actual=6) > Child(self=5, actual=5)
    const child = fiber({ tag: 0, type: function Child() {}, actualDuration: 5 });
    const parent = fiber({
      tag: 0,
      type: function Parent() {},
      actualDuration: 6,
      child,
    });
    const tracker = new RenderTracker();
    tracker.startRecording();
    const result = tracker.handleCommit(root(parent));

    // Parent self=6-5=1>0, Child self=5>0 → 2 コンポーネント
    expect(result.rendered).toBe(2);
    expect(result.supported).toBe(true);

    const snap = tracker.snapshot();
    expect(snap.stats.map((s) => s.name).sort()).toEqual(['Child', 'Parent']);
    expect(snap.commits).toBe(1);
  });

  it('子の再描画を伝播しただけの祖先 (self≈0) はカウントしない', () => {
    // Ancestor(actual=5) は自分では描画せず、Child(actual=5) の伝播のみ → self=0
    const child = fiber({ tag: 0, type: function Child() {}, actualDuration: 5 });
    const ancestor = fiber({
      tag: 0,
      type: function Ancestor() {},
      actualDuration: 5,
      child,
    });
    const tracker = new RenderTracker();
    tracker.startRecording();
    const result = tracker.handleCommit(root(ancestor));

    expect(result.rendered).toBe(1);
    expect(tracker.snapshot().stats.map((s) => s.name)).toEqual(['Child']);
  });

  it('ホスト要素をフラッシュ対象に含め、累積回数で heat が上がる', () => {
    const el = mockElement();
    const makeHost = () =>
      fiber({ tag: 5, type: 'div', actualDuration: 2, stateNode: el });

    const tracker = new RenderTracker();
    const first = tracker.handleCommit(root(makeHost()));
    expect(first.flashes).toHaveLength(1);
    expect(first.flashes[0].heat).toBe(1);

    // 同じ要素が再度再描画 → heat が増える (ヒートマップ)
    const second = tracker.handleCommit(root(makeHost()));
    expect(second.flashes[0].heat).toBe(2);
  });

  it('actualDuration が無い (production) 場合は supported=false、検出は alternate/props 差分で近似', () => {
    // mount 相当 (alternate なし) → 再描画とみなす
    const mounted = fiber({ tag: 0, type: function C() {}, actualDuration: undefined as never });
    const tracker = new RenderTracker();
    const r1 = tracker.handleCommit(root(mounted));
    expect(r1.supported).toBe(false);
    expect(r1.rendered).toBe(1);
  });

  it('タイマ無し: alternate と props が同一なら再描画とみなさない (フォールバック)', () => {
    const props = { a: 1 };
    const alt = fiber({ tag: 0, type: function C() {}, actualDuration: undefined as never });
    (alt as { memoizedProps?: unknown }).memoizedProps = props;
    const cur = fiber({ tag: 0, type: function C() {}, actualDuration: undefined as never });
    (cur as { memoizedProps?: unknown; alternate?: unknown }).memoizedProps = props;
    (cur as { alternate?: unknown }).alternate = alt;

    const tracker = new RenderTracker();
    const same = tracker.handleCommit(root(cur));
    expect(same.rendered).toBe(0);

    // props 参照が変われば再描画とみなす
    (cur as { memoizedProps?: unknown }).memoizedProps = { a: 2 };
    const changed = tracker.handleCommit(root(cur));
    expect(changed.rendered).toBe(1);
  });

  it('記録の集計は回数の多い順に並ぶ', () => {
    const tracker = new RenderTracker();
    tracker.startRecording();
    // A を 3 回, B を 1 回 再描画
    for (let i = 0; i < 3; i++) {
      tracker.handleCommit(root(fiber({ tag: 0, type: function A() {}, actualDuration: 1 })));
    }
    tracker.handleCommit(root(fiber({ tag: 0, type: function B() {}, actualDuration: 1 })));
    const snap = tracker.snapshot();
    expect(snap.stats[0].name).toBe('A');
    expect(snap.stats[0].count).toBe(3);
    expect(snap.stats[1].name).toBe('B');
  });
});
