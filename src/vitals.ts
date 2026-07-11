/**
 * ページパフォーマンス計測 (Web Vitals)。
 * Lighthouse / PageSpeed Insights が使えない Closed な開発・社内アプリでも、
 * 実ブラウザの PerformanceObserver から Core Web Vitals 相当を取得する。
 * MAIN world で動き、拡張 API に依存しない。
 *
 * 取得指標:
 * - LCP  (Largest Contentful Paint)  … 主要コンテンツの表示時間
 * - CLS  (Cumulative Layout Shift)   … レイアウトのガタつき (session window 方式)
 * - INP  (Interaction to Next Paint) … 操作応答性 (観測した最悪値で近似)
 * - FCP  (First Contentful Paint)
 * - TTFB (Time to First Byte)
 * - Long Tasks 件数 / 合計ブロッキング時間 (TBT 近似)
 */

export type VitalId = 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
export type VitalRating = 'good' | 'needs-improvement' | 'poor';

/** web.dev の公式しきい値 (good 上限 / poor 下限)。CLS は無次元、他は ms */
const THRESHOLDS: Record<VitalId, [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rateVital(id: VitalId, value: number): VitalRating {
  const [good, poor] = THRESHOLDS[id];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

/** 表示用フォーマット (CLS のみ無次元、他は ms → 可読単位) */
export function formatVital(id: VitalId, value: number): string {
  if (id === 'CLS') return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

export interface VitalsSnapshot {
  /** 値が観測できた指標のみ入る (null = 未観測) */
  metrics: { id: VitalId; value: number; rating: VitalRating }[];
  longTasks: number;
  /** Long Task の 50ms 超過分の合計 (Total Blocking Time 近似, ms) */
  blockingMs: number;
}

/**
 * CLS の session window 集計 (web.dev の定義):
 * 直近の入力から 500ms 以内のシフトは除外し、シフト間隔 1s 以内・窓全長 5s 以内を
 * 1 セッションとして合算、最大セッション値を CLS とする。
 * 純関数 reducer としてテスト可能にする。
 */
export interface ClsState {
  max: number;
  current: number;
  windowStart: number;
  lastShift: number;
}

export const CLS_INITIAL: ClsState = { max: 0, current: 0, windowStart: -1, lastShift: -1 };

export function updateCls(
  state: ClsState,
  entry: { value: number; startTime: number; hadRecentInput: boolean },
): ClsState {
  if (entry.hadRecentInput || entry.value <= 0) return state;
  const gap = entry.startTime - state.lastShift;
  const span = entry.startTime - state.windowStart;
  const newSession = state.windowStart < 0 || gap > 1000 || span > 5000;
  const current = newSession ? entry.value : state.current + entry.value;
  return {
    max: Math.max(state.max, current),
    current,
    windowStart: newSession ? entry.startTime : state.windowStart,
    lastShift: entry.startTime,
  };
}

/** PerformanceObserver ベースの収集器。observe 失敗 (未対応ブラウザ) は黙って無視 */
export class VitalsCollector {
  private lcp: number | null = null;
  private fcp: number | null = null;
  private inp: number | null = null;
  private cls: ClsState = CLS_INITIAL;
  private clsSeen = false;
  private longTasks = 0;
  private blockingMs = 0;
  private observers: PerformanceObserver[] = [];

  start() {
    this.observe('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1];
      if (last) this.lcp = last.startTime;
    });
    this.observe('paint', (entries) => {
      for (const e of entries) {
        if (e.name === 'first-contentful-paint') this.fcp = e.startTime;
      }
    });
    this.observe('layout-shift', (entries) => {
      for (const e of entries) {
        this.cls = updateCls(this.cls, e as unknown as Parameters<typeof updateCls>[1]);
        this.clsSeen = true;
      }
    });
    // INP 近似: interaction を持つ event entry の最悪 duration。
    // 正式な INP は p98 だが、開発時のボトルネック発見には最悪値が実用的。
    this.observe(
      'event',
      (entries) => {
        for (const e of entries) {
          const anyE = e as unknown as { interactionId?: number; duration: number };
          if (anyE.interactionId && (this.inp === null || anyE.duration > this.inp)) {
            this.inp = anyE.duration;
          }
        }
      },
      { durationThreshold: 40 },
    );
    this.observe('longtask', (entries) => {
      for (const e of entries) {
        this.longTasks += 1;
        this.blockingMs += Math.max(e.duration - 50, 0);
      }
    });
  }

  stop() {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
  }

  private observe(
    type: string,
    cb: (entries: PerformanceEntry[]) => void,
    extra?: Record<string, unknown>,
  ) {
    try {
      const obs = new PerformanceObserver((list) => cb(list.getEntries()));
      // buffered: true で observer 開始前 (ページロード初期) のエントリも遡って取得
      obs.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      this.observers.push(obs);
    } catch {
      // 未対応の entry type は無視 (ブラウザ差異)
    }
  }

  private ttfb(): number | null {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      return nav && nav.responseStart > 0 ? nav.responseStart : null;
    } catch {
      return null;
    }
  }

  snapshot(): VitalsSnapshot {
    const metrics: VitalsSnapshot['metrics'] = [];
    const push = (id: VitalId, value: number | null) => {
      if (value !== null) metrics.push({ id, value, rating: rateVital(id, value) });
    };
    push('LCP', this.lcp);
    push('INP', this.inp);
    push('CLS', this.clsSeen ? this.cls.max : null);
    push('FCP', this.fcp);
    push('TTFB', this.ttfb());
    return { metrics, longTasks: this.longTasks, blockingMs: this.blockingMs };
  }
}
