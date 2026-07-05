import type { DesignProp } from './types';

// production ビルドでは Fiber の dev フィールドが剥がれるが、computed style は常に取れる。
// デザイナー向けに「見た目」を構成する主要プロパティを curate して抽出する (FR-23 の一部)。
const PROPS: { prop: string; label: string; skip?: (v: string) => boolean }[] = [
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
 * getter (prop → 値) から主要デザインプロパティを抽出する純関数。
 * 既定値・ゼロ余白・none は除外してノイズを減らす。テスト容易性のため getter を受ける。
 */
export function pickDesignStyle(get: (prop: string) => string): DesignProp[] {
  const out: DesignProp[] = [];
  for (const { prop, label, skip } of PROPS) {
    const value = (get(prop) || '').trim();
    if (!value) continue;
    if (skip && skip(value)) continue;
    out.push({ label, value: shorten(value) });
  }
  return out;
}

/** 実 DOM 要素の computed style から主要デザインプロパティを抽出 */
export function extractDesignStyle(element: Element): DesignProp[] {
  const cs = getComputedStyle(element);
  return pickDesignStyle((prop) => cs.getPropertyValue(prop));
}
