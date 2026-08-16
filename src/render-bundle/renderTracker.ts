import { COMPONENT_TAGS, getFiberName } from '../fiber';
import { classifyRenderCause, type RenderCause } from './renderCause';

type Fiber = any;

/**
 * React が「このコミットで実際に render 関数を実行した」Fiber に立てるフラグ。
 * React DevTools の didFiberRender と同じ判定基準で、dev / production 両ビルドで立つ
 * (react-reconciler の beginWork が常にセットする)。
 */
const PERFORMED_WORK = 0b01;

/** flags (React >= 16.9) / effectTag (それ以前) の両対応で読む */
function flagsOf(fiber: Fiber): number | undefined {
  const f = fiber.flags ?? fiber.effectTag;
  return typeof f === 'number' ? f : undefined;
}

/** 記録セッションでの 1 コンポーネントの再描画統計 */
export interface RenderStat {
  name: string;
  /** 再描画回数 (自己レンダー = 実際に render 関数が走った回数、mount 含む) */
  count: number;
  /** 累積の自己レンダー時間 (ms)。Profiler タイマ非対応時は 0 */
  selfMs: number;
  /** 単一コミットでの最大自己時間 (ms) — スパイク検出用 */
  maxSelfMs: number;
  /** 原因別内訳。wasted (memo 候補) は causes.parent と同値 */
  causes: Record<RenderCause, number>;
  /** 直近の再レンダーで実際に値が変わった props キー (チューニングの手がかり) */
  lastChangedProps: string[];
  /** 直近の再レンダーで値が変わった状態系 hook のインデックス */
  lastChangedHooks: number[];
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
  /** Profiler タイマ (actualDuration) が利用可能か = dev/profiling ビルドか */
  supported: boolean;
}

/** 記録セッション中のコミット時系列 (レポートのタイムライン用) */
export interface CommitLogEntry {
  /** 記録開始からの相対時刻 (ms) */
  t: number;
  /** このコミットで再レンダーしたコンポーネント数 */
  rendered: number;
  /** 自己時間合計 (ms) */
  selfMs: number;
}

export interface RenderSnapshot {
  stats: RenderStat[];
  commits: number;
  /** 記録セッションの実時間 (ms)。未記録なら 0 */
  wallMs: number;
  /** 全コンポーネント自己時間の合計 (ms) */
  totalSelfMs: number;
  /** 無駄レンダー (parent 巻き込まれ) の総数 */
  totalWasted: number;
  timeline: CommitLogEntry[];
  /** Profiler タイマが観測できたか */
  timingSupported: boolean;
}

const TIMELINE_LIMIT = 2000;

/**
 * コミットされた Fiber ツリーを走査し、各コミットで「自分自身が」再描画した
 * コンポーネント / ホスト要素を検出する。
 *
 * 判定は React DevTools と同一基準 (正確性の根幹):
 * - コンポーネント: `flags & PerformedWork` — render 関数が実際に走った Fiber にのみ
 *   React が立てるフラグで、dev / production 両方で有効。self 時間ヒューリスティック
 *   (旧実装) のような誤検出・検出漏れがない。
 * - ホスト要素: alternate と memoizedProps の参照比較 — 親の JSX が再評価されたときだけ
 *   新しい props オブジェクトになるため「実際に再描画された DOM」だけがフラッシュする。
 *
 * 走査は alternate 差分で bailout サブツリーを丸ごとスキップする (DevTools と同じ):
 * fiber.child === alternate.child ならその下は前コミットの複製すら作られていない =
 * 何も起きていないので降りない。これにより大規模ツリーでも走査コストは
 * 「実際に変化した部分」に比例する。
 *
 * 時間は Profiler タイマ (actualDuration、dev/profiling ビルドのみ) の自己時間
 * (= actualDuration − 直下の子の合計。DevTools の selfDuration と同じ定義)。
 */
export class RenderTracker {
  private commitSeq = 0;
  private recording = false;
  private stats = new Map<string, RenderStat>();
  private recordedCommits = 0;
  private timeline: CommitLogEntry[] = [];
  private recordStartedAt = 0;
  private recordWallMs = 0;
  /** 要素ごとの累積再描画回数 (ヒートマップ用、GC 連動) */
  private flashCounts = new WeakMap<Element, number>();
  private sawDuration = false;
  /** now は注入可能 (テストで固定時刻にする) */
  constructor(private now: () => number = () => performance.now()) {}

  startRecording() {
    this.recording = true;
    this.stats.clear();
    this.recordedCommits = 0;
    this.timeline = [];
    this.recordStartedAt = this.now();
    this.recordWallMs = 0;
  }

