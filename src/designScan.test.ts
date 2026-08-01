// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { scanDesign } from './designScan';
import { EMPTY_TOKEN_DICT, parseTokens } from './tokenDict';

function setup(html: string) {
  document.body.innerHTML = html;
  return document;
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
});
