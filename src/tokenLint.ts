import type { DesignProp } from './types';

// グリッド検査対象の spacing 系プロパティ (designStyle の label)
const SPACING = new Set(['padding', 'margin', 'radius', 'gap']);

export interface TokenFinding {
  label: string;
  value: string;
  /** グリッド外の px 値 (このリストが非空 = 野良値) */
  offGrid: number[];
}

/**
 * spacing 値が px グリッド (既定 4px) に乗るかを検査する純関数 (FR-15 の非テーマ版)。
 * MUI テーマの取得に依存せず、production でも「野良値」(グリッド外の余白/角丸) を検出できる。
 * デザイナーが localhost でなくデプロイ済み App を見る前提での主価値。
 */
export function lintSpacing(design: DesignProp[], grid = 4): TokenFinding[] {
  const findings: TokenFinding[] = [];
  for (const p of design) {
    if (!SPACING.has(p.label)) continue;
    const pxs = [...p.value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]));
    if (!pxs.length) continue;
    const offGrid = pxs.filter((px) => px !== 0 && px % grid !== 0);
    if (offGrid.length) findings.push({ label: p.label, value: p.value, offGrid });
  }
  return findings;
}
