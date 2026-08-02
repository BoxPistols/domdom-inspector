import { describe, expect, it } from 'vitest';
import { buildAuditPrompt, formatScanForPrompt } from './aiPrompt';
import { buildCoverage } from './coverage';
import type { DesignScan } from './designScan';

const SCAN: DesignScan = {
  elementCount: 120,
  candidateCount: 120,
  truncated: false,
  originAvailable: true,
  statsTotals: {
    color: { uniqueValues: 2, shown: 2, occurrences: 43 },
    padding: { uniqueValues: 1, shown: 1, occurrences: 7 },
  },
  coverage: buildCoverage(
    [
      { label: 'color', value: '#1668d4', count: 40, origin: 'var' },
      { label: 'color', value: '#1a6cd8', count: 3, origin: 'literal' },
      { label: 'padding', value: '10px', count: 7, origin: 'literal' },
    ],
    { colors: [{ name: 'primary', r: 0x16, g: 0x68, b: 0xd4, a: 1 }], sizes: [] },
  ),
  tokenCounts: { colors: 5, sizes: 8 },
  stats: {
    color: [
      { value: '#1668d4', count: 40, token: 'primary', nearest: null, offGrid: false },
      { value: '#1a6cd8', count: 3, token: null, nearest: 'primary', offGrid: false },
    ],
    padding: [{ value: '10px', count: 7, token: null, nearest: null, offGrid: true }],
  },
};

describe('formatScanForPrompt', () => {
  it('値・件数・トークン照合・グリッド判定だけを Markdown 化する', () => {
    const text = formatScanForPrompt(SCAN);
    expect(text).toContain('Elements scanned: 120');
    expect(text).toContain('`#1668d4` ×40 (= token primary)');
    expect(text).toContain('`#1a6cd8` ×3 (rogue, near token primary)');
    expect(text).toContain('`10px` ×7 (off 4px grid)');
    // 空ラベル (margin 等) の見出しは出さない
    expect(text).not.toContain('## Margin');
  });
});

describe('buildAuditPrompt', () => {
  it('user プロンプト = プレビュー表示と同一 (formatScanForPrompt の出力そのもの)', () => {
    const p = buildAuditPrompt(SCAN, 'en');
    expect(p.user).toBe(formatScanForPrompt(SCAN));
  });

  it('locale で講評言語を指定する', () => {
    expect(buildAuditPrompt(SCAN, 'ja').system).toContain('Respond in Japanese.');
    expect(buildAuditPrompt(SCAN, 'en').system).toContain('Respond in English.');
  });

  it('AI の役割は講評のみ — データ以外を発明しない指示を含む', () => {
    expect(buildAuditPrompt(SCAN, 'en').system).toContain('only on the provided data');
  });
});
