import {
  familyRate,
  LOW_SAMPLE_THRESHOLD,
  ratePercent,
  type CoverageReport,
  type FamilyCoverage,
} from './coverage';
import type { DesignScan } from './designScan';

/**
 * カバレッジ画面のビューモデル (issue #10 / `docs/design-coverage-screen.md` §4-2, §5-2)。
 *
 * **UI は描くだけの薄い層にする**ための純関数群。`familyRate` / `isDictEmpty` は
 * ここで再実装せず `src/coverage.ts` から呼ぶ (popup が同名ロジックを持っていて、
 * 現にドリフト源になっていた)。
 */

/**
 * 率の表示。**数字だけを取り出せない形で返す** — 率を単独で描ける API があると、
 * 呼び出し側がいつか分母と条件を落とす。`text` は必ず `hit`/`judged` と同梱で渡る。
 */
export interface RateDisplay {
  /** 表示文字列。判定できた件数が 0 なら null (率を出さない) */
  text: string | null;
  hit: number;
  judged: number;
  /**
   * 丸めのクランプが効いているか。`ratePercent` は「一部外れているのに 100%」
   * 「1 件当たっているのに 0%」を避けて 99/1 に丸めるが、**そのままだと
   * 「本当に 99%」と「10000 件中 1 件外れ」が区別できない**。表示で開示する。
   */
  clamped: 'high' | 'low' | null;
  /** 判定件数が少なすぎて率が意味を持たない (LOW_SAMPLE_THRESHOLD 未満) */
  lowSample: boolean;
}

/**
 * 率を表示用に整形する。クランプ時は `>99%` / `<1%` と表記し、実数を同梱する。
 * **すべての率は四捨五入である**ことは閾値の開示セクションで別途明記する
 * (クランプ境界だけ丁寧にすると「それ以外の % は正確」という逆の含意が出る)。
 */
export function formatRate(hit: number, judged: number): RateDisplay {
  const percent = ratePercent(hit, judged);
  if (percent === null) {
    return { text: null, hit, judged, clamped: null, lowSample: judged < LOW_SAMPLE_THRESHOLD };
  }
  const raw = (hit / judged) * 100;
  const clamped: RateDisplay['clamped'] =
    percent === 99 && Math.round(raw) === 100 ? 'high' : percent === 1 && Math.round(raw) === 0 ? 'low' : null;
  const text = clamped === 'high' ? '>99%' : clamped === 'low' ? '<1%' : `${percent}%`;
  return { text, hit, judged, clamped, lowSample: judged < LOW_SAMPLE_THRESHOLD };
}

/** 要素加重の一致率 (既存の familyRate を通す) */
export function elementRate(f: FamilyCoverage): RateDisplay {
  // familyRate と同じ材料で整形する。familyRate 自体は率の有無の判断に使う
  const has = familyRate(f) !== null;
  const display = formatRate(f.hit, f.judged);
  return has ? display : { ...display, text: null };
}

/**
 * 語彙加重の一致率 (値の種類ベース)。要素加重は巨大コンポーネントに引っ張られるので、
 * 2 つの分母を並べる。**低サンプル保護はこちらにこそ要る** — 種類数は本質的に
 * 小さい数になりやすい (色 41 種・spacing 36 種) のに、新しく主役級に置く列だから。
 */
export function vocabularyRate(f: FamilyCoverage): RateDisplay {
  return formatRate(f.distinctHit, f.distinctJudged);
}

/** 但し書きが制限する対象。**数字の真横に印を出す**ために持たせる */
export type BasisAffects = 'match' | 'durability' | 'grid';

/**
 * 計測の但し書き 1 件。**文言ではなく ID を返す** — パネル UI・Markdown・AI 入力の
 * 3 者が同じ配列を共有し、「コピー出力の方が不誠実」という状態を構造的に消す。
 */
export interface BasisNote {
  id: BasisNoteId;
  affects: BasisAffects[];
}

export type BasisNoteId =
  | 'truncated'
  | 'noDict'
  | 'themeInflates'
  | 'cssInJs'
  | 'originBudget'
  | 'originUnavailable';

/**
 * この計測が何をカバーしていないかを、数字より先に読ませるための配列を作る。
 *
 * 原則: **但し書きは、それが制限する数字と一緒に旅する。脚注だけにしない。**
 * 壁のような但し書きを上に積むと読み飛ばされるので、`affects` で影響先を持たせる。
 */
export function buildBasisNotes(scan: DesignScan): BasisNote[] {
  const notes: BasisNote[] = [];

  // 打ち切り = この数字はページの一部についてのもの。全部の指標に効く
  if (scan.truncated) {
    notes.push({ id: 'truncated', affects: ['match', 'durability', 'grid'] });
  }

  const { colors, sizes } = scan.tokenCounts;
  if (colors === 0 && sizes === 0) {
    // 辞書が空 = 一致率そのものが出せない。グリッド検査は辞書不要なので生きている
    notes.push({ id: 'noDict', affects: ['match'] });
  } else if ((scan.tokenSources?.theme.sizes ?? 0) > 0) {
    // §6-5: 自動テーマは 4px 刻みの密なラダーを作るので、spacing の一致率と
    // 4px グリッド検査は**独立した証拠にならない**。指標を消さず従属関係を開示する
    notes.push({ id: 'themeInflates', affects: ['match', 'grid'] });
  }

  // 来歴 (var 経由か直書きか) を主張できない理由は 3 つあり、**取り違えると説明が嘘になる**
  if (scan.styleSource === 'css-in-js') {
    notes.push({ id: 'cssInJs', affects: ['durability'] });
  } else if (scan.originBudgetExceeded) {
    notes.push({ id: 'originBudget', affects: ['durability'] });
  } else if (!scan.originAvailable) {
    notes.push({ id: 'originUnavailable', affects: ['durability'] });
  }

  return notes;
}

/** 指定の数字に効く但し書きだけを取り出す (数字の真横に出す印) */
export function notesAffecting(notes: readonly BasisNote[], target: BasisAffects): BasisNote[] {
  return notes.filter((n) => n.affects.includes(target));
}

/**
 * 空状態の識別子。**空を無言にしない** — 「野良値ゼロ」という良い知らせと
 * 「何も計測できていない」が同じ見た目になるのが一番わかりにくい。
 */
export type EmptyStateId =
  | 'nothingJudged'
  | 'noOffenders'
  | 'noSpacingMeasured'
  | 'allOnGridOrMatched';

/**
 * 「直すと効く値」が空のときに何と言うか。
 * 判定が 1 件も無いのか、判定した上で該当が無いのかを区別する。
 */
export function offenderEmptyState(report: CoverageReport): EmptyStateId | null {
  if (report.top.length > 0) return null;
  return report.overall.judged === 0 ? 'nothingJudged' : 'noOffenders';
}

/**
 * グリッド検査が空のときに何と言うか。
 *
 * **文言は実装に合わせる。** off 判定は「トークンに一致せず、かつグリッド外」なので、
 * 「全 N 件がグリッド上にあります」と断言すると偽になりうる (トークン一致した値は
 * グリッド判定を免除されている)。「トークンにもグリッドにも外れた値は無い」と言う。
 */
export function gridEmptyState(report: CoverageReport): EmptyStateId | null {
  if (report.offGrid.total === 0) return 'noSpacingMeasured';
  if (report.offGrid.off === 0) return 'allOnGridOrMatched';
  return null;
}
