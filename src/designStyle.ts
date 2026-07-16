import { collectAuthoredVars, type VarMatch } from './cssVars';
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

/** スウォッチ描画できる色値か (#hex / rgb() / rgba())。キーワード・数値・px・shadow 複合値は対象外 */
export function isColorValue(v: string): boolean {
  const t = v.trim();
  return /^#[0-9a-f]{3,8}$/i.test(t) || /^rgba?\([^)]*\)$/i.test(t);
}

/** rgb()/rgba(不透明) を #rrggbb に整形 (デザイナーに読みやすく)。半透明・非対応はそのまま */
export function toHex(v: string): string {
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) return v;
  const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (alpha < 1) return v; // 半透明は情報を落とさずそのまま
  const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
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
    out.push(dp);
  }
  return out;
}

/**
 * 実 DOM 要素の computed style から主要デザインプロパティを抽出。
 * 併せて「宣言された CSS 変数名」(Tier1 authored) を回収し添える。CSSOM 走査が
 * 失敗しても computed のみで縮退する (production/クロスオリジンで壊さない)。
 */
export function extractDesignStyle(element: Element): DesignProp[] {
  const cs = getComputedStyle(element);
  let vars: Map<string, VarMatch> | null = null;
  try {
    vars = collectAuthoredVars(element);
  } catch {
    vars = null;
  }
  return pickDesignStyle(
    (prop) => cs.getPropertyValue(prop),
    vars ? (label) => vars.get(label) ?? null : undefined,
  );
}
