import { describe, expect, it } from 'vitest';
import {
  carryDocumentKey,
  derivePanelState,
  tokenSignatureOf,
  type PanelMeasurement,
  type PanelTarget,
} from './panelState';

/**
 * §6-6 のとおり、side panel の状態遷移は e2e で再現できない (Playwright に side panel を
 * 開く API が無く、`sidePanel.open()` は user gesture 必須)。**本設計で最も壊してはいけない
 * 箇所が実機目視でしか守れない**ので、遷移そのものはここで網羅する。
 */

const SIG = 'c2:a,b|s1:x';

const target = (over: Partial<PanelTarget> = {}): PanelTarget => ({
  tabId: 1,
  origin: 'https://example.com',
  documentKey: 'doc-1',
  ...over,
});

const measurement = (over: Partial<PanelMeasurement> = {}): PanelMeasurement => ({
  tabId: 1,
  documentKey: 'doc-1',
  tokenSignature: SIG,
  at: 1_000,
  ...over,
});

describe('derivePanelState — 鮮度', () => {
  it('計測がまだ無ければ none (数字を出す前の状態)', () => {
    const s = derivePanelState({ target: target(), measurement: null, tokenSignature: SIG });
    expect(s.freshness).toBe('none');
    expect(s.trustNumbers).toBe(false);
    expect(s.canHighlight).toBe(false);
  });

  it('同じタブ・同じページ・同じ辞書なら fresh', () => {
    const s = derivePanelState({
      target: target(),
      measurement: measurement(),
      tokenSignature: SIG,
    });
    expect(s.freshness).toBe('fresh');
    expect(s.trustNumbers).toBe(true);
    expect(s.canHighlight).toBe(true);
  });

  it('タブが変わったら stale-tab', () => {
    const s = derivePanelState({
      target: target({ tabId: 2 }),
      measurement: measurement(),
      tokenSignature: SIG,
    });
    expect(s.freshness).toBe('stale-tab');
  });

  it('ページが遷移したら stale-navigation', () => {
    const s = derivePanelState({
      target: target({ documentKey: 'doc-2' }),
      measurement: measurement(),
      tokenSignature: SIG,
    });
    expect(s.freshness).toBe('stale-navigation');
  });

  it('辞書が編集されたら stale-tokens', () => {
    const s = derivePanelState({
      target: target(),
      measurement: measurement(),
      tokenSignature: 'c3:a,b,c|s1:x',
    });
    expect(s.freshness).toBe('stale-tokens');
  });
});

describe('derivePanelState — 曖昧なときは必ず安全側 (古い率を新鮮な顔で出さない)', () => {
  it('対象タブが解決できていなければ stale-tab (「たぶん同じ」に倒さない)', () => {
    const s = derivePanelState({
      target: target({ tabId: null }),
      measurement: measurement(),
      tokenSignature: SIG,
    });
    expect(s.freshness).toBe('stale-tab');
    expect(s.canHighlight, '塗る先が確定しないのでハイライトも止める').toBe(false);
  });

  it('ページの世代を見失ったら stale-navigation (計測時は鍵があった)', () => {
    const s = derivePanelState({
      target: target({ documentKey: null }),
      measurement: measurement({ documentKey: 'doc-1' }),
      tokenSignature: SIG,
    });
    expect(s.freshness).toBe('stale-navigation');
  });

  it('両方とも世代不明なら、それだけでは stale にしない (常時 stale は「いつも嘘」と同じ)', () => {
    const s = derivePanelState({
      target: target({ documentKey: null }),
      measurement: measurement({ documentKey: null }),
      tokenSignature: SIG,
    });
    expect(s.freshness).toBe('fresh');
  });
});

describe('derivePanelState — 食い違いが複数あるときの優先順位', () => {
  // タブが違うのに「トークンを編集しました」と出すと、再計測すれば直ると誤解させる。
  // より根本的にズレている方を出す
  it('タブ違い + ページ違い + 辞書違い → stale-tab', () => {
    const s = derivePanelState({
      target: target({ tabId: 9, documentKey: 'other' }),
      measurement: measurement(),
      tokenSignature: 'different',
    });
    expect(s.freshness).toBe('stale-tab');
  });

  it('ページ違い + 辞書違い → stale-navigation', () => {
    const s = derivePanelState({
      target: target({ documentKey: 'other' }),
      measurement: measurement(),
      tokenSignature: 'different',
    });
    expect(s.freshness).toBe('stale-navigation');
  });
});

