// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { scanDesign } from './designScan';
import { EMPTY_TOKEN_DICT, parseTokens } from './tokenDict';

function setup(html: string) {
  document.body.innerHTML = html;
  return document;
}

/**
 * 走査 root を body に絞る。document を渡すと html/head/body 自体が候補に入り、
 * 件数の期待値が happy-dom の実装差で揺れる (打ち切り判定の検証には不向き)。
 */
function setupBody(html: string) {
  document.body.innerHTML = html;
  return document.body;
}

describe('scanDesign', () => {
  it('可視要素のデザイン値を頻度集計し、トークン照合とグリッド判定を付ける', () => {
    const doc = setup(`
      <div style="color: rgb(22, 104, 212)">a</div>
      <div style="color: rgb(22, 104, 212)">b</div>
      <div style="padding: 10px">c</div>
    `);
    const dict = parseTokens({ primary: '#1668d4', 'space/2': '8px' });
    const scan = scanDesign(doc, dict);
    expect(scan.elementCount).toBeGreaterThanOrEqual(3);
    expect(scan.tokenCounts).toEqual({ colors: 1, sizes: 1 });
    const color = scan.stats.color?.find((s) => s.value === '#1668d4');
    expect(color?.count).toBe(2);
    expect(color?.token).toBe('primary');
    const pad = scan.stats.padding?.find((s) => s.value === '10px');
    expect(pad?.offGrid).toBe(true); // 10px は 4px グリッド外
    expect(pad?.nearest).toBe('space/2'); // かつ 8px トークンの近傍
  });

  it('skip 述語で自前 UI を除外できる / 空辞書でも壊れない', () => {
    const doc = setup(`
      <div id="mine" style="color: rgb(1, 2, 3)">overlay</div>
      <div style="color: rgb(9, 9, 9)">page</div>
    `);
    const scan = scanDesign(doc, EMPTY_TOKEN_DICT, {
      skip: (el) => el.id === 'mine' || el.closest('#mine') !== null,
    });
    expect(scan.stats.color?.some((s) => s.value === '#010203')).toBe(false);
    expect(scan.stats.color?.some((s) => s.value === '#090909')).toBe(true);
  });

  it('集計にページ内容 (テキスト) を含めない', () => {
    const doc = setup(`<div style="color: rgb(1, 2, 3)">SECRET-CONTENT</div>`);
    const scan = scanDesign(doc, EMPTY_TOKEN_DICT);
    expect(JSON.stringify(scan)).not.toContain('SECRET');
  });

  it('グリッド刻み幅と辞書の出所を結果に載せる (表示側にリテラルを書かせない)', () => {
    const doc = setup(`<div style="padding: 6px">a</div>`);
    const scan = scanDesign(doc, EMPTY_TOKEN_DICT, {
      grid: 8,
      tokenSources: { pasted: { colors: 1, sizes: 2 }, theme: { colors: 3, sizes: 4 } },
    });
    expect(scan.grid).toBe(8);
    expect(scan.tokenSources).toEqual({
      pasted: { colors: 1, sizes: 2 },
      theme: { colors: 3, sizes: 4 },
    });
    // 出所を渡さなければ null (「内訳がある」と誤読させない)
    expect(scanDesign(doc, EMPTY_TOKEN_DICT).tokenSources).toBeNull();
  });
});

