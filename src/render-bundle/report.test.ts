import { describe, expect, it } from 'vitest';
import { buildReport, summarizeTimeline, type ReportInput } from './report';
import type { RenderSnapshot, RenderStat } from './renderTracker';

function stat(over: Partial<RenderStat> & Pick<RenderStat, 'name'>): RenderStat {
  return {
    count: 1,
    selfMs: 0,
    maxSelfMs: 0,
    causes: { mount: 0, state: 0, props: 0, parent: 0, other: 0 },
    lastChangedProps: [],
    lastChangedHooks: [],
    lastCommit: 1,
    ...over,
  };
}

function snapshot(over: Partial<RenderSnapshot> = {}): RenderSnapshot {
  return {
    stats: [],
    commits: 0,
    wallMs: 1000,
    totalSelfMs: 0,
    totalWasted: 0,
    timeline: [],
    timingSupported: true,
    ...over,
  };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    page: { url: 'https://example.com/app', title: 'My App' },
    devMode: true,
    snapshot: snapshot(),
    vitals: { metrics: [], longTasks: 0, blockingMs: 0 },
    generatedAt: '2026-07-11T00:00:00.000Z',
    ...over,
  };
}

describe('summarizeTimeline', () => {
  it('記録時間を 10 バケットに分割してコミット数と自己時間を集計する', () => {
    const buckets = summarizeTimeline(
      [
        { t: 0, rendered: 1, selfMs: 2 },
        { t: 50, rendered: 1, selfMs: 3 },
        { t: 990, rendered: 1, selfMs: 1 },
      ],
      1000,
    );
    expect(buckets).toHaveLength(10);
    expect(buckets[0]).toEqual({ commits: 2, selfMs: 5 });
    expect(buckets[9]).toEqual({ commits: 1, selfMs: 1 });
  });

  it('t が wallMs を超えても最終バケットに丸める (範囲外アクセスしない)', () => {
    const buckets = summarizeTimeline([{ t: 1500, rendered: 1, selfMs: 1 }], 1000);
    expect(buckets[9].commits).toBe(1);
  });
});

describe('buildReport', () => {
  it('ページ情報・vitals・コンポーネント表・分析観点を含む Markdown を生成する', () => {
    const md = buildReport(
      input({
        snapshot: snapshot({
          commits: 12,
          totalSelfMs: 34.5,
          stats: [
            stat({
              name: 'ProductList',
              count: 10,
              selfMs: 30,
              maxSelfMs: 8,
              causes: { mount: 1, state: 2, props: 3, parent: 4, other: 0 },
              lastChangedProps: ['items'],
              lastChangedHooks: [0],
            }),
          ],
          totalWasted: 4,
        }),
        vitals: {
          metrics: [{ id: 'LCP', value: 2340, rating: 'good' }],
          longTasks: 3,
          blockingMs: 120,
        },
      }),
    );

    expect(md).toContain('# React Render Performance Report');
    expect(md).toContain('https://example.com/app');
    expect(md).toContain('| LCP | 2.34s | good |');
    expect(md).toContain('ProductList');
    expect(md).toContain('state×2 props×3 parent×4 mount×1');
    expect(md).toContain('props: items');
    expect(md).toContain('hooks: #0');
    expect(md).toContain('## Suggested analysis');
  });

  it('無駄レンダー 3 回以上のコンポーネントを memo 候補として列挙する', () => {
    const md = buildReport(
      input({
        snapshot: snapshot({
          stats: [
            stat({ name: 'Heavy', count: 5, causes: { mount: 0, state: 0, props: 0, parent: 4, other: 0 } }),
            stat({ name: 'Light', count: 5, causes: { mount: 0, state: 0, props: 0, parent: 1, other: 0 } }),
          ],
          totalWasted: 5,
        }),
      }),
    );
    expect(md).toContain('## Memoization candidates');
    expect(md).toContain('**Heavy** — 4/5 renders were wasted');
    expect(md).not.toContain('**Light**');
  });

  it('production (timing 非対応) では時間列を — にする', () => {
    const md = buildReport(
      input({
        devMode: false,
        snapshot: snapshot({
          timingSupported: false,
          stats: [stat({ name: 'A', count: 2 })],
        }),
      }),
    );
    expect(md).toContain('production (timings unavailable, counts are exact)');
    expect(md).toContain('| A | 2 | — | — |');
  });
});
