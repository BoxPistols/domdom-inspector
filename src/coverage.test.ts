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

/** 来歴を主張してよいスキャン (通常の stylesheet + 来歴が取れている) */
const TRUSTED = { originTrusted: true } as const;

/** Markdown の meta 既定 (テストごとに必要な分だけ上書きする) */
const META = {
  elementCount: 10,
  truncated: false,
  grid: 4,
  tokenCounts: { colors: 1, sizes: 2 },
};

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
      TRUSTED,
    );
    expect(r.matrix).toEqual({
      varHit: 12,
      literalHit: 7,
      literalMiss: 3,
      varMiss: 2,
      originUnknown: 0,
      notJudged: 0,
    });
    // 一致率は来歴に関わらず 19/24 (var 必須にしない)
    expect(r.overall).toEqual({ judged: 24, hit: 19 });
  });

  it('継承値は象限に入れず originUnknown に回す (literal に混ぜない)', () => {
    const r = buildCoverage(
      [
        occ('color', '#1668d4', 100, 'inherited'),
        occ('color', '#1668d4', 50, 'unknown'),
        occ('color', '#1668d4', 4, 'literal'),
      ],
      DICT,
      TRUSTED,
    );
    expect(r.matrix.literalHit).toBe(4);
    expect(r.matrix.originUnknown).toBe(150);
    expect(r.originKnown).toBe(4);
  });

  it('「該当トークンが無い」を来歴不明に混ぜない (表示文が嘘になる類型)', () => {
    // radius は DICT にトークンが無い = 判定できていないので、来歴の問題ではない
    const r = buildCoverage(
      [occ('radius', '6px', 30, 'literal'), occ('color', '#1668d4', 4, 'inherited')],
      DICT,
      TRUSTED,
    );
    expect(r.matrix.notJudged).toBe(30);
    expect(r.matrix.originUnknown).toBe(4);
    // 判定できなかった分は判定カバー率の側で申告される
    expect(r.measurable).toEqual({ judged: 4, total: 34 });
  });

  it('CSS 変数経由率は来歴が判定できた分だけを分母にする', () => {
    const r = buildCoverage(
      [
        occ('color', '#1668d4', 6, 'var'),
        occ('color', '#00ff00', 2, 'literal'),
        occ('color', '#123456', 90, 'inherited'),
      ],
      DICT,
      TRUSTED,
    );
    expect(r.originKnown).toBe(8);
    expect(r.originVar).toBe(6);
    expect(ratePercent(r.originVar, r.originKnown)).toBe(75);
  });
});

