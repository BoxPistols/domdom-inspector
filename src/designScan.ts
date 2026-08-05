import {
  buildCoverage,
  type CoverageReport,
  type Occurrence,
  type TokenSourceCounts,
} from './coverage';
import { extractDesignStyle } from './designStyle';
import { annotateProp, type TokenDict } from './tokenDict';
import { DEFAULT_GRID_PX, lintSpacing } from './tokenLint';
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

/**
 * スタイルの供給元。CSS-in-JS (emotion / styled-components) は **生成される CSS が常に
 * リテラル**になるため、来歴 (var か literal か) から「ハードコードかどうか」を判定できない。
 * MUI の sx={{ p: 2 }} は theme 由来だが出力は padding: 16px になる — これを
 * 「ベタ書き = トークン変更に追従しない」と報告するのは誤り。検出したら来歴の主張を止める。
 */
export type StyleSource = 'css-in-js' | 'stylesheet';

export interface DesignScan {
  /** 実際に計測した要素数 (可視のみ) */
  elementCount: number;
  /**
   * DOM 全ノード数 (`querySelectorAll('*')`)。**elementCount と比較してはいけない**:
   * head 配下・display:none 配下・SVG の子まで含む別の母集団で、並べると打ち切りが
   * 起きていないページでも部分計測に見える。**打ち切りの申告には truncated を使う。**
   */
  candidateCount: number;
  /**
   * 上限に当たって走査を途中でやめたか。true のとき率はページ全体の値ではない。
   * 「可視要素がちょうど上限だが最後まで回せた」を打ち切り扱いにしない
   * (以前は candidateCount と比べていたため、非可視要素が多いページで偽陽性が出た)。
   */
  truncated: boolean;
  /** 来歴 (var/literal) を判定できたか。false なら来歴の率を出してはいけない */
  originAvailable: boolean;
  /**
   * 来歴収集が時間予算 (ORIGIN_BUDGET_MS) を超えて打ち切られたか。
   * originAvailable=false の理由は「予算切れ」と「そもそも 1 件も取れない (クロスオリジン
   * CSS 等)」の 2 つあり、**取り違えると表示する理由が嘘になる**ので別に持つ。
   */
  originBudgetExceeded: boolean;
  /** スタイルの供給元。'css-in-js' のとき来歴からハードコードを判定してはいけない */
  styleSource: StyleSource;
  /** 照合に使ったトークン辞書の規模 (0 なら未設定 = グリッド検査のみ) */
  tokenCounts: { colors: number; sizes: number };
  /**
   * 辞書の出所内訳 (手動貼り付け / アプリのテーマ由来)。渡されなければ null。
   * 自動テーマは密なラダーを作るため一致率が構造的に上がる (§6-5) ので、内訳を伏せると
   * 率の意味が変わっていることに気づけない。**併合は重複排除しないので合計は上限値。**
   */
  tokenSources: TokenSourceCounts | null;
  /** グリッド判定に使った刻み幅。表示側にリテラルを書かせない */
  grid: number;
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
/**
 * CSS-in-JS を検出する。emotion / styled-components はランタイムで <style> を挿入し、
 * その要素に固有の data 属性を付ける。存在すれば「CSS 出力は常にリテラル」と分かる。
 */
export function detectStyleSource(doc: Document): StyleSource {
  try {
    const marked = doc.querySelector(
      'style[data-emotion], style[data-styled], style[data-styled-components], style[data-goober], style[data-linaria]',
    );
    return marked ? 'css-in-js' : 'stylesheet';
  } catch {
    return 'stylesheet';
  }
}

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
  opts: {
    skip?: (el: Element) => boolean;
    grid?: number;
    now?: () => number;
    /** 走査要素数の上限 (既定 MAX_ELEMENTS)。将来のハイライト側と述語を共有するため受ける */
    max?: number;
    /** 辞書の出所内訳。呼び出し側 (inspector.content) だけが 2 辞書を知っている */
    tokenSources?: TokenSourceCounts;
  } = {},
): DesignScan {
  const grid = opts.grid ?? DEFAULT_GRID_PX;
  const now = opts.now ?? (() => Date.now());
  const max = opts.max ?? MAX_ELEMENTS;
  const counts = new Map<string, Occurrence>();
  let elementCount = 0;
  let originAvailable = true;
  let originBudgetExceeded = false;
  /** 上限に当たって走査を打ち切ったか (最後まで回せたかで判定する) */
  let truncated = false;

  const all = root.querySelectorAll('*');
  const candidateCount = all.length;
  const started = now();

  for (let i = 0; i < all.length; i += 1) {
    if (elementCount >= max) {
      // 未走査の要素を残して抜けた = 打ち切り。ここでしか true にしない
      truncated = true;
      break;
    }
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
    // withVars: false — 集計は変数名を持たない (Occurrence は label/value/count/origin のみ)。
    // 予算切れ後は withOrigin も false になり、CSSOM 全走査自体が行われなくなる
    for (const prop of extractDesignStyle(el, {
      withOrigin: !originBudgetExceeded,
      withVars: false,
    })) {
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

  const styleSource = detectStyleSource(
    (root as Document).querySelectorAll ? ((root as Document).ownerDocument ?? (root as Document)) : document,
  );

  // カバレッジは切り捨て前の全件から。来歴を主張してよいかは **ここで 1 度だけ**決める
  // (CSS-in-JS は theme 由来でも出力が常にリテラルになるため来歴から判定できない)
  const coverage = buildCoverage(occurrences, dict, {
    grid,
    originTrusted: originAvailable && styleSource !== 'css-in-js',
  });

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
    truncated,
    originAvailable,
    originBudgetExceeded,
    styleSource,
    tokenCounts: { colors: dict.colors.length, sizes: dict.sizes.length },
    tokenSources: opts.tokenSources ?? null,
    grid,
    stats,
    statsTotals,
    coverage,
  };
}