  stopRecording() {
    if (this.recording) this.recordWallMs = this.now() - this.recordStartedAt;
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  reset() {
    this.stats.clear();
    this.recordedCommits = 0;
    this.timeline = [];
    this.recordWallMs = 0;
    this.recordStartedAt = this.now();
    this.flashCounts = new WeakMap();
  }

  handleCommit(root: Fiber): CommitResult {
    this.commitSeq += 1;
    const result: CommitResult = {
      flashes: [],
      rendered: 0,
      durationMs: 0,
      supported: this.sawDuration,
    };

    const rootFiber = root?.current;
    if (!rootFiber) return result;

    // 初回マウントは全ツリーが新規なので、ページロード直後の全画面フラッシュは
    // ノイズとして抑制し記録のみ行う。判定は「alternate が無い」だけでは不十分:
    // React は初回コミットでも work-in-progress 複製で HostRoot に alternate を
    // 作るため、実際には alternate.child === null (空だった元 root) を見る。
    const alt = rootFiber.alternate;
    const isInitialMount = !alt || alt.child == null;
    this.walk(rootFiber, result, isInitialMount);
    result.supported = this.sawDuration;

    if (this.recording && result.rendered > 0) {
      this.recordedCommits += 1;
      if (this.timeline.length < TIMELINE_LIMIT) {
        this.timeline.push({
          t: this.now() - this.recordStartedAt,
          rendered: result.rendered,
          selfMs: result.durationMs,
        });
      }
    }
    return result;
  }

  /**
   * alternate 差分ベースの走査。update ノードは子ポインタが前回と同一なら
   * サブツリーを丸ごとスキップする。mount サブツリー内は全ノードが新規。
   */
  private walk(rootFiber: Fiber, result: CommitResult, suppressFlash: boolean) {
    const stack: Fiber[] = [rootFiber];
    while (stack.length) {
      const fiber = stack.pop();
      const alt = fiber.alternate ?? null;

      // 1 パス: 直下の子の actualDuration を合計しつつ、降りる必要があれば push。
      // mount ノード (alt 無し) は全子が新規なので常に降りる。
      // update ノードは child が前回と同一参照ならサブツリー未変更 = スキップ。
      const descend = !alt || fiber.child !== alt.child;
      let childSum = 0;
      let c = fiber.child;
      while (c) {
        if (descend) stack.push(c);
        const d = c.actualDuration;
        if (typeof d === 'number') childSum += d;
        c = c.sibling;
      }

      const isComposite = COMPONENT_TAGS.has(fiber.tag);
      const isHost = typeof fiber.type === 'string' && fiber.stateNode instanceof Element;

      if (isComposite) {
        const didRender = this.didComponentRender(fiber, alt);
        if (!didRender) continue;

        const actual = fiber.actualDuration;
        const hasTiming = typeof actual === 'number';
        if (hasTiming) this.sawDuration = true;
        const selfMs = hasTiming ? Math.max(actual - childSum, 0) : 0;

        result.rendered += 1;
        result.durationMs += selfMs;
        if (this.recording) this.record(fiber, alt, selfMs);
        continue;
      }

      if (isHost) {
        // 実際に再描画された DOM だけをフラッシュ: 新規配置 (alt 無し) または
        // 親の JSX 再評価で props オブジェクトが作り直されたもの。
        const didPaint = !alt || alt.memoizedProps !== fiber.memoizedProps;
        if (didPaint && !suppressFlash) {
          const element = fiber.stateNode as Element;
          const heat = (this.flashCounts.get(element) ?? 0) + 1;
          this.flashCounts.set(element, heat);
          result.flashes.push({ element, heat });
        }
      }
    }
  }

  /**
   * コンポーネントが「このコミットで」render したか。
   * PerformedWork フラグが一次判定 (DevTools と同一)。フラグが読めない環境
   * (非標準 renderer 等) のみ alternate/props 参照差分にフォールバック。
   */
  private didComponentRender(fiber: Fiber, alt: Fiber | null): boolean {
    if (!alt) return true; // mount
    const flags = flagsOf(fiber);
    if (flags !== undefined) return (flags & PERFORMED_WORK) === PERFORMED_WORK;
    return alt.memoizedProps !== fiber.memoizedProps;
  }

  private record(fiber: Fiber, alt: Fiber | null, selfMs: number) {
    const name = getFiberName(fiber) ?? 'Anonymous';
    const detail = classifyRenderCause(alt, fiber);
    const stat = this.stats.get(name) ?? {
      name,
      count: 0,
      selfMs: 0,
      maxSelfMs: 0,
      causes: { mount: 0, state: 0, props: 0, parent: 0, other: 0 },
      lastChangedProps: [],
      lastChangedHooks: [],
      lastCommit: 0,
    };
    stat.count += 1;
    stat.selfMs += selfMs;
    if (selfMs > stat.maxSelfMs) stat.maxSelfMs = selfMs;
    stat.causes[detail.cause] += 1;
    if (detail.changedProps.length) stat.lastChangedProps = detail.changedProps.slice(0, 8);
    if (detail.changedHooks.length) stat.lastChangedHooks = detail.changedHooks.slice(0, 8);
    stat.lastCommit = this.commitSeq;
    this.stats.set(name, stat);
  }

  /** 記録スナップショット (自己時間 → 回数の順で重い順に並ぶ) */
  snapshot(): RenderSnapshot {
    const stats = [...this.stats.values()].sort(
      (a, b) => b.selfMs - a.selfMs || b.count - a.count,
    );
    let totalSelfMs = 0;
    let totalWasted = 0;
    for (const s of stats) {
      totalSelfMs += s.selfMs;
      totalWasted += s.causes.parent;
    }
    const wallMs = this.recording ? this.now() - this.recordStartedAt : this.recordWallMs;
    return {
      stats,
      commits: this.recordedCommits,
      wallMs,
      totalSelfMs,
      totalWasted,
      timeline: this.timeline,
      timingSupported: this.sawDuration,
    };
  }
}
