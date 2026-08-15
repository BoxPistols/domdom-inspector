// @vitest-environment happy-dom
// CSSOM 走査を含むため happy-dom (cssVars.test.ts は node 環境の純ロジック専用)。
// Chrome 固有挙動 (var 入り shorthand 等) はここでは扱わない — winningRuleRef は
// ルールの所在だけを見るので happy-dom の CSSOM で足りる。
import { beforeEach, describe, expect, it } from 'vitest';
import { winningRuleRef } from './cssVars';
describe('winningRuleRef (CSS ファイルを開くフォールバック)', () => {
  beforeEach(() => {
    document.head.querySelectorAll('style').forEach((s) => s.remove());
    document.body.innerHTML = '';
  });

  it('specificity 最強のルールの所在を返す', () => {
    document.head.innerHTML = '<style>.btn { color: red } #x.btn { color: blue }</style>';
    const el = document.createElement('div');
    el.id = 'x';
    el.className = 'btn';
    document.body.appendChild(el);
    const ref = winningRuleRef(el);
    expect(ref?.selector).toBe('#x.btn');
    expect(ref?.href).toBeNull(); // <style> はファイルではない
  });

  it('同 specificity なら後勝ち (cascade の順序)', () => {
    document.head.innerHTML = '<style>.a { color: red } .b { color: blue }</style>';
    const el = document.createElement('div');
    el.className = 'a b';
    document.body.appendChild(el);
    expect(winningRuleRef(el)?.selector).toBe('.b');
  });

  it('宣言が空のルールは勝者にしない (開いても何も無い)', () => {
    document.head.innerHTML = '<style>#x.a {} .a { color: red }</style>';
    const el = document.createElement('div');
    el.id = 'x';
    el.className = 'a';
    document.body.appendChild(el);
    expect(winningRuleRef(el)?.selector).toBe('.a');
  });

  it('マッチするルールが無ければ null (誤検出しない)', () => {
    document.head.innerHTML = '<style>.other { color: red }</style>';
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(winningRuleRef(el)).toBeNull();
  });
});
