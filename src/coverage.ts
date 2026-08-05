import {
  classifyDeclaration,
  COLOR_HIT,
  COLOR_NEAR,
  LABEL_FAMILY,
  SIZE_HIT,
  SIZE_NEAR,
  type Family,
  type TokenDict,
} from './tokenDict';
import { DEFAULT_GRID_PX, extractPxValues } from './tokenLint';
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
  /**
   * 判定はできたが来歴が不明な件数 (継承値 / UA 既定 / CSS が読めない)。
   * **notJudged と混ぜない**: 「該当トークンが無い」を来歴の問題として提示すると、
   * 表示文 (継承・ブラウザ既定・stylesheet が読めない) が嘘になる。
   */
  originUnknown: number;
  /** 該当トークンが無い / 値を解析できない件数。来歴の問題ではないので象限外 */
  notJudged: number;
}

/**
 * 来歴の内訳。**単一の origin に断定しない**: 同じ `13px` が var 経由 30 件と直書き 40 件で
 * 混在するのが実際のページで、片方を代表値にすると嘘になる (§6-1)。
 * 合計は TopOffender.count と一致する。
 */
export interface OriginSplit {
  var: number;
  literal: number;
  /** 継承 / UA 既定 / CSS が読めない = 来歴不明 */
  other: number;
}

export interface TopOffender {
  label: string;
  value: string;
  count: number;
  nearest: string | null;
  /**
   * 来歴の内訳。**来歴を信頼できないスキャンでは null** (CSS-in-JS / 予算切れ)。
   * 表示側の条件分岐ではなくデータで塞ぐ = 出力先が増えても書き忘れが起きない。
   * count は「値が使われている要素数」であり修正箇所数ではない (1 つの CSS 宣言が
   * 42 要素に効いていれば直すのは 1 箇所) — 修正コストとして提示してはいけない。
   */
  origins: OriginSplit | null;
}

