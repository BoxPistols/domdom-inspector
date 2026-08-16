// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { scanDesign } from './designScan';
import { findElementsForValue, HIGHLIGHT_MAX } from './designHighlight';
import { EMPTY_TOKEN_DICT } from './tokenDict';

/**
 * **計測とハイライトで件数が一致すること**が、この画面の存在理由そのもの
 * (率の根拠を実画面で検算させる)。ここが 1 件でもずれると製品の芯が壊れるので、
 * 「同じ値を計測側とハイライト側の両方で数えて突き合わせる」形で固定する。
 */

function build(html: string) {
  document.body.innerHTML = html;
}

/** 計測側が数えた件数 (同じ値の occurrence 合計) */
function measuredCount(label: string, value: string): number {
  const scan = scanDesign(document, EMPTY_TOKEN_DICT);
  const stat = (scan.stats[label] ?? []).find((s) => s.value === value);
  return stat?.count ?? 0;
}

describe('findElementsForValue — 計測と同じ数を返す', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('同じ値を使っている要素をすべて拾う', () => {
    build(`
      <div style="padding: 13px">a</div>
      <div style="padding: 13px">b</div>
      <div style="padding: 16px">c</div>
    `);
    const match = findElementsForValue(document, { label: 'padding', value: '13px' });
    expect(match.total).toBe(2);
    expect(match.elements).toHaveLength(2);
    expect(match.cappedAt).toBeNull();
  });

  it('**計測側の件数と一致する** (食い違うと検算にならない)', () => {
    build(`
      <div style="padding: 13px"><span style="padding: 13px">x</span></div>
      <div style="padding: 13px">b</div>
      <p style="padding: 5px">c</p>
    `);
    const measured = measuredCount('padding', '13px');
    const highlighted = findElementsForValue(document, { label: 'padding', value: '13px' }).total;
    expect({ measured, highlighted }).toEqual({ measured: 3, highlighted: 3 });
  });

  it('該当が無ければ 0 件 (エラーにしない)', () => {
    build('<div style="padding: 4px">a</div>');
    const match = findElementsForValue(document, { label: 'padding', value: '99px' });
    expect(match.total).toBe(0);
    expect(match.elements).toEqual([]);
  });

  it('1 要素を二重に数えない', () => {
    build('<div style="padding: 13px">a</div>');
    expect(findElementsForValue(document, { label: 'padding', value: '13px' }).total).toBe(1);
  });
});

describe('findElementsForValue — 上限と skip', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('描画上限を超えたら描くのは上限までにし、総数は正しく返す', () => {
    build(Array.from({ length: 12 }, () => '<div style="padding: 13px">x</div>').join(''));
    const match = findElementsForValue(
      document,
      { label: 'padding', value: '13px' },
      { drawMax: 5 },
    );
    expect(match.elements).toHaveLength(5);
    expect(match.total, '総数は上限で切らない (部分表示を全体と誤読させない)').toBe(12);
    expect(match.cappedAt).toBe(5);
  });

  it('上限ちょうどでは cappedAt を立てない', () => {
    build(Array.from({ length: 5 }, () => '<div style="padding: 13px">x</div>').join(''));
    const match = findElementsForValue(
      document,
      { label: 'padding', value: '13px' },
      { drawMax: 5 },
    );
    expect(match.cappedAt).toBeNull();
  });

  it('既定の描画上限は 200', () => {
    expect(HIGHLIGHT_MAX).toBe(200);
  });

  it('**skip した要素は計測側と同じく数えない** (自前 UI を自分で塗らない)', () => {
    build(`
      <div id="ui" style="padding: 13px">overlay</div>
      <div style="padding: 13px">page</div>
    `);
    const skip = (el: Element) => el.id === 'ui';
    const match = findElementsForValue(document, { label: 'padding', value: '13px' }, { skip });
    expect(match.total).toBe(1);
    expect((match.elements[0] as HTMLElement).textContent).toBe('page');
  });

  it('走査上限に当たったら truncated を伝える (計測側と同じ意味)', () => {
    build(Array.from({ length: 6 }, () => '<div style="padding: 13px">x</div>').join(''));
    // **root を body にする**: document 起点だと html/head/body が先に上限を食い、
    // 「該当 0 件」に見えてしまう (上限の意味を取り違えたテストになる)
    const match = findElementsForValue(document.body, { label: 'padding', value: '13px' }, { max: 3 });
    expect(match.truncated).toBe(true);
    expect(match.total, '走査した範囲での総数').toBe(3);
  });

  it('走査を最後まで回せたら truncated は立たない (可視要素がちょうど上限でも)', () => {
    build(Array.from({ length: 3 }, () => '<div style="padding: 13px">x</div>').join(''));
    const match = findElementsForValue(document.body, { label: 'padding', value: '13px' }, { max: 3 });
    expect(match.truncated).toBe(false);
    expect(match.total).toBe(3);
  });
});
