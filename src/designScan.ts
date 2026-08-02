import { buildCoverage, type CoverageReport, type Occurrence } from './coverage';
import { extractDesignStyle } from './designStyle';
import { annotateProp, type TokenDict } from './tokenDict';
import { lintSpacing } from './tokenLint';
import type { DesignProp } from './types';

/**
 * ページ全体のデザイン値スキャン。
 * 出口は 2 つ: (1) popup のトークンカバレッジパネル (決定論) (2) BYOK AI 監査の入力。
 * プライバシー原則: **スタイル値と件数のみ**。テキスト・属性値・URL・クラス名などページ内容は
 * 一切含めない (含めるのはタグ名まで)。design 経路 (framework 非依存・Fiber import 禁止)。
 */

export interface ScanValueStat {
  /** 表示用に整形済みの値 (designStyle と同じ整形) */
  value: string;
  /** 使用回数 (要素数) */
  count: number;
  /** トークン一致名 (annotateProp の hit) */
  token: string | null;
  /** 不一致時の最近傍トークン名 */
  nearest: string | null;
  /** 4px グリッド外の px を含む (spacing 系のみ) */
  offGrid: boolean;
}

/** ラベルごとの全体像 (サンプル列を切り捨てても総数が分かるように) */
export interface ScanLabelTotals {
  uniqueValues: number;
  shown: number;
  occurrences: number;
}

export interface DesignScan {
  /** 実際に計測した要素数 (可視のみ) */
  elementCount: number;
  /** 走査候補だった要素数。elementCount と違えば打ち切られている */
  candidateCount: number;
  /** MAX_ELEMENTS で打ち切ったか。true のとき率はページ全体の値ではない */
  truncated: boolean;
  /** 来歴 (var/literal) を判定できたか。false なら来歴の率を出してはいけない */
  originAvailable: boolean;
  /** 照合に使ったトークン辞書の規模 (0 なら未設定 = グリッド検査のみ) */
  tokenCounts: { colors: number; sizes: number };
  /** label → 使用値の頻度順リスト (上位 MAX_VALUES_PER_LABEL 件のサンプル) */
  stats: Record<string, ScanValueStat[]>;
  /** label → 切り捨て前の総数 (サンプルが全部だと誤読させないため) */
  statsTotals: Record<string, ScanLabelTotals>;
  /** 切り捨て前の全件から計算したカバレッジ */
  coverage: CoverageReport;
}

/** 1 ラベルあたりの報告上限 (頻度順)。AI プロンプトと UI の肥大防止 */
const MAX_VALUES_PER_LABEL = 20;
/** 走査する要素数の上限 (巨大ページでの暴走防止) */
const MAX_ELEMENTS = 2000;
/** 来歴収集 (CSSOM 走査) に使ってよい時間。超えたら来歴だけ諦める */
const ORIGIN_BUDGET_MS = 1500;
/** スキャン対象のラベル (shadow/weight/lh は監査ノイズが多いので除外) */
const SCAN_LABELS = new Set(['color', 'bg', 'font', 'padding', 'margin', 'gap', 'radius']);

/**
 * root 以下の可視要素を走査し、デザイン値の使用頻度 + トークン照合 + グリッド検査を集計する。
 * skip でオーバーレイ等の自前 UI を除外できる。
 *
 * 重要: **カバレッジは切り捨て前の全件から計算する**。上位 20 件のサンプルから率を出すと
 * 「高頻度 = 一致しやすい値」に偏り、実態より高く出る。
 */
export function scanDesign(
  root: ParentNode,
  dict: TokenDict,
  opts: { skip?: (el: Element) => boolean; grid?: number; now?: () => number } = {},
): DesignScan {
  const grid = opts.grid ?? 4;
  const now = opts.now ?? (() => Date.now());
  const counts = new Map<string, Occurrence>();
  let elementCount = 0;
  let originAvailable = true;
  let originBudgetExceeded = false;

  const all = root.querySelectorAll('*');
  const candidateCount = all.length;
  const started = now();

  for (let i = 0; i < all.length && elementCount < MAX_ELEMENTS; i += 1) {
    const el = all[i];
    if (opts.skip?.(el)) continue;
    // 不可視要素 (display:none 配下等) はデザイン監査の対象外
    if (
      typeof (el as HTMLElement).checkVisibility === 'function' &&
      !(el as HTMLElement).checkVisibility()
    ) {
      continue;
    }
    elementCount += 1;
    // 来歴収集は CSSOM 全走査で高価。予算を超えたら来歴だけ諦め、一致率は計測を続ける
    // (来歴パネルを間違った値で出すより「出せない」と言う方が誠実)
    if (!originBudgetExceeded && now() - started > ORIGIN_BUDGET_MS) {
      originBudgetExceeded = true;
      originAvailable = false;
    }
    for (const prop of extractDesignStyle(el, { withOrigin: !originBudgetExceeded })) {
      if (!SCAN_LABELS.has(prop.label)) continue;
      const origin = originBudgetExceeded ? 'unknown' : (prop.origin ?? 'unknown');
      const key = `${prop.label} ${prop.value} ${origin}`;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label: prop.label, value: prop.value, count: 1, origin });
    }
  }

  const occurrences = [...counts.values()];
  // 来歴が 1 件も取れていなければ (クロスオリジン CSS 等) 来歴の率は出さない
  if (!occurrences.some((o) => o.origin === 'var' || o.origin === 'literal')) {
    originAvailable = false;
  }

  // カバレッジは切り捨て前の全件から
  const coverage = buildCoverage(occurrences, dict, grid);

  // 表示用サンプル: 同一 label+value を来歴を跨いで束ね、頻度順に上位だけ残す
  const merged = new Map<string, { label: string; value: string; count: number }>();
  for (const o of occurrences) {
    const key = `${o.label} ${o.value}`;
    const e = merged.get(key);
    if (e) e.count += o.count;
    else merged.set(key, { label: o.label, value: o.value, count: o.count });
  }

  const stats: Record<string, ScanValueStat[]> = {};
  const statsTotals: Record<string, ScanLabelTotals> = {};
  for (const { label, value, count } of merged.values()) {
    const prop: DesignProp = { label, value };
    const chip = annotateProp(prop, dict);
    const stat: ScanValueStat = {
      value,
      count,
      token: chip?.kind === 'hit' ? chip.names.join(', ') : null,
      nearest: chip?.kind === 'miss' ? chip.nearest : null,
      offGrid: lintSpacing([prop], grid).length > 0,
    };
    (stats[label] ??= []).push(stat);
    const t = (statsTotals[label] ??= { uniqueValues: 0, shown: 0, occurrences: 0 });
    t.uniqueValues += 1;
    t.occurrences += count;
  }
  for (const label of Object.keys(stats)) {
    stats[label].sort((a, b) => b.count - a.count);
    stats[label] = stats[label].slice(0, MAX_VALUES_PER_LABEL);
    statsTotals[label].shown = stats[label].length;
  }

  return {
    elementCount,
    candidateCount,
    truncated: elementCount >= MAX_ELEMENTS && candidateCount > elementCount,
    originAvailable,
    tokenCounts: { colors: dict.colors.length, sizes: dict.sizes.length },
    stats,
    statsTotals,
    coverage,
  };
}
