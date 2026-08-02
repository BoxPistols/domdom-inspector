import { describe, expect, it } from 'vitest';
import {
  buildCoverage,
  familyRate,
  formatCoverageMarkdown,
  isDictEmpty,
  ratePercent,
  type Occurrence,
} from './coverage';
import { parseTokens, type TokenDict } from './tokenDict';

const DICT: TokenDict = parseTokens({
  primary: '#1668d4',
  'space/1': { $value: '4px', $type: 'dimension' },
  'space/2': { $value: '8px', $type: 'dimension' },
});

const occ = (
  label: string,
  value: string,
  count: number,
  origin: Occurrence['origin'] = 'unknown',
): Occurrence => ({ label, value, count, origin });

const family = (r: ReturnType<typeof buildCoverage>, name: string) =>
  r.families.find((f) => f.family === name)!;

describe('ratePercent — 丸めで嘘をつかない', () => {
  it('一部でも外れていれば 100% にしない (99% に丸める)', () => {
    expect(ratePercent(999, 1000)).toBe(99);
    expect(ratePercent(1000, 1000)).toBe(100);
  });

  it('1 件でも当たっていれば 0% にしない (1% に丸める)', () => {
    expect(ratePercent(1, 1000)).toBe(1);
    // 本当に 1 件も当たっていない 0% は正しいので出す
    expect(ratePercent(0, 1000)).toBe(0);
  });

  it('分母 0 は率を出さない (null)', () => {
    expect(ratePercent(0, 0)).toBeNull();
  });
});

describe('buildCoverage — 判定できないものを分母に入れない', () => {
  it('該当カテゴリのトークンが無い値は judged に数えず noDict に積む', () => {
    // DICT には radius カテゴリのトークンが無い
    const r = buildCoverage([occ('radius', '6px', 10)], DICT);
    const radius = family(r, 'radius');
    expect(radius.judged).toBe(0);
    expect(radius.noDict).toBe(10);
    // 0% ではなく「率を出さない」が正しい
    expect(familyRate(radius)).toBeNull();
  });

  it('解析できない色は far ではなく unmeasurable', () => {
    const r = buildCoverage([occ('color', 'color-mix(in srgb, red, blue)', 5)], DICT);
    const color = family(r, 'color');
    expect(color.unmeasurable).toBe(5);
    expect(color.far).toBe(0);
    expect(color.judged).toBe(0);
  });

  it('判定できた件数だけで率を出し、判定カバー率を別に持つ', () => {
    const r = buildCoverage(
      [
        occ('color', '#1668d4', 30), // hit
        occ('color', '#00ff00', 10), // far
        occ('radius', '6px', 60), // noDict
      ],
      DICT,
    );
    expect(family(r, 'color').judged).toBe(40);
    expect(ratePercent(r.overall.hit, r.overall.judged)).toBe(75);
    // 判定できたのは 100 件中 40 件
    expect(r.measurable).toEqual({ judged: 40, total: 100 });
  });
});

describe('buildCoverage — 来歴 × 一致の 4 象限', () => {
  it('ベタ書きだが一致 と 変数経由で一致 を別々に数える', () => {
    const r = buildCoverage(
      [
        occ('color', '#1668d4', 12, 'var'), // 変数 + 一致
        occ('color', '#1668d4', 7, 'literal'), // ベタ書きだが一致
        occ('color', '#00ff00', 3, 'literal'), // ベタ書きの野良値
        occ('color', '#00ff00', 2, 'var'), // 変数だがトークン外
      ],
      DICT,
    );
    expect(r.matrix).toEqual({
      varHit: 12,
      literalHit: 7,
      literalMiss: 3,
      varMiss: 2,
      excluded: 0,
    });
    // 一致率は来歴に関わらず 19/24 (var 必須にしない)
    expect(r.overall).toEqual({ judged: 24, hit: 19 });
  });

  it('継承値と判定不能は象限に入れず excluded に回す (literal に混ぜない)', () => {
    const r = buildCoverage(
      [
        occ('color', '#1668d4', 100, 'inherited'),
        occ('color', '#1668d4', 50, 'unknown'),
        occ('color', '#1668d4', 4, 'literal'),
      ],
      DICT,
    );
    expect(r.matrix.literalHit).toBe(4);
    expect(r.matrix.excluded).toBe(150);
    expect(r.originKnown).toBe(4);
  });

  it('CSS 変数経由率は来歴が判定できた分だけを分母にする', () => {
    const r = buildCoverage(
      [
        occ('color', '#1668d4', 6, 'var'),
        occ('color', '#00ff00', 2, 'literal'),
        occ('color', '#123456', 90, 'inherited'),
      ],
      DICT,
    );
    expect(r.originKnown).toBe(8);
    expect(r.originVar).toBe(6);
    expect(ratePercent(r.originVar, r.originKnown)).toBe(75);
  });
});

describe('buildCoverage — 語彙とグリッドと上位', () => {
  it('語彙は値の種類数で数える (使用回数で重み付けしない)', () => {
    const r = buildCoverage(
      [occ('color', '#1668d4', 500), occ('color', '#00ff00', 1)],
      DICT,
    );
    const color = family(r, 'color');
    expect(color.distinctJudged).toBe(2);
    expect(color.distinctHit).toBe(1);
    // 要素加重は 500/501 で高いが、語彙は 1/2。乖離自体が診断になる
    expect(ratePercent(color.hit, color.judged)).toBe(99);
  });

  it('トークンに一致した値はグリッド外に数えない (overlay と同じ規約)', () => {
    const dict = parseTokens({ 'radius/md': { $value: '6px', $type: 'borderRadius' } });
    // 6px は 4px グリッド外だがトークンなので警告しない
    const r = buildCoverage([occ('radius', '6px', 3)], dict);
    expect(r.offGrid).toEqual({ off: 0, total: 3 });
  });

  it('直すと効く値は件数の降順で最大 5 件', () => {
    const r = buildCoverage(
      [
        occ('color', '#00ff00', 1),
        occ('color', '#1a6cd8', 40),
        occ('color', '#00ff01', 2),
        occ('color', '#00ff02', 3),
        occ('color', '#00ff03', 4),
        occ('color', '#00ff04', 5),
      ],
      DICT,
    );
    expect(r.top).toHaveLength(5);
    expect(r.top[0]).toMatchObject({ value: '#1a6cd8', count: 40, nearest: 'primary' });
  });
});

describe('isDictEmpty / formatCoverageMarkdown', () => {
  it('辞書が空なら率を出す段階に進ませない', () => {
    expect(isDictEmpty({ colors: [], sizes: [] })).toBe(true);
    expect(isDictEmpty(DICT)).toBe(false);
  });

  it('打ち切りを Markdown に必ず申告する (外挿しない)', () => {
    const r = buildCoverage([occ('color', '#1668d4', 3)], DICT);
    const md = formatCoverageMarkdown(r, {
      elementCount: 2000,
      candidateCount: 8431,
      truncated: true,
      originAvailable: false,
    });
    expect(md).toContain('first 2000 of 8431 elements');
    // 来歴が取れていないときは来歴セクションを出さない
    expect(md).not.toContain('Where the value comes from');
  });

  it('判定できないファミリは率ではなく理由を書く', () => {
    const r = buildCoverage([occ('radius', '6px', 4)], DICT);
    const md = formatCoverageMarkdown(r, {
      elementCount: 10,
      candidateCount: 10,
      truncated: false,
      originAvailable: true,
    });
    expect(md).toContain('radius: not measurable');
  });
});
