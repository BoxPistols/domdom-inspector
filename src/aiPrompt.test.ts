import { describe, expect, it } from 'vitest';
import { buildAuditPrompt, formatScanForPrompt } from './aiPrompt';
import { buildCoverage } from './coverage';
import type { DesignScan } from './designScan';

const SCAN: DesignScan = {
  elementCount: 120,
  candidateCount: 120,
  truncated: false,
  originAvailable: true,
  originBudgetExceeded: false,
  styleSource: 'stylesheet',
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
  tokenSources: null,
  grid: 4,
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

  it('打ち切りを AI 入力にも申告する (部分計測を全体として講評させない)', () => {
    const text = formatScanForPrompt({ ...SCAN, truncated: true, elementCount: 2000 });
    expect(text).toContain('scan limit reached');
    expect(text).toContain('only part of the page');
    // 打ち切っていないスキャンでは書かない
    expect(formatScanForPrompt(SCAN)).not.toContain('scan limit reached');
  });

  it('自動テーマ由来のトークン内訳を申告する (一致率が構造的に上がる事実を伏せない)', () => {
    const text = formatScanForPrompt({
      ...SCAN,
      tokenSources: { pasted: { colors: 5, sizes: 8 }, theme: { colors: 120, sizes: 386 } },
    });
    expect(text).toContain('auto-detected from the app theme 120/386');
    expect(text).toContain('without de-duplication');
    // 貼り付けのみのときは内訳を出さない (ノイズを増やさない)
    expect(
      formatScanForPrompt({
        ...SCAN,
        tokenSources: { pasted: { colors: 5, sizes: 8 }, theme: { colors: 0, sizes: 0 } },
      }),
    ).not.toContain('Token sources');
  });

  it('ページ内容 (テキスト・URL・クラス名) を含めない', () => {
    const text = formatScanForPrompt(SCAN);
    expect(text).not.toMatch(/https?:\/\//);
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