describe('scanDesign — 打ち切り判定 (ループを最後まで回せたかで決める)', () => {
  it('上限に当たって未走査の要素を残したときだけ truncated', () => {
    const body = setupBody(`
      <div style="color: rgb(1, 1, 1)">1</div>
      <div style="color: rgb(2, 2, 2)">2</div>
      <div style="color: rgb(3, 3, 3)">3</div>
      <div style="color: rgb(4, 4, 4)">4</div>
    `);
    expect(scanDesign(body, EMPTY_TOKEN_DICT, { max: 3 }).truncated).toBe(true);
    expect(scanDesign(body, EMPTY_TOKEN_DICT, { max: 100 }).truncated).toBe(false);
  });

  it('対象外要素で候補数が上回っているだけなら truncated にしない (偽陽性の回帰)', () => {
    // 旧判定は `elementCount >= MAX && candidateCount > elementCount` だったため、
    // 最後まで走査できていても「計測対象外の要素がある」だけで打ち切りと申告していた
    const body = setupBody(`
      <div id="mine"><span>overlay-child</span></div>
      <div style="color: rgb(1, 1, 1)">1</div>
      <div style="color: rgb(2, 2, 2)">2</div>
      <div style="color: rgb(3, 3, 3)">3</div>
    `);
    const scan = scanDesign(body, EMPTY_TOKEN_DICT, {
      max: 3,
      skip: (el) => el.id === 'mine' || el.closest('#mine') !== null,
    });
    expect(scan.elementCount).toBe(3);
    expect(scan.candidateCount).toBeGreaterThan(scan.elementCount);
    expect(scan.truncated).toBe(false);
  });
});

describe('scanDesign — 来歴予算が実際にコストを止める', () => {
  /** CSSOM 全走査の発生を document.styleSheets の参照回数で観測する */
  function countStyleSheetReads<T>(run: () => T): { reads: number; result: T } {
    const real = document.styleSheets;
    let reads = 0;
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get() {
        reads += 1;
        return real;
      },
    });
    try {
      // run() を先に評価する: オブジェクトリテラルの評価順だと reads が 0 で固定される
      const result = run();
      return { reads, result };
    } finally {
      Reflect.deleteProperty(document, 'styleSheets');
    }
  }

  it('予算を超えたら CSSOM 走査そのものを行わない (結果だけ捨てる二重損を潰す)', () => {
    const html = `
      <div style="color: rgb(1, 1, 1)">1</div>
      <div style="color: rgb(2, 2, 2)">2</div>
    `;
    // 対照: 予算内なら来歴のために CSSOM を走査している
    const normal = countStyleSheetReads(() => scanDesign(setupBody(html), EMPTY_TOKEN_DICT));
    expect(normal.reads).toBeGreaterThan(0);
    expect(normal.result.originAvailable).toBe(true);

    // 予算切れ: 来歴を諦めた後は 1 度も走査しない
    const exceeded = countStyleSheetReads(() => {
      let t = 0;
      return scanDesign(setupBody(html), EMPTY_TOKEN_DICT, { now: () => (t += 5000) });
    });
    expect(exceeded.reads).toBe(0);
    expect(exceeded.result.originAvailable).toBe(false);
    // 来歴を諦めても一致計測は続ける (率は出せる)
    expect(exceeded.result.elementCount).toBe(normal.result.elementCount);
  });
});

describe('scanDesign — 来歴を主張してよいかのゲート (§6-1)', () => {
  it('CSS-in-JS を検出したら来歴の主張をやめる (report まで伝わる)', () => {
    const dict = parseTokens({ primary: '#1668d4' });
    const html = `
      <div style="color: rgb(0, 255, 0)">rogue</div>
      <div style="color: rgb(0, 255, 0)">rogue</div>
    `;
    const plain = scanDesign(setup(html), dict);
    const cssInJs = scanDesign(setup(`<style data-emotion="css">.x{}</style>${html}`), dict);

    // 対照: 素の stylesheet では来歴を主張できている (両方 false で通る試験にしない)
    expect(plain.coverage.originTrusted).toBe(true);
    expect(plain.coverage.top[0].origins).toEqual({ var: 0, literal: 2, other: 0 });

    expect(cssInJs.styleSource).toBe('css-in-js');
    expect(cssInJs.coverage.originTrusted).toBe(false);
    expect(cssInJs.coverage.originKnown).toBe(0);
    // 「直すと効く値」は出るが、来歴の内訳は付けない
    expect(cssInJs.coverage.top.length).toBeGreaterThan(0);
    expect(cssInJs.coverage.top[0].origins).toBeNull();
    // 一致率は来歴と直交するので CSS-in-JS でも変わらない
    expect(cssInJs.coverage.overall).toEqual(plain.coverage.overall);
  });
});
