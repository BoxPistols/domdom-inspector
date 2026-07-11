import type { RenderSnapshot, RenderStat } from './renderTracker';
import { formatVital, type VitalsSnapshot } from './vitals';

/**
 * AI 対話・チーム共有用のパフォーマンス分析レポート (Markdown) を生成する。
 *
 * 意図: 記録した生データを「AI にそのまま貼って分析を始められる」構造化テキストに
 * まとめる。レポート本文は機械可読性と AI プロンプト互換性を優先して英語固定とする
 * (JSON キーと同様のデータ交換フォーマットという扱い。UI 上のボタン/トーストは i18n)。
 * ページ内容は含めない: URL / タイトル / コンポーネント名 / 計測数値のみ (SECURITY.md)。
 */

export interface ReportInput {
  page: { url: string; title: string };
  devMode: boolean;
  snapshot: RenderSnapshot;
  vitals: VitalsSnapshot;
  /** 生成時刻 (ISO 文字列)。呼び出し側で new Date().toISOString() を渡す */
  generatedAt: string;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

function causeSummary(s: RenderStat): string {
  const parts: string[] = [];
  if (s.causes.state) parts.push(`state×${s.causes.state}`);
  if (s.causes.props) parts.push(`props×${s.causes.props}`);
  if (s.causes.parent) parts.push(`parent×${s.causes.parent}`);
  if (s.causes.mount) parts.push(`mount×${s.causes.mount}`);
  if (s.causes.other) parts.push(`other×${s.causes.other}`);
  return parts.join(' ') || '—';
}

function hints(s: RenderStat): string {
  const bits: string[] = [];
  if (s.lastChangedProps.length) bits.push(`props: ${s.lastChangedProps.join(', ')}`);
  if (s.lastChangedHooks.length) bits.push(`hooks: #${s.lastChangedHooks.join(', #')}`);
  return bits.join(' / ') || '—';
}

/** タイムラインを 10 バケットに要約 (コミット数と自己時間の分布) */
export function summarizeTimeline(
  timeline: RenderSnapshot['timeline'],
  wallMs: number,
  buckets = 10,
): { commits: number; selfMs: number }[] {
  const out = Array.from({ length: buckets }, () => ({ commits: 0, selfMs: 0 }));
  if (!timeline.length || wallMs <= 0) return out;
  for (const e of timeline) {
    const i = Math.min(Math.floor((e.t / wallMs) * buckets), buckets - 1);
    out[i].commits += 1;
    out[i].selfMs += e.selfMs;
  }
  return out;
}

export function buildReport(input: ReportInput): string {
  const { page, devMode, snapshot, vitals, generatedAt } = input;
  const lines: string[] = [];

  lines.push('# React Render Performance Report');
  lines.push('');
  lines.push(`- Page: ${page.title || '(untitled)'} — ${page.url}`);
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(
    `- React build: ${devMode ? 'development (profiler timings available)' : 'production (timings unavailable, counts are exact)'}`,
  );
  lines.push(
    `- Recording: ${fmtMs(snapshot.wallMs)} wall time, ${snapshot.commits} commits (screen updates)`,
  );
  lines.push('');

  // ページ全体の応答性 (Closed 環境の Lighthouse 代替)
  lines.push('## Page vitals');
  lines.push('');
  if (vitals.metrics.length === 0) {
    lines.push('_No vitals observed (browser support or timing)._');
    lines.push(`Long tasks: ${vitals.longTasks} (blocking ≈ ${fmtMs(vitals.blockingMs)})`);
  } else {
    lines.push('| Metric | Value | Rating |');
    lines.push('| --- | --- | --- |');
    for (const m of vitals.metrics) {
      lines.push(`| ${m.id} | ${formatVital(m.id, m.value)} | ${m.rating} |`);
    }
    lines.push(
      `| Long tasks | ${vitals.longTasks} | blocking ≈ ${fmtMs(vitals.blockingMs)} |`,
    );
  }
  lines.push('');

  // 再レンダー統計 (why-did-render 内訳つき)
  lines.push('## Component re-renders');
  lines.push('');
  lines.push(
    `Total: ${snapshot.stats.reduce((a, s) => a + s.count, 0)} renders, ` +
      `self time ${fmtMs(snapshot.totalSelfMs)}, ` +
      `wasted renders ${snapshot.totalWasted} (re-rendered with shallow-equal props and no state change).`,
  );
  lines.push('');
  lines.push('| Component | Renders | Self time | Max | Causes | Last changed |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of snapshot.stats.slice(0, 40)) {
    lines.push(
      `| ${s.name} | ${s.count} | ${snapshot.timingSupported ? fmtMs(s.selfMs) : '—'} | ` +
        `${snapshot.timingSupported ? fmtMs(s.maxSelfMs) : '—'} | ${causeSummary(s)} | ${hints(s)} |`,
    );
  }
  lines.push('');
  lines.push(
    '_Causes: state = own useState/useReducer changed; props = received prop values changed; ' +
      'parent = dragged along by a parent re-render with identical props (wasted — React.memo candidate); ' +
      'mount = first render; other = context/forceUpdate._',
  );
  lines.push('');

  // memo 候補 (無駄レンダーが多い順)
  const candidates = snapshot.stats
    .filter((s) => s.causes.parent >= 3)
    .sort((a, b) => b.causes.parent - a.causes.parent)
    .slice(0, 10);
  if (candidates.length) {
    lines.push('## Memoization candidates');
    lines.push('');
    for (const s of candidates) {
      lines.push(
        `- **${s.name}** — ${s.causes.parent}/${s.count} renders were wasted` +
          (snapshot.timingSupported ? ` (~${fmtMs(s.selfMs)} total self time)` : ''),
      );
    }
    lines.push('');
  }

  // タイムライン (コミットの偏り)
  if (snapshot.timeline.length) {
    lines.push('## Commit timeline (10 buckets over the recording)');
    lines.push('');
    const bucketed = summarizeTimeline(snapshot.timeline, snapshot.wallMs);
    lines.push(`Commits: ${bucketed.map((b) => b.commits).join(' | ')}`);
    if (snapshot.timingSupported) {
      lines.push(`Self ms: ${bucketed.map((b) => b.selfMs.toFixed(1)).join(' | ')}`);
    }
    lines.push('');
  }

  // AI へ渡すときの分析観点 (レポートを貼るだけで対話を始められるように)
  lines.push('## Suggested analysis (paste this report to an AI assistant)');
  lines.push('');
  lines.push('1. Which components dominate self time, and is the cost per render or render count?');
  lines.push('2. Which wasted renders (cause=parent) are worth React.memo/useMemo/useCallback?');
  lines.push('3. Do state changes (cause=state) update at the right level, or should state move down?');
  lines.push('4. Do long tasks / INP correlate with the commit timeline spikes?');
  lines.push('5. Propose the top 3 concrete code changes with expected impact.');

  return lines.join('\n');
}
