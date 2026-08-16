import { describe, expect, it } from 'vitest';
import type { CoverageReport, FamilyCoverage } from './coverage';
import {
  buildBasisNotes,
  elementRate,
  formatRate,
  gridEmptyState,
  notesAffecting,
  offenderEmptyState,
  vocabularyRate,
} from './coverageView';
import type { DesignScan } from './designScan';

const scan = (over: Partial<DesignScan> = {}): DesignScan =>
  ({
    elementCount: 100,
    candidateCount: 300,
    truncated: false,
    originAvailable: true,
    originBudgetExceeded: false,
    styleSource: 'stylesheet',
    tokenCounts: { colors: 10, sizes: 10 },
    tokenSources: { pasted: { colors: 10, sizes: 10 }, theme: { colors: 0, sizes: 0 } },
    grid: 4,
    stats: {},
    statsTotals: {},
    coverage: {} as CoverageReport,
    ...over,
  }) as DesignScan;

const family = (over: Partial<FamilyCoverage> = {}): FamilyCoverage => ({
  family: 'color',
  judged: 0,
  hit: 0,
  near: 0,
  far: 0,
  noDict: 0,
  unmeasurable: 0,
  distinctJudged: 0,
  distinctHit: 0,
  ...over,
});

const report = (over: Partial<CoverageReport> = {}): CoverageReport =>
  ({
    families: [],
    overall: { judged: 0, hit: 0 },
    measurable: { judged: 0, total: 0 },
    matrix: { varHit: 0, varMiss: 0, literalHit: 0, literalMiss: 0, originUnknown: 0, notJudged: 0 },
    originTrusted: false,
    originKnown: 0,
    originVar: 0,
    offGrid: { off: 0, total: 0 },
    top: [],
    ...over,
  }) as CoverageReport;

describe('formatRate — 率は実数と一緒にしか取り出せない', () => {
  it('通常の率は百分率 + 実数', () => {
    const r = formatRate(78, 100);
    expect(r).toEqual({ text: '78%', hit: 78, judged: 100, clamped: null, lowSample: false });
  });

  it('判定できた件数が 0 なら率を出さない (分母 0 で嘘をつかない)', () => {
    expect(formatRate(0, 0).text).toBeNull();
  });

  it('**丸めのクランプを開示する**: 1 件でも外れていれば 100% と言わない', () => {
    // 9999/10000 は四捨五入で 100% になるが、外れが実在する
    const r = formatRate(9999, 10000);
    expect(r.text).toBe('>99%');
    expect(r.clamped).toBe('high');
    expect({ hit: r.hit, judged: r.judged }).toEqual({ hit: 9999, judged: 10000 });
  });

  it('1 件でも当たっていれば 0% と言わない', () => {
    const r = formatRate(1, 10000);
    expect(r.text).toBe('<1%');
    expect(r.clamped).toBe('low');
  });

  it('ちょうど全一致 / 全不一致はクランプしない (本物の 100% / 0%)', () => {
    expect(formatRate(10, 10)).toMatchObject({ text: '100%', clamped: null });
    expect(formatRate(0, 10)).toMatchObject({ text: '0%', clamped: null });
  });

  it('判定件数が閾値未満なら lowSample を立てる', () => {
    expect(formatRate(3, 9).lowSample).toBe(true);
    expect(formatRate(3, 10).lowSample).toBe(false);
  });
});

describe('vocabularyRate — 低サンプル保護は語彙軸にこそ要る', () => {
  it('種類ベースの率を出す', () => {
    const r = vocabularyRate(family({ distinctHit: 3, distinctJudged: 12 }));
    expect(r).toMatchObject({ text: '25%', hit: 3, judged: 12, lowSample: false });
  });

  it('**種類数が少ないときに lowSample が立つ** (要素加重では立たない場面でも)', () => {
    const f = family({ hit: 80, judged: 100, distinctHit: 2, distinctJudged: 4 });
    expect(elementRate(f).lowSample, '要素加重は十分なサンプル').toBe(false);
    expect(vocabularyRate(f).lowSample, '語彙軸は 4 種しかない').toBe(true);
  });

  it('種類が 0 なら率を出さない', () => {
    expect(vocabularyRate(family()).text).toBeNull();
  });
});