describe('buildCoverage — 来歴を主張してよいかのゲート (§6-1)', () => {
  const OCCS = [occ('color', '#1668d4', 12, 'var'), occ('color', '#00ff00', 3, 'literal')];

  it('既定 (originTrusted 未指定) では来歴を一切主張しない', () => {
    const r = buildCoverage(OCCS, DICT);
    expect(r.originTrusted).toBe(false);
    expect(r.originKnown).toBe(0);
    expect(r.originVar).toBe(0);
    expect(r.matrix.varHit).toBe(0);
    expect(r.matrix.literalMiss).toBe(0);
    // 判定はできているので notJudged ではなく originUnknown に入る
    expect(r.matrix.originUnknown).toBe(15);
    // 一致率は来歴と直交するので影響を受けない
    expect(r.overall).toEqual({ judged: 15, hit: 12 });
  });

  it('信頼できないスキャンでは offender の来歴内訳を null にする (表示側の条件に依存しない)', () => {
    expect(buildCoverage(OCCS, DICT).top[0].origins).toBeNull();
    expect(buildCoverage(OCCS, DICT, TRUSTED).top[0].origins).toEqual({
      var: 0,
      literal: 3,
      other: 0,
    });
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

  it('同じ値は来歴を跨いで 1 行にまとめてからランキングする', () => {
    // 実バグ: designScan の Occurrence キーは origin を含むため、同じ #1a6cd8 が
    // var 経由 30 件 + 直書き 40 件だと 2 行に分裂し、count 70 の 1 行に負けていた
    const r = buildCoverage(
      [
        occ('color', '#1a6cd8', 30, 'var'),
        occ('color', '#1a6cd8', 40, 'literal'),
        occ('color', '#00ff00', 65, 'literal'),
      ],
      DICT,
      TRUSTED,
    );
    expect(r.top).toHaveLength(2);
    expect(r.top[0]).toMatchObject({ value: '#1a6cd8', count: 70 });
    expect(r.top[0].origins).toEqual({ var: 30, literal: 40, other: 0 });
    expect(r.top[1]).toMatchObject({ value: '#00ff00', count: 65 });
  });

  it('label が違えば同じ値でも別行にする (padding 8px と margin 8px を混ぜない)', () => {
    const dict = parseTokens({ 'space/4': { $value: '16px', $type: 'dimension' } });
    const r = buildCoverage(
      [occ('padding', '10px', 3), occ('margin', '10px', 2)],
      dict,
      TRUSTED,
    );
    expect(r.top).toHaveLength(2);
    expect(r.top.map((t) => t.label).sort()).toEqual(['margin', 'padding']);
  });

  it('同数のときは走査順ではなく label/value 順で並べる (決定論)', () => {
    const forward = buildCoverage(
      [occ('color', '#00ff00', 5), occ('color', '#00ff01', 5)],
      DICT,
    );
    const reversed = buildCoverage(
      [occ('color', '#00ff01', 5), occ('color', '#00ff00', 5)],
      DICT,
    );
    expect(forward.top.map((t) => t.value)).toEqual(['#00ff00', '#00ff01']);
    expect(reversed.top.map((t) => t.value)).toEqual(forward.top.map((t) => t.value));
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
    const md = formatCoverageMarkdown(r, { ...META, elementCount: 2000, truncated: true });
    expect(md).toContain('stopped at the scan limit');
    expect(md).toContain('not for the whole page');
    // 可視要素数と DOM 全ノード数は母集団が違うので並べない (§6-4)
    expect(md).not.toMatch(/first \d+ of \d+ elements/);
    // 来歴が取れていないときは来歴セクションを出さない
    expect(md).not.toContain('Where the value comes from');
  });

  it('判定できないファミリは率ではなく理由を書く', () => {
    const r = buildCoverage([occ('radius', '6px', 4)], DICT);
    expect(formatCoverageMarkdown(r, META)).toContain('radius: not measurable');
  });

  it('来歴を主張してよいかは report が持つ (呼び出し側が渡し忘れられない)', () => {
    const occs = [occ('color', '#1668d4', 12, 'var'), occ('color', '#00ff00', 3, 'literal')];
    // 実バグ: popup は CSS-in-JS のとき画面では来歴を主張しないのに、コピー出力には
    // "Written value, off token" が載っていた (持ち出される側の方が不誠実)
    expect(formatCoverageMarkdown(buildCoverage(occs, DICT), META)).not.toContain(
      'Where the value comes from',
    );
    const trusted = formatCoverageMarkdown(buildCoverage(occs, DICT, TRUSTED), META);
    expect(trusted).toContain('Where the value comes from');
    expect(trusted).toContain('Origin unknown');
    // 「該当トークンが無い」を来歴の行に混ぜない
    expect(trusted).toContain('Not judged (no token of that kind');
  });

  it('offender の件数を修正箇所数として書かない (count は要素数)', () => {
    const r = buildCoverage([occ('color', '#1a6cd8', 96, 'literal')], DICT, TRUSTED);
    const md = formatCoverageMarkdown(r, META);
    expect(md).toContain('used on 96 elements');
    expect(md).not.toMatch(/places to change/);
    // 来歴は分布として書く (単一の変数名や修正コストは主張しない)
    expect(md).toContain('96 written in place');
  });

  it('グリッド検査と判定閾値を Markdown にも出す (UI にあって持ち出し先に無い状態を作らない)', () => {
    const r = buildCoverage([occ('padding', '10px', 4), occ('padding', '8px', 6)], DICT);
    const md = formatCoverageMarkdown(r, META);
    expect(md).toContain('## Off the 4px grid');
    expect(md).toContain('(4/10)');
    expect(md).toContain('## How values were judged');
    expect(md).toContain('RGB distance of 3');
    expect(md).toContain('within 0.25px');
    expect(md).toContain('iframes, shadow DOM');
  });

  it('辞書の規模と出所を書く (自動テーマで率が上がる事実を伏せない)', () => {
    const r = buildCoverage([occ('color', '#1668d4', 3)], DICT);
    expect(formatCoverageMarkdown(r, META)).toContain('Tokens used for matching: 1 colors / 2 sizes');
    const withTheme = formatCoverageMarkdown(r, {
      ...META,
      tokenSources: { pasted: { colors: 1, sizes: 2 }, theme: { colors: 120, sizes: 386 } },
    });
    expect(withTheme).toContain('from the app theme 120/386');
    expect(withTheme).toContain('without de-duplication');
    const pastedOnly = formatCoverageMarkdown(r, {
      ...META,
      tokenSources: { pasted: { colors: 1, sizes: 2 }, theme: { colors: 0, sizes: 0 } },
    });
    expect(pastedOnly).toContain('all pasted by you');
  });

  it('辞書が空なら「照合できていない」と書く (率の不在を沈黙にしない)', () => {
    const r = buildCoverage([occ('padding', '10px', 4)], { colors: [], sizes: [] });
    const md = formatCoverageMarkdown(r, { ...META, tokenCounts: { colors: 0, sizes: 0 } });
    expect(md).toContain('No tokens were provided');
    // グリッド検査は辞書に依らず有効なので残る
    expect(md).toContain('## Off the 4px grid');
  });
});
