import {
  classifyDeclaration,
  LABEL_FAMILY,
  type Family,
  type TokenDict,
} from './tokenDict';
import { extractPxValues } from './tokenLint';
import type { DesignProp } from './types';

/**
 * トークンカバレッジの集計 (純関数)。
 *
 * 設計の芯は 2 つ:
 * 1. **一致 (今の正しさ) と来歴 (これからも正しくあり続けるか) を直交させる。**
 *    一致判定を「var 経由必須」にはしない — Tailwind も MUI の sx も既定でリテラルを
 *    出力するため、var 必須にすると完全準拠のアプリが 0% になる。代わりに来歴を別軸で出し、
 *    「ベタ書きだが一致」= トークン変更で取り残される予防対象、として区別する。
 * 2. **判定できなかったものを分母に入れない。** 該当トークンが無い (noDict) / 解析できない
 *    値 (unmeasurable) を 0 点扱いすると率が嘘になる。別枠で「判定カバー率」として申告する。
 */

/** 1 要素 × 1 ラベルの計測値 1 件 (同一値は count でまとめる) */
export interface Occurrence {
  label: string;
  value: string;
  count: number;
  origin: DesignProp['origin'];
}

export interface FamilyCoverage {
  family: Family;
  /** 判定できた件数 (hit + near + far)。0 なら率を出さない */
  judged: number;
  hit: number;
  near: number;
  far: number;
  /** 該当カテゴリのトークンが無くて判定できなかった件数 */
  noDict: number;
  /** 値を解析できず判定できなかった件数 */
  unmeasurable: number;
  /** 判定できた値の種類数 (語彙ベース) */
  distinctJudged: number;
  distinctHit: number;
}

/** 来歴 × 一致の 4 象限。②③④ は意味が違うので 1 つの率にまとめない */
export interface OriginMatrix {
  varHit: number;
  varMiss: number;
  literalHit: number;
  literalMiss: number;
  /** 継承値 / UA 既定 / CSSOM 不可 で象限に入らなかった件数 */
  excluded: number;
}

export interface TopOffender {
  label: string;
  value: string;
  count: number;
  nearest: string | null;
  origin: DesignProp['origin'];
}

export interface CoverageReport {
  families: FamilyCoverage[];
  /** 全ファミリ合算 (micro-average)。必ず実数と併記して表示する */
  overall: { judged: number; hit: number };
  /** 収集した全件のうち判定できた割合の材料 */
  measurable: { judged: number; total: number };
  matrix: OriginMatrix;
  /** 来歴が判定できた件数 (var + literal)。0 なら来歴セクションを出さない */
  originKnown: number;
  originVar: number;
  /** 4px グリッド外 (余白系のみ、トークン一致は抑制) */
  offGrid: { off: number; total: number };
  /** 直すと効く値 (far/near を件数降順) */
  top: TopOffender[];
}

const FAMILY_ORDER: Family[] = ['color', 'spacing', 'radius', 'font'];
const SPACING_LABELS = new Set(['padding', 'margin', 'gap', 'radius']);
const MAX_TOP = 5;

function emptyFamily(family: Family): FamilyCoverage {
  return {
    family,
    judged: 0,
    hit: 0,
    near: 0,
    far: 0,
    noDict: 0,
    unmeasurable: 0,
    distinctJudged: 0,
    distinctHit: 0,
  };
}

/**
 * 率を百分率にする。**丸めで嘘をつかない**: 一部でも外れているのに 100%、
 * 1 件でも当たっているのに 0% とは表示しない。分母 0 は null (率を出さない)。
 */
export function ratePercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const raw = (numerator / denominator) * 100;
  const rounded = Math.round(raw);
  if (rounded === 100 && numerator < denominator) return 99;
  if (rounded === 0 && numerator > 0) return 1;
  return rounded;
}

/**
 * 計測結果 (オカレンス列) を集計する。**切り捨て前の全件**を渡すこと。
 * grid は 4px グリッド判定の刻み幅。
 */