describe('derivePanelState — availability は理由を断定しない (§6-2)', () => {
  it('origin が読めれば ok', () => {
    const s = derivePanelState({ target: target(), measurement: null, tokenSignature: SIG });
    expect(s.availability).toBe('ok');
  });

  it('origin が読めなければ unknown (「検査できない」と断定しない)', () => {
    const s = derivePanelState({
      target: target({ origin: null }),
      measurement: null,
      tokenSignature: SIG,
    });
    expect(s.availability).toBe('unknown');
  });

  it('origin が読めなくても、たった今その タブを計測できたならハイライトは許す', () => {
    // origin が読めない = 名前を出せないだけで、塗る先が違うわけではない。
    // ここを availability と結ぶと、localhost で機能が丸ごと死ぬ
    const s = derivePanelState({
      target: target({ origin: null }),
      measurement: measurement(),
      tokenSignature: SIG,
    });
    expect(s.availability).toBe('unknown');
    expect(s.canHighlight).toBe(true);
  });
});

describe('tokenSignatureOf', () => {
  it('同じ辞書なら同じ署名 (順序に依存しない)', () => {
    expect(tokenSignatureOf({ colors: ['b', 'a'], sizes: ['x'] })).toBe(
      tokenSignatureOf({ colors: ['a', 'b'], sizes: ['x'] }),
    );
  });

  it('**件数が同じでも中身が変われば署名が変わる** (件数だけの比較では見逃す)', () => {
    const before = tokenSignatureOf({ colors: ['a', 'b'], sizes: [] });
    const after = tokenSignatureOf({ colors: ['a', 'c'], sizes: [] });
    expect(after).not.toBe(before);
  });

  it('色とサイズが入れ替わっただけでも別署名になる', () => {
    expect(tokenSignatureOf({ colors: ['a'], sizes: [] })).not.toBe(
      tokenSignatureOf({ colors: [], sizes: ['a'] }),
    );
  });

  it('空の辞書も安定した署名を持つ', () => {
    expect(tokenSignatureOf({ colors: [], sizes: [] })).toBe(
      tokenSignatureOf({ colors: [], sizes: [] }),
    );
  });
});

/**
 * 「タブを離れて戻る」で遷移したことにしない (セルフレビューで見つけた誤答)。
 *
 * 実装が「タブが変わったら世代を捨てる」だけだったため、戻ってきたときに復元できず
 * `stale-navigation` = 「このページは遷移しました」と**起きていないこと**を出していた。
 */
describe('carryDocumentKey — 世代を引き継いでよいか', () => {
  const m = (over: Partial<PanelMeasurement> = {}): PanelMeasurement => ({
    tabId: 1,
    documentKey: 'doc-1',
    tokenSignature: SIG,
    at: 0,
    ...over,
  });

  it('同じタブで遷移を観測していなければ引き継ぐ (離れて戻っただけ)', () => {
    expect(
      carryDocumentKey({ tabId: 1, measurement: m(), navigatedTabs: new Set() }),
    ).toBe('doc-1');
  });

  it('そのタブの遷移を観測していたら引き継がない', () => {
    expect(
      carryDocumentKey({ tabId: 1, measurement: m(), navigatedTabs: new Set([1]) }),
    ).toBeNull();
  });

  it('**裏で遷移したタブに戻った場合も引き継がない** (fresh に見えるのが一番危ない)', () => {
    // 別タブを見ている間に計測済みタブが遷移した、という並び
    const navigated = new Set<number>();
    navigated.add(1); // onUpdated は見ていないタブでも届く
    expect(carryDocumentKey({ tabId: 1, measurement: m(), navigatedTabs: navigated })).toBeNull();
  });

  it('別のタブなら引き継がない', () => {
    expect(
      carryDocumentKey({ tabId: 2, measurement: m(), navigatedTabs: new Set() }),
    ).toBeNull();
  });

  it('計測がまだ無い / タブが未解決なら引き継ぐものが無い', () => {
    expect(carryDocumentKey({ tabId: 1, measurement: null, navigatedTabs: new Set() })).toBeNull();
    expect(carryDocumentKey({ tabId: null, measurement: m(), navigatedTabs: new Set() })).toBeNull();
  });

  it('離れて戻る往復で fresh に戻る (この誤答の再現ケース)', () => {
    const measurement = m();
    const navigatedTabs = new Set<number>();
    // タブ 2 へ離れる
    let key = carryDocumentKey({ tabId: 2, measurement, navigatedTabs });
    expect(
      derivePanelState({
        target: { tabId: 2, origin: 'https://other.test', documentKey: key },
        measurement,
        tokenSignature: SIG,
      }).freshness,
    ).toBe('stale-tab');
    // タブ 1 へ戻る (ページは何も遷移していない)
    key = carryDocumentKey({ tabId: 1, measurement, navigatedTabs });
    expect(
      derivePanelState({
        target: { tabId: 1, origin: 'https://example.com', documentKey: key },
        measurement,
        tokenSignature: SIG,
      }).freshness,
    ).toBe('fresh');
  });
});
