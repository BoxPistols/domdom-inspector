import { COMPONENT_TAGS, getFiberName } from './fiber';

type Fiber = any;

/** 記録セッションでの 1 コンポーネントの再描画統計 */
export interface RenderStat {
  name: string;
  /** 再描画回数 (自己レンダー = 実際に render 関数が走った回数) */
  count: number;
  /** 累積の自己レンダー時間 (ms)。Profiler タイマ非対応時は 0 */
  selfMs: number;
  /** 最後に再描画したコミット通番 */
  lastCommit: number;
}

/** 1 コミットの解析結果 */
export interface CommitResult {
  /** フラッシュ対象の DOM 要素と、その要素の累積再描画回数 (ヒートマップ用) */
  flashes: { element: Element; heat: number }[];
  /** このコミットで自己レンダーしたコンポーネント数 */
  rendered: number;
  /** このコミットの自己レンダー時間合計 (ms) */
  durationMs: number;
  /** Profiler タイマ (actualDuration) が利用可能か = dev ビルドか */
  supported: boolean;
}

function children(fiber: Fiber): Fiber[] {
  const out: Fiber[] = [];
  let c = fiber.child;
  while (c) {
    out.push(c);
    c = c.sibling;
  }
  return out;
}

/**
 * コミットされた Fiber ツリーを走査し、各コミットで「自分自身が」再描画した
 * コンポーネント / ホスト要素を検出する。
 *
 * actualDuration は子の分を含む累積値のため、そのままだと再描画した子を持つだけの
 * 祖先まで検出してしまう。子の actualDuration 合計を差し引いた「自己時間 (self)」が
 * 正のものだけを「自分が render した」とみなすことで祖先の過剰報告を避ける。
 *
 * ヒートマップの色は、要素ごとの累積再描画回数 (flashCounts) で決める。
 */
export class RenderTracker {
  private commitSeq = 0;
  private recording = false;
  private stats = new Map<string, RenderStat>();
  private recordedCommits = 0;
  /** 要素ごとの累積再描画回数 (ヒートマップ用、GC 連動) */
  private flashCounts = new WeakMap<Element, number>();
  private sawDuration = false;

  startRecording() {
    this.recording = true;
    this.stats.clear();
    this.recordedCommits = 0;
  }

  stopRecording() {
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  reset() {
    this.stats.clear();
    this.recordedCommits = 0;
    this.flashCounts = new WeakMap();
  }

  handleCommit(root: Fiber): CommitResult {
    this.commitSeq += 1;
    const flashes: CommitResult['flashes'] = [];
    let rendered = 0;
    let durationMs = 0;

    const rootFiber = root?.current;
    if (!rootFiber) {
      return { flashes, rendered, durationMs, supported: this.sawDuration };
    }

    const stack: Fiber[] = [rootFiber];
    while (stack.length) {
      const fiber = stack.pop();
      const kids = children(fiber);
      for (const k of kids) stack.push(k);

      const actual = fiber.actualDuration;
      if (typeof actual === 'number') this.sawDuration = true;
      const childSum = kids.reduce(
        (sum, k) => sum + (typeof k.actualDuration === 'number' ? k.actualDuration : 0),
        0,
      );
      const self = (typeof actual === 'number' ? actual : 0) - childSum;
      // 自己時間が実質ゼロ = このコミットで自分は render していない (子の伝播のみ)
      if (self <= 0.01) continue;

      const isComposite = COMPONENT_TAGS.has(fiber.tag);
      const isHost = typeof fiber.type === 'string' && fiber.stateNode instanceof Element;

      if (isComposite) {
        rendered += 1;
        durationMs += self;
        if (this.recording) {
          const name = getFiberName(fiber) ?? 'Anonymous';
          const stat = this.stats.get(name) ?? {
            name,
            count: 0,
            selfMs: 0,
            lastCommit: 0,
          };
          stat.count += 1;
          stat.selfMs += self;
          stat.lastCommit = this.commitSeq;
          this.stats.set(name, stat);
        }
      }

      if (isHost) {
        const element = fiber.stateNode as Element;
        const heat = (this.flashCounts.get(element) ?? 0) + 1;
        this.flashCounts.set(element, heat);
        flashes.push({ element, heat });
      }
    }

    if (this.recording && rendered > 0) this.recordedCommits += 1;
    return { flashes, rendered, durationMs, supported: this.sawDuration };
  }

  /** 記録スナップショット (再描画回数の多い順) */
  snapshot(): { stats: RenderStat[]; commits: number } {
    const stats = [...this.stats.values()].sort(
      (a, b) => b.count - a.count || b.selfMs - a.selfMs,
    );
    return { stats, commits: this.recordedCommits };
  }
}