export function buildCoverage(
  occurrences: Occurrence[],
  dict: TokenDict,
  grid = 4,
): CoverageReport {
  const families = new Map<Family, FamilyCoverage>(
    FAMILY_ORDER.map((f) => [f, emptyFamily(f)]),
  );
  const distinct = new Map<Family, Map<string, boolean>>(
    FAMILY_ORDER.map((f) => [f, new Map()]),
  );
  const matrix: OriginMatrix = { varHit: 0, varMiss: 0, literalHit: 0, literalMiss: 0, excluded: 0 };
  let originKnown = 0;
  let originVar = 0;
  let offGridOff = 0;
  let offGridTotal = 0;
  const offenders: TopOffender[] = [];

  for (const occ of occurrences) {
    const family = LABEL_FAMILY[occ.label];
    if (!family) continue;
    const fam = families.get(family)!;
    const prop: DesignProp = { label: occ.label, value: occ.value };
    const verdict = classifyDeclaration(prop, dict);
    const judged =
      verdict.outcome !== 'noDict' && verdict.outcome !== 'unmeasurable';

    // --- 一致 (要素加重) ---
    if (judged) {
      fam.judged += occ.count;
      fam[verdict.outcome as 'hit' | 'near' | 'far'] += occ.count;
    } else {
      fam[verdict.outcome as 'noDict' | 'unmeasurable'] += occ.count;
    }

    // --- 語彙 (ユニーク値) ---
    if (judged) {
      const seen = distinct.get(family)!;
      const key = `${occ.label} ${occ.value}`;
      if (!seen.has(key)) seen.set(key, verdict.outcome === 'hit');
    }

    // --- 来歴 × 一致の 4 象限 ---
    if (judged && (occ.origin === 'var' || occ.origin === 'literal')) {
      originKnown += occ.count;
      if (occ.origin === 'var') originVar += occ.count;
      const hit = verdict.outcome === 'hit';
      if (occ.origin === 'var') {
        if (hit) matrix.varHit += occ.count;
        else matrix.varMiss += occ.count;
      } else if (hit) matrix.literalHit += occ.count;
      else matrix.literalMiss += occ.count;
    } else {
      matrix.excluded += occ.count;
    }

    // --- 4px グリッド (辞書不要) ---
    if (SPACING_LABELS.has(occ.label)) {
      const pxs = extractPxValues(occ.value).filter((px) => px !== 0);
      if (pxs.length) {
        offGridTotal += occ.count;
        // トークンに一致した値はグリッド警告を抑制する (overlay と同じ規約)
        const off = verdict.outcome !== 'hit' && pxs.some((px) => px % grid !== 0);
        if (off) offGridOff += occ.count;
      }
    }

    // --- 直すと効く値 ---
    if (verdict.outcome === 'near' || verdict.outcome === 'far') {
      offenders.push({
        label: occ.label,
        value: occ.value,
        count: occ.count,
        nearest: verdict.nearest,
        origin: occ.origin,
      });
    }
  }

  for (const [family, seen] of distinct) {
    const fam = families.get(family)!;
    fam.distinctJudged = seen.size;
    fam.distinctHit = [...seen.values()].filter(Boolean).length;
  }

  const list = FAMILY_ORDER.map((f) => families.get(f)!);
  const overall = list.reduce(
    (acc, f) => ({ judged: acc.judged + f.judged, hit: acc.hit + f.hit }),
    { judged: 0, hit: 0 },
  );
  const total = list.reduce((n, f) => n + f.judged + f.noDict + f.unmeasurable, 0);

  offenders.sort((a, b) => b.count - a.count);

  return {
    families: list,
    overall,
    measurable: { judged: overall.judged, total },
    matrix,
    originKnown,
    originVar,
    offGrid: { off: offGridOff, total: offGridTotal },
    top: offenders.slice(0, MAX_TOP),
  };
}

/** そのファミリについて率を出してよいか (判定できた件数が 0 なら出さない) */
export function familyRate(f: FamilyCoverage): number | null {
  return ratePercent(f.hit, f.judged);
}

/** 判定できた件数が少なすぎて率が意味を持たない閾値 */
export const LOW_SAMPLE_THRESHOLD = 10;

/** 辞書が空か (率を一切出さず一貫性指標に縮退すべき状態) */
export function isDictEmpty(dict: TokenDict): boolean {
  return dict.colors.length === 0 && dict.sizes.length === 0;
}

/** 集計結果を決定論 Markdown にする (共有・AI 入力用。UI は i18n、データは英語固定) */
export function formatCoverageMarkdown(
  report: CoverageReport,
  meta: { elementCount: number; candidateCount: number; truncated: boolean; originAvailable: boolean },
): string {
  const lines: string[] = ['# Design token coverage', ''];
  lines.push(
    meta.truncated
      ? `Measured the first ${meta.elementCount} of ${meta.candidateCount} elements.`
      : `Measured ${meta.elementCount} elements.`,
  );
  lines.push('');
  lines.push('## Match rate by family');
  for (const f of report.families) {
    const rate = familyRate(f);
    lines.push(
      rate === null
        ? `- ${f.family}: not measurable (${f.noDict} without a token of that kind, ${f.unmeasurable} unparseable)`
        : `- ${f.family}: ${rate}% (${f.hit}/${f.judged})` +
          (f.judged < LOW_SAMPLE_THRESHOLD ? ' — few samples' : ''),
    );
  }
  const overallRate = ratePercent(report.overall.hit, report.overall.judged);
  lines.push('');
  if (overallRate !== null) {
    lines.push(`All declarations: ${overallRate}% (${report.overall.hit}/${report.overall.judged})`);
  }
  const measurableRate = ratePercent(report.measurable.judged, report.measurable.total);
  if (measurableRate !== null) {
    lines.push(
      `Judged ${report.measurable.judged} of ${report.measurable.total} values (${measurableRate}%).`,
    );
  }
  if (meta.originAvailable && report.originKnown > 0) {
    lines.push('');
    lines.push('## Where the value comes from');
    lines.push(`- Variable + token: ${report.matrix.varHit}`);
    lines.push(`- Variable, off token: ${report.matrix.varMiss}`);
    lines.push(`- Written value, matches token: ${report.matrix.literalHit}`);
    lines.push(`- Written value, off token: ${report.matrix.literalMiss}`);
    lines.push(`- Excluded (inherited / browser default / unreadable CSS): ${report.matrix.excluded}`);
  }
  if (report.top.length) {
    lines.push('');
    lines.push('## Fix these first');
    for (const t of report.top) {
      lines.push(
        `- \`${t.value}\` (${t.label}) x${t.count}` +
          (t.nearest ? ` — nearest token ${t.nearest}` : ' — no token nearby'),
      );
    }
  }
  return lines.join('\n');
}