export interface CoverageReport {
  families: FamilyCoverage[];
  /** 全ファミリ合算 (micro-average)。必ず実数と併記して表示する */
  overall: { judged: number; hit: number };
  /** 収集した全件のうち判定できた割合の材料 */
  measurable: { judged: number; total: number };
  matrix: OriginMatrix;
  /**
   * 来歴を主張してよいか。**ゲートを表示側ではなく report に持たせる** (§6-1):
   * CSS-in-JS は theme 由来でも出力が常にリテラルになるため来歴から
   * 「ハードコード」を判定できず、来歴予算切れのスキャンも同様に主張できない。
   * false のとき matrix は 0 埋めされ TopOffender.origins は null になる。
   */
  originTrusted: boolean;
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
 *
 * originTrusted は既定 false = **来歴を主張しない側に倒す**。渡し忘れたときに
 * 「主張してしまう」より「言えない」に転ぶ方が安全 (この製品の失敗類型は
 * 欠測ではなく誤答)。呼び出し側は originAvailable と styleSource から明示的に渡す。
 */
export function buildCoverage(
  occurrences: Occurrence[],
  dict: TokenDict,
  opts: { grid?: number; originTrusted?: boolean } = {},
): CoverageReport {
  const grid = opts.grid ?? DEFAULT_GRID_PX;
  const originTrusted = opts.originTrusted ?? false;
  const families = new Map<Family, FamilyCoverage>(
    FAMILY_ORDER.map((f) => [f, emptyFamily(f)]),
  );
  const distinct = new Map<Family, Map<string, boolean>>(
    FAMILY_ORDER.map((f) => [f, new Map()]),
  );
  const matrix: OriginMatrix = {
    varHit: 0,
    varMiss: 0,
    literalHit: 0,
    literalMiss: 0,
    originUnknown: 0,
    notJudged: 0,
  };
  let originKnown = 0;
  let originVar = 0;
  let offGridOff = 0;
  let offGridTotal = 0;
  // 同じ label+value は来歴を跨いで 1 行にまとめる。designScan の Occurrence キーは
  // origin を含むため、まとめずに積むと同一の野良値が 2 行に分裂し「件数降順」が嘘になる
  const offenders = new Map<string, TopOffender>();

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
    // 判定できなかった分は「来歴が不明」ではなく別枠 (notJudged)。来歴を信頼できない
    // スキャンでは象限を一切埋めない = 表示側が条件を書き忘れても主張が漏れない
    if (!judged) {
      matrix.notJudged += occ.count;
    } else if (!originTrusted) {
      // 来歴の主張はしないが「判定はできた」件数なので notJudged には入れない
      matrix.originUnknown += occ.count;
    } else if (occ.origin === 'var' || occ.origin === 'literal') {
      originKnown += occ.count;
      if (occ.origin === 'var') originVar += occ.count;
      const hit = verdict.outcome === 'hit';
      if (occ.origin === 'var') {
        if (hit) matrix.varHit += occ.count;
        else matrix.varMiss += occ.count;
      } else if (hit) matrix.literalHit += occ.count;
      else matrix.literalMiss += occ.count;
    } else {
      matrix.originUnknown += occ.count;
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
      // label は空白を含まない固定語彙なので designScan 側の集約と同じ形で一意
      const key = `${occ.label} ${occ.value}`;
      const prev = offenders.get(key);
      const entry =
        prev ??
        ({
          label: occ.label,
          value: occ.value,
          count: 0,
          nearest: verdict.nearest,
          origins: originTrusted ? { var: 0, literal: 0, other: 0 } : null,
        } satisfies TopOffender);
      entry.count += occ.count;
      if (entry.origins) {
        if (occ.origin === 'var') entry.origins.var += occ.count;
        else if (occ.origin === 'literal') entry.origins.literal += occ.count;
        else entry.origins.other += occ.count;
      }
      if (!prev) offenders.set(key, entry);
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

  // 件数降順。同数のときは label/value 昇順で決定論にする (Markdown と AI 入力が
  // 「決定論データ」を名乗る以上、同数の並びが走査順に依存してはいけない)
  const ranked = [...offenders.values()].sort(
    (a, b) =>
      b.count - a.count || a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
  );

  return {
    families: list,
    overall,
    measurable: { judged: overall.judged, total },
    matrix,
    originTrusted,
    originKnown,
    originVar,
    offGrid: { off: offGridOff, total: offGridTotal },
    top: ranked.slice(0, MAX_TOP),
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

/**
 * トークン辞書の出所内訳 (手動貼り付け / アプリのテーマ由来)。
 * mergeTokenDicts は重複排除をしない単純連結なので、合計は「上限」であって実数ではない。
 * これを出す理由: 自動テーマは密なラダーを作るため一致率が構造的に上がる (§6-5)。
 * 内訳を伏せると **率の意味が変わっていることに誰も気づけない**。
 */
export interface TokenSourceCounts {
  pasted: { colors: number; sizes: number };
  theme: { colors: number; sizes: number };
}

export interface CoverageMeta {
  elementCount: number;
  truncated: boolean;
  /** グリッド判定の刻み幅。表示側にリテラルを書かせない */
  grid: number;
  /** 照合に使った辞書の規模 (0/0 なら率は出せない) */
  tokenCounts: { colors: number; sizes: number };
  tokenSources?: TokenSourceCounts | null;
}

/**
 * 集計結果を決定論 Markdown にする (共有・AI 入力用。UI は i18n、データは英語固定)。
 *
 * **来歴を出すかの判断は meta ではなく report.originTrusted で行う** — 呼び出し側に
 * 条件を渡させると渡し忘れが起きる。実際にこの関数は styleSource を受け取っておらず、
 * popup が「CSS-in-JS なので来歴は主張しない」と決めたページでもコピー出力には
 * 来歴セクションが載っていた (持ち出される側の方が不誠実になっていた)。
 */
export function formatCoverageMarkdown(report: CoverageReport, meta: CoverageMeta): string {
  const lines: string[] = ['# Design token coverage', ''];
  // 打ち切り時に「N of M elements」と書かない: N は可視要素、M は DOM 全ノード (head/
  // display:none/SVG 子まで含む) で母集団が違う。並べると毎回の計測が部分計測に見える
  lines.push(
    meta.truncated
      ? `Measured ${meta.elementCount} elements, then stopped at the scan limit — counts are exact for that part, not for the whole page.`
      : `Measured ${meta.elementCount} elements.`,
  );
  lines.push(tokenInventoryLine(meta));
  if (meta.tokenCounts.colors === 0 && meta.tokenCounts.sizes === 0) {
    lines.push('');
    lines.push('No tokens were provided, so no value could be matched. Only the grid check applies.');
  }
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
  if (report.originTrusted && report.originKnown > 0) {
    lines.push('');
    lines.push('## Where the value comes from');
    lines.push(`- Variable + token: ${report.matrix.varHit}`);
    lines.push(`- Variable, off token: ${report.matrix.varMiss}`);
    lines.push(`- Written value, matches token: ${report.matrix.literalHit}`);
    lines.push(`- Written value, off token: ${report.matrix.literalMiss}`);
    lines.push(
      `- Origin unknown (inherited / browser default / unreadable CSS): ${report.matrix.originUnknown}`,
    );
    lines.push(
      `- Not judged (no token of that kind / value could not be parsed): ${report.matrix.notJudged}`,
    );
  }
  const offRate = ratePercent(report.offGrid.off, report.offGrid.total);
  if (offRate !== null) {
    lines.push('');
    lines.push(`## Off the ${meta.grid}px grid`);
    lines.push(
      `${offRate}% of spacing values (${report.offGrid.off}/${report.offGrid.total}) are off the ${meta.grid}px grid. Values that match a token are not counted as off-grid.`,
    );
  }
  if (report.top.length) {
    lines.push('');
    lines.push('## Fix these first');
    for (const t of report.top) {
      // 「x96」ではなく「used on 96 elements」と書く: count は要素数であって修正箇所数
      // ではない (1 つの CSS 宣言が 96 要素に効いていれば直すのは 1 箇所)
      lines.push(
        `- \`${t.value}\` (${t.label}) used on ${t.count} element${t.count === 1 ? '' : 's'}` +
          (t.nearest ? ` — nearest token ${t.nearest}` : ' — no token nearby') +
          (t.origins ? ` (${formatOrigins(t.origins)})` : ''),
      );
    }
  }
  lines.push('');
  lines.push('## How values were judged');
  lines.push(`- Color matches within an RGB distance of ${COLOR_HIT}; "close" up to ${COLOR_NEAR}.`);
  lines.push(`- Size matches within ${SIZE_HIT}px; "close" up to ${SIZE_NEAR}px.`);
  lines.push(`- Grid check: spacing and radius values must be multiples of ${meta.grid}px.`);
  lines.push(
    '- Percentages are rounded, and never shown as 100% or 0% unless they are exact.',
  );
  lines.push('- Not measured: iframes, shadow DOM, and elements that are not visible.');
  return lines.join('\n');
}

/** 辞書の規模と出所を 1 行で。内訳は「重複排除前」であることまで書く */
function tokenInventoryLine(meta: CoverageMeta): string {
  const base = `Tokens used for matching: ${meta.tokenCounts.colors} colors / ${meta.tokenCounts.sizes} sizes`;
  const src = meta.tokenSources;
  if (!src) return `${base}.`;
  const themeTotal = src.theme.colors + src.theme.sizes;
  if (themeTotal === 0) return `${base} (all pasted by you).`;
  return (
    `${base} — pasted ${src.pasted.colors}/${src.pasted.sizes}, ` +
    `from the app theme ${src.theme.colors}/${src.theme.sizes} ` +
    '(auto-detected, merged without de-duplication; a dense generated scale makes values match more easily).'
  );
}

/** 来歴の分布。「N places to change」とは書かない (count は要素数) */
function formatOrigins(o: OriginSplit): string {
  const parts: string[] = [];
  if (o.var > 0) parts.push(`${o.var} via variables`);
  if (o.literal > 0) parts.push(`${o.literal} written in place`);
  if (o.other > 0) parts.push(`${o.other} origin unknown`);
  return parts.join(' · ');
}