describe('buildBasisNotes — 但し書きは制限する数字と一緒に旅する', () => {
  it('何も問題が無ければ空', () => {
    expect(buildBasisNotes(scan())).toEqual([]);
  });

  it('打ち切りは全部の指標に効く', () => {
    const notes = buildBasisNotes(scan({ truncated: true }));
    expect(notes).toEqual([{ id: 'truncated', affects: ['match', 'durability', 'grid'] }]);
  });

  it('辞書が空なら一致率だけを制限する (グリッド検査は辞書不要で生きている)', () => {
    const notes = buildBasisNotes(scan({ tokenCounts: { colors: 0, sizes: 0 } }));
    expect(notes).toEqual([{ id: 'noDict', affects: ['match'] }]);
  });

  it('自動テーマ下では一致率とグリッドが独立した証拠でないことを開示する (§6-5)', () => {
    const notes = buildBasisNotes(
      scan({ tokenSources: { pasted: { colors: 0, sizes: 0 }, theme: { colors: 8, sizes: 40 } } }),
    );
    expect(notes).toEqual([{ id: 'themeInflates', affects: ['match', 'grid'] }]);
  });

  it('辞書が空なら themeInflates は出さない (率が無いのに率の但し書きを出さない)', () => {
    const notes = buildBasisNotes(
      scan({
        tokenCounts: { colors: 0, sizes: 0 },
        tokenSources: { pasted: { colors: 0, sizes: 0 }, theme: { colors: 0, sizes: 0 } },
      }),
    );
    expect(notes.map((n) => n.id)).toEqual(['noDict']);
  });

  describe('来歴を主張できない 3 つの理由を取り違えない', () => {
    it('CSS-in-JS', () => {
      const notes = buildBasisNotes(scan({ styleSource: 'css-in-js', originAvailable: false }));
      expect(notes.map((n) => n.id)).toEqual(['cssInJs']);
    });
    it('予算切れ', () => {
      const notes = buildBasisNotes(scan({ originBudgetExceeded: true, originAvailable: false }));
      expect(notes.map((n) => n.id)).toEqual(['originBudget']);
    });
    it('そもそも 1 件も読めない (クロスオリジン CSS 等)', () => {
      const notes = buildBasisNotes(scan({ originAvailable: false }));
      expect(notes.map((n) => n.id)).toEqual(['originUnavailable']);
    });
    it('CSS-in-JS のときは予算切れの理由を重ねて出さない', () => {
      const notes = buildBasisNotes(
        scan({ styleSource: 'css-in-js', originBudgetExceeded: true, originAvailable: false }),
      );
      expect(notes.map((n) => n.id)).toEqual(['cssInJs']);
    });
  });

  it('notesAffecting は影響先で絞れる', () => {
    const notes = buildBasisNotes(scan({ truncated: true, originAvailable: false }));
    expect(notesAffecting(notes, 'grid').map((n) => n.id)).toEqual(['truncated']);
    expect(notesAffecting(notes, 'durability').map((n) => n.id)).toEqual([
      'truncated',
      'originUnavailable',
    ]);
  });
});

describe('空状態を無言にしない', () => {
  it('判定が 1 件も無いのと、判定した上で該当が無いのを区別する', () => {
    expect(offenderEmptyState(report({ overall: { judged: 0, hit: 0 } }))).toBe('nothingJudged');
    expect(offenderEmptyState(report({ overall: { judged: 40, hit: 40 } }))).toBe('noOffenders');
  });

  it('該当がある場合は空状態ではない', () => {
    const withTop = report({
      overall: { judged: 40, hit: 10 },
      top: [{ label: 'padding', value: '13px', count: 3, nearest: null, origins: null }],
    });
    expect(offenderEmptyState(withTop)).toBeNull();
  });

  it('spacing を 1 件も測っていないのと、外れが無いのを区別する', () => {
    expect(gridEmptyState(report({ offGrid: { off: 0, total: 0 } }))).toBe('noSpacingMeasured');
    expect(gridEmptyState(report({ offGrid: { off: 0, total: 30 } }))).toBe('allOnGridOrMatched');
    expect(gridEmptyState(report({ offGrid: { off: 2, total: 30 } }))).toBeNull();
  });
});
