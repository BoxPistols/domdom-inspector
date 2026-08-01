import type { DesignScan, ScanValueStat } from './designScan';

/**
 * AI デザイン監査プロンプトの組み立て (FR-25/FR-26)。
 * 検出・分類・照合は決定論コア (designScan) が済ませており、AI の役割は講評・言語化のみ。
 * user プロンプト = popup の送信前プレビューにそのまま表示される全文 (これ以外は送らない)。
 * 含まれるのはスタイル値・件数・トークン名だけで、URL・テキスト・クラス名は含まれない。
 */

const LABEL_TITLES: Record<string, string> = {
  color: 'Text colors',
  bg: 'Background colors',
  font: 'Font sizes',
  padding: 'Padding',
  margin: 'Margin',
  gap: 'Gap',
  radius: 'Border radius',
};

function statLine(s: ScanValueStat): string {
  const marks: string[] = [];
  if (s.token) marks.push(`= token ${s.token}`);
  if (s.nearest) marks.push(`rogue, near token ${s.nearest}`);
  if (s.offGrid) marks.push('off 4px grid');
  return `- \`${s.value}\` ×${s.count}${marks.length ? ` (${marks.join('; ')})` : ''}`;
}

/** DesignScan を Markdown 要約に整形する (プレビュー = 送信内容そのもの) */
export function formatScanForPrompt(scan: DesignScan): string {
  const lines: string[] = [
    `Elements scanned: ${scan.elementCount}`,
    `Design tokens available: ${scan.tokenCounts.colors} colors / ${scan.tokenCounts.sizes} sizes`,
    '',
  ];
  for (const [label, title] of Object.entries(LABEL_TITLES)) {
    const stats = scan.stats[label];
    if (!stats?.length) continue;
    lines.push(`## ${title}`);
    for (const s of stats) lines.push(statLine(s));
    lines.push('');
  }
  return lines.join('\n').trim();
}

export interface AuditPrompt {
  system: string;
  user: string;
}

/**
 * 監査プロンプトを組み立てる。locale で講評の言語を指定する。
 * 決定論データ (使用値・頻度・トークン照合・グリッド判定) は入力に含まれており、
 * AI には「どこから直すか」の優先順位付けと言語化だけを求める。
 */
export function buildAuditPrompt(scan: DesignScan, locale: 'en' | 'ja'): AuditPrompt {
  const lang = locale === 'ja' ? 'Japanese' : 'English';
  const system = [
    'You are a design-system auditor reviewing aggregated style measurements from a single web page.',
    'The data is deterministic: each line is a computed style value, its usage count, and whether it matches a design token or a 4px grid.',
    'Write a concise audit report in Markdown with these sections:',
    '1. Summary — overall consistency in 2-3 sentences.',
    '2. Rogue values — the most impactful off-token / off-grid values (highest counts first), and what token each should probably be.',
    '3. Consolidation opportunities — near-duplicate colors or sizes that could be merged.',
    '4. Suggested next steps — max 5, ordered by impact.',
    'Base every claim only on the provided data. Do not invent values.',
    `Respond in ${lang}.`,
  ].join('\n');
  return { system, user: formatScanForPrompt(scan) };
}
