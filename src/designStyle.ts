import { collectAuthoredInfo, type VarMatch } from './cssVars';
import { parseColor } from './tokenDict';
import type { DesignProp } from './types';

// production ビルドでは Fiber の dev フィールドが剥がれるが、computed style は常に取れる。
// デザイナー向けに「見た目」を構成する主要プロパティを curate して抽出する (FR-23 の一部)。
// cssVars.ts が label↔prop 対応を参照するため export する。
export const PROPS: { prop: string; label: string; skip?: (v: string) => boolean }[] = [
  { prop: 'color', label: 'color' },
  {
    prop: 'background-color',
    label: 'bg',
    skip: (v) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent',
  },
  { prop: 'font-size', label: 'font' },
  { prop: 'font-weight', label: 'weight', skip: (v) => v === '400' || v === 'normal' },
  { prop: 'line-height', label: 'lh', skip: (v) => v === 'normal' },
  { prop: 'padding', label: 'padding', skip: isZero },
  { prop: 'margin', label: 'margin', skip: isZero },
  { prop: 'border-radius', label: 'radius', skip: isZero },
  { prop: 'box-shadow', label: 'shadow', skip: (v) => v === 'none' },
  { prop: 'gap', label: 'gap', skip: (v) => v === 'normal' || isZero(v) },
];

function isZero(v: string): boolean {
  // "0px" / "0px 0px" / "0px 0px 0px 0px" をゼロ余白として除外
  return /^(0px\s*)+$/.test(v.trim());
}

function shorten(v: string): string {
  // 長すぎる値のみ省略 (rgb()/box-shadow の内部カンマを壊さないため分割はしない)
  return v.length > 48 ? `${v.slice(0, 48)}…` : v;
}

/**
 * スウォッチ描画できる色値か。色パースの真実は tokenDict.parseColor に一本化しつつ、
 * rgb() 系は中身の数値まで見ずに許容する (スウォッチは style.background に生値を渡すだけ
 * なので、パーセント表記等の合成値でもブラウザ側で描画できるため)。
 * ただし括弧を含む入れ子 (`rgb(var(--x))`) と box-shadow の複合値は全文アンカーで弾く。
 */
export function isColorValue(v: string): boolean {
  const t = v.trim();
  // 全文アンカー必須: shadow 複合値 (`rgba(...) 0px 2px …`) をスウォッチにしない
  return parseColor(t) !== null || /^rgba?\([^)]*\)$/i.test(t);
}

/** rgb()/rgba(不透明) を #rrggbb に整形 (デザイナーに読みやすく)。半透明・非対応はそのまま */
export function toHex(v: string): string {
  if (!/^rgba?\([^)]*\)$/i.test(v.trim())) return v;
  const c = parseColor(v);
  if (!c || c.a < 1) return v; // 半透明は情報を落とさずそのまま
  const hex = [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
}

/**
 * getter (prop → 値) から主要デザインプロパティを抽出する純関数。
 * 既定値・ゼロ余白・none は除外してノイズを減らす。テスト容易性のため getter を受ける。
 * getVar (label → 宣言 CSS 変数) を渡すと、宣言された変数名を DesignProp に添える (省略時は従来動作)。
 */
export function pickDesignStyle(
  get: (prop: string) => string,
  getVar?: (label: string) => VarMatch | null,
  getOrigin?: (label: string) => DesignProp['origin'],
): DesignProp[] {
  const out: DesignProp[] = [];
  for (const { prop, label, skip } of PROPS) {
    const value = (get(prop) || '').trim();
    if (!value) continue;
    if (skip && skip(value)) continue;
    // 色系は hex に整形してデザイナーに読みやすく
    const formatted = label === 'color' || label === 'bg' ? toHex(value) : value;
    const dp: DesignProp = { label, value: shorten(formatted) };
    const v = getVar?.(label);
    if (v) {
      dp.varName = v.name;
      if (v.ambiguous) {
        dp.ambiguous = true;
        dp.varNames = v.names;
      }
    }
    const o = getOrigin?.(label);
    if (o) dp.origin = o;
    out.push(dp);
  }
  return out;
}

/**
 * 実 DOM 要素の computed style から主要デザインプロパティを抽出。
 * 併せて「宣言された CSS 変数名」(Tier1 authored) を回収し添える。CSSOM 走査が
 * 失敗しても computed のみで縮退する (production/クロスオリジンで壊さない)。
 *
 * withVars / withOrigin を**別々に**受ける理由: 両者の供給元は同じ CSSOM 全走査
 * (cssVars.collectAuthoredInfo) で、これが計測の最大コスト。以前は withOrigin=false でも
 * 常に走査しており、来歴予算 (ORIGIN_BUDGET_MS) を超えた後もコストを払って結果だけ
 * 捨てていた = 「遅い上に来歴が消える」二重損。どちらも不要なら走査自体を行わない。
 */
export function extractDesignStyle(
  element: Element,
  opts: { withOrigin?: boolean; withVars?: boolean } = {},
): DesignProp[] {
  const cs = getComputedStyle(element);
  // 既定は従来動作 (バッジ表示は変数名を必要とし、来歴は使わない)
  const withVars = opts.withVars ?? true;
  const withOrigin = opts.withOrigin ?? false;
  let info: Map<string, { origin: DesignProp['origin']; varMatch: VarMatch | null }> | null = null;
  if (withVars || withOrigin) {
    try {
      info = collectAuthoredInfo(element);
    } catch {
      info = null;
    }
  }
  return pickDesignStyle(
    (prop) => cs.getPropertyValue(prop),
    withVars && info ? (label) => info.get(label)?.varMatch ?? null : undefined,
    // 来歴はページ全体スキャンでのみ使う。バッジ表示では不要なので既定では付けない
    withOrigin ? (label) => info?.get(label)?.origin ?? 'unknown' : undefined,
  );
}
