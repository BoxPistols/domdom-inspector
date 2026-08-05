import type { DesignProp } from './types';

// グリッド検査対象の spacing 系プロパティ (designStyle の label)
const SPACING = new Set(['padding', 'margin', 'radius', 'gap']);

/**
 * グリッド検査の既定刻み幅。**UI/レポート側にリテラルの 4 を書かない**ため export する
 * (判定条件を画面で開示する義務があり、定数と表示が別々に書かれると必ずドリフトする)。
 */
export const DEFAULT_GRID_PX = 4;

/** 値文字列中の px 数値を列挙する (lintSpacing / tokenDict.annotateProp 共通の単一定義) */
export function extractPxValues(value: string): number[] {
  return [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]));
}

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
export function lintSpacing(design: DesignProp[], grid = DEFAULT_GRID_PX): TokenFinding[] {
  const findings: TokenFinding[] = [];
  for (const p of design) {
    if (!SPACING.has(p.label)) continue;
    const pxs = extractPxValues(p.value);
    if (!pxs.length) continue;
    const offGrid = pxs.filter((px) => px !== 0 && px % grid !== 0);
    if (offGrid.length) findings.push({ label: p.label, value: p.value, offGrid });
  }
  return findings;
}
