import type { DesignScan } from '../../src/designScan';
import {
  carryDocumentKey,
  derivePanelState,
  tokenSignatureOf,
  type PanelMeasurement,
  type PanelTarget,
} from '../../src/panelState';
import {
  buildBasisNotes,
  elementRate,
  gridEmptyState,
  offenderEmptyState,
  vocabularyRate,
  type BasisAffects,
  type BasisNote,
  type RateDisplay,
} from '../../src/coverageView';
import { requestScan } from '../../src/scanClient';

/**
 * side panel: トークンカバレッジ計測 (issue #10)。
 *
 * popup ではなくパネルにした理由は 1 点で、**popup は外側をクリックすると必ず閉じる**ため
 * 「率 → その率を作った要素をページ上で指す」検算ループが原理的に作れないこと。
 * 率の隣に「自分で確かめる手段」を置くのが Goodhart 化への唯一の構造的な対策
 * (`docs/design-coverage-screen.md` §2)。
 *
 * ここは描くだけの薄い層にし、状態の導出は `src/panelState.ts` の純関数に寄せる
 * (side panel の状態遷移は e2e で再現できないため。§6-6)。
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const msg = (key: Parameters<typeof browser.i18n.getMessage>[0]) =>
  browser.i18n.getMessage(key) || '';

function applyI18n() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as Parameters<typeof browser.i18n.getMessage>[0] | undefined;
    if (!key) continue;
    const text = msg(key);
    if (text) el.textContent = text;
  }
  document.title = msg('panelTitle') || document.title;
}

// ---- 状態 ------------------------------------------------------------------

let target: PanelTarget = { tabId: null, origin: null, documentKey: null };
let measurement: PanelMeasurement | null = null;
/**
 * 計測後に**実際に遷移した**タブ。
 *
 * これが無いと「タブを離れて戻る」だけで遷移扱いになる: 離れた時点で世代を捨て、
 * 戻っても復元できないため `stale-navigation` が出て「このページは遷移しました」と
 * **起きていないことを言う**。欠測ではなく誤答なので、観測した遷移だけを記録する。
 */
const navigatedTabs = new Set<number>();
let lastScan: DesignScan | null = null;
/** 直近の計測失敗。**成功と同じ扉から出さない** — 理由ごとに説明が違う */
let lastFailure: 'timeout' | 'unreachable' | 'empty' | null = null;
let measuring = false;

/**
 * 今の辞書署名。**v1 の辞書供給元はページのテーマ自動検出だけ**なので、
 * 署名も計測結果から作る (パネル側に辞書の実体は無い)。トークン貼り付けを戻す
 * (issue #13) ときは、ここが storage の辞書からも作られるようになる。
 */
function signatureOfScan(scan: DesignScan | null): string {
  if (!scan) return tokenSignatureOf({ colors: [], sizes: [] });
  const { colors, sizes } = scan.tokenCounts;
  // 名前の集合は scan に載っていないので件数 + 出所で代用する。**名前まで見るより弱い**
  // (同数のまま中身が入れ替わった編集を見逃す) が、v1 の供給元はページのテーマだけで、
  // テーマが変われば要素数か件数のどちらかは動く。#13 で貼り付けを戻すときに名前へ寄せる
  const src = scan.tokenSources;
  const detail = src
    ? `p${src.pasted.colors}/${src.pasted.sizes}:t${src.theme.colors}/${src.theme.sizes}`
    : 'unknown';
  return `counts c${colors} s${sizes} ${detail}`;
}

// ---- 描画 ------------------------------------------------------------------

/** 経過時間を粗く言う。**秒まで出さない** — 精度を装うと再計測の判断を誤らせる */
function formatAge(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return msg('panelAgeJustNow');
  if (minutes < 60) return msg('panelAgeMinutes').replace('{n}', String(minutes));
  return msg('panelAgeHours').replace('{n}', String(Math.floor(minutes / 60)));
}

function render() {
  const state = derivePanelState({
    target,
    measurement,
    tokenSignature: signatureOfScan(lastScan),
  });

  // ---- ① 対象と鮮度 ----
  const nameEl = $('targetName');
  nameEl.textContent =
    target.origin ?? (target.tabId === null ? msg('panelNoTarget') : msg('panelUnknownName'));

  const hasResult = !!lastScan && !!measurement;
  for (const id of ['targetSep', 'targetAge', 'targetSep2', 'targetElements']) {
    $(id).hidden = !hasResult;
  }
  if (hasResult && measurement && lastScan) {
    $('targetAge').textContent = formatAge(Date.now() - measurement.at);
    $('targetElements').textContent = msg('panelElements').replace(
      '{n}',
      lastScan.elementCount.toLocaleString(),
    );
  }

  // ---- ② バナー (対象が読めない / 古い / 失敗した) ----
  const banner = $('banner');
  const bannerText = bannerFor(state.freshness, state.availability);
  banner.hidden = !bannerText;
  banner.textContent = bannerText ?? '';
  banner.classList.toggle('warn', state.freshness !== 'none' && state.freshness !== 'fresh');

  // ---- 結果 ----
  const result = $('result');
  result.hidden = !hasResult;
  result.classList.toggle('stale', !state.trustNumbers);
  if (hasResult && lastScan) renderFacts(lastScan);

  const button = $<HTMLButtonElement>('measure');
  button.disabled = measuring || target.tabId === null;
  button.textContent = measuring ? msg('panelMeasuring') : msg('panelMeasure');
}

/**
 * バナー文言。**優先順位は「失敗 > 鮮度 > 対象不明」**。
 * 失敗を鮮度で上書きすると「押したのに何も言われない」になる。
 */
function bannerFor(
  freshness: ReturnType<typeof derivePanelState>['freshness'],
  availability: ReturnType<typeof derivePanelState>['availability'],
): string | null {
  if (lastFailure === 'timeout') return msg('panelFailTimeout');
  if (lastFailure === 'unreachable') return msg('panelFailUnreachable');
  if (lastFailure === 'empty') return msg('panelFailEmpty');
  if (freshness === 'stale-tab') return msg('panelStaleTab');
  if (freshness === 'stale-navigation') return msg('panelStaleNavigation');
  // **`stale-tokens` は v1 では構造的に起きない**ので文言を持たない。
  // v1 の辞書供給元はページのテーマ自動検出だけで、署名も計測結果から作るため、
  // 比較する 2 つの署名は同じスキャン由来 = 必ず一致する。到達しない分岐に文言を
  // 用意すると「あるのに出ないもの」を抱えることになる。トークン貼り付けを戻す
  // (issue #13) と辞書がスキャンと独立に変わるようになり、そこで初めて到達する。
  // 状態としては `src/panelState.ts` に残してある (テストも含めて #13 用の土台)
  // **理由を断定しない** (§6-2): パネルは activeTab を受けないので、
  // 「http(s) だが未許可」と「そもそも検査できないページ」を区別できない
  if (availability === 'unknown' && target.tabId !== null) return msg('panelTargetUnreadable');
  return null;
}

/** 空の要素を作って中身を差し替える (textContent 経由。innerHTML は使わない) */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const NOTE_LABEL: Record<BasisNote['id'], Parameters<typeof msg>[0]> = {
  truncated: 'panelNoteTruncated',
  noDict: 'panelNoteNoDict',
  themeInflates: 'panelNoteThemeInflates',
  cssInJs: 'panelNoteCssInJs',
  originBudget: 'panelNoteOriginBudget',
  originUnavailable: 'panelNoteOriginUnavailable',
};

const AFFECT_LABEL: Record<BasisAffects, Parameters<typeof msg>[0]> = {
  match: 'panelAffectMatch',
  durability: 'panelAffectDurability',
  grid: 'panelAffectGrid',
};

const FAMILY_LABEL: Record<string, Parameters<typeof msg>[0]> = {
  color: 'panelFamilyColor',
  spacing: 'panelFamilySpacing',
  radius: 'panelFamilyRadius',
  font: 'panelFamilyFont',
};

/**
 * 率を 1 つのセルとして描く。**率だけを描く経路をコードから消す** (§4-2):
 * 呼び出し側に数字の文字列を渡させず、`RateDisplay` を丸ごと受け取って
 * 「率 + 実数 (+ 低サンプルの印)」を必ず同じセルに出す。
 */
function rateCell(display: RateDisplay): HTMLTableCellElement {
  const cell = el('td', 'num');
  if (display.text === null) {
    // 判定できた件数が 0。**「0%」と書かない** — 測れていないことと悪いことは違う
    cell.append(el('span', 'none', msg('panelRateNone')));
    return cell;
  }
  const pct = el('span', 'pct', display.text);
  if (display.clamped) {
    // 丸めのクランプを開示する: 「本当に 99%」と「10000 件中 1 件外れ」を潰さない
    pct.title = msg('panelRateClamped');
  }
  cell.append(pct, el('span', 'counts', `(${display.hit}/${display.judged})`));
  if (display.lowSample) {
    const low = el('span', 'low', msg('panelLowSample'));
    low.title = msg('panelLowSampleHint');
    cell.append(low);
  }
  return cell;
}

/** ③〜⑦ を描く。率の材料はすべて `src/coverageView.ts` の純関数から取る */
function renderFacts(scan: DesignScan) {
  const report = scan.coverage;

  // ---- ③ この計測が何をカバーしているか (数字より上) ----
  const notes = buildBasisNotes(scan);
  const list = $('basisNotes');
  list.replaceChildren();
  $('basisBlock').hidden = notes.length === 0;
  for (const note of notes) {
    const item = el('li');
    const tags = el('span', 'tags');
    // **影響先を印で出す。** 但し書きは、それが制限する数字と一緒に旅する
    const affectNames = note.affects.map((a) => msg(AFFECT_LABEL[a]));
    for (const name of affectNames) tags.append(el('span', 'tag', name));
    const text = msg(NOTE_LABEL[note.id]);
    // 視覚的には gap で分かれるが、textContent は連結されるので読み上げでは
    // 「一致グリッドこのページは…」になる。AT には区切った 1 文として渡す
    tags.setAttribute('aria-hidden', 'true');
    item.setAttribute('aria-label', `${affectNames.join(' / ')}: ${text}`);
    item.append(tags, el('span', undefined, text));
    list.append(item);
  }

  // ---- ④ 一致 (2 つの分母) ----
  const rows = $('familyRows');
  rows.replaceChildren();
  for (const family of report.families) {
    const row = el('tr');
    const label = msg(FAMILY_LABEL[family.family] ?? 'panelFamilyColor');
    row.append(el('td', undefined, label), rateCell(elementRate(family)), rateCell(vocabularyRate(family)));
    rows.append(row);
  }
  $('matchLegend').textContent = msg('panelMatchLegend').replace('{grid}', String(scan.grid));

  // ---- ⑤ 総合 (小さく) ----
  const overall = $('overall');
  overall.replaceChildren();
  const overallRate = elementRate({
    ...report.families[0],
    hit: report.overall.hit,
    judged: report.overall.judged,
  });
  overall.append(
    el('span', undefined, `${msg('panelOverall')} `),
    el('b', undefined, overallRate.text ?? msg('panelRateNone')),
    el('span', undefined, ` (${report.overall.hit}/${report.overall.judged}) — ${msg('panelOverallNote')}`),
  );

  // ---- ⑥ 直すと効く値 ----
  const offenders = $('offenders');
  offenders.replaceChildren();
  const emptyOffenders = offenderEmptyState(report);
  if (emptyOffenders) {
    offenders.append(
      el(
        'li',
        'empty',
        msg(emptyOffenders === 'nothingJudged' ? 'panelNothingJudged' : 'panelNoOffenders'),
      ),
    );
  } else {
    for (const offender of report.top) {
      const item = el('li');
      const what = el('span', 'what');
      what.append(el('span', undefined, `${offender.label} `), el('code', undefined, offender.value));
      if (offender.nearest) {
        what.append(el('span', 'near', msg('panelNearest').replace('{token}', offender.nearest)));
      }
      // **count は「修正箇所数」ではない** (1 つの CSS 宣言が N 要素に効く) ので
      // 「N 箇所直す」とは言わず、使われている要素数として出す
      item.append(what, el('span', 'count', msg('panelUsedBy').replace('{n}', String(offender.count))));
      offenders.append(item);
    }
  }

  // グリッド検査の空状態も無言にしない (良い知らせと未計測を区別する)
  const grid = gridEmptyState(report);
  if (grid) {
    offenders.append(
      el(
        'li',
        'empty',
        msg(grid === 'noSpacingMeasured' ? 'panelNoSpacing' : 'panelAllOnGrid').replace(
          '{grid}',
          String(scan.grid),
        ),
      ),
    );
  }
}

// ---- 配線 ------------------------------------------------------------------

/**
 * 対象タブを解決する。**`tab.url` が読めないことは異常ではない** — パネルは
 * タブ切替のたびに invocation を受けないので、host permission の無いタブでは
 * Chrome が url を落とす。読めないなら origin は null のままにする (§6-2)。
 */
async function resolveTarget() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id ?? null;
    let origin: string | null = null;
    if (tab?.url) {
      try {
        origin = new URL(tab.url).origin;
      } catch {
        origin = null;
      }
    }
    // 引き継ぎ条件の判断は純関数へ (UI 層に埋めると検査できない)
    const documentKey = carryDocumentKey({ tabId, measurement, navigatedTabs });
    target = { tabId, origin, documentKey };
  } catch {
    target = { tabId: null, origin: null, documentKey: null };
  }
  render();
}

async function measure() {
  const tabId = target.tabId;
  if (measuring || tabId === null) return;
  measuring = true;
  lastFailure = null;
  render();

  const outcome = await requestScan(tabId, (id, message, options) =>
    browser.tabs.sendMessage(id, message, options),
  );
  measuring = false;

  if (!outcome.ok) {
    lastFailure = outcome.reason;
    render();
    return;
  }
  lastScan = outcome.scan;
  navigatedTabs.delete(tabId);
  target = { ...target, documentKey: outcome.documentKey };
  measurement = {
    tabId,
    documentKey: outcome.documentKey,
    tokenSignature: signatureOfScan(outcome.scan),
    at: Date.now(),
  };
  render();
}

applyI18n();
$('measure').addEventListener('click', () => void measure());

void resolveTarget();
// タブ切替とページ遷移で対象を引き直す。**url を読む必要は無い** —
// 「変わった」ことだけ分かれば、鮮度の判定は panelState が行う
browser.tabs.onActivated.addListener(() => void resolveTarget());
/**
 * 経過時間を定期的に描き直す。**パネルの存在理由が「この数字がいつのものか」の明示**
 * なのに、再描画の契機が操作しか無いと「たった今」が何十分も貼り付いたままになる。
 * 30 秒間隔にしているのは、表示の粒度が分単位だから (それ以上細かく回す意味が無い)。
 */
setInterval(() => {
  if (measurement) render();
}, 30_000);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // **見ていないタブの遷移も記録する。** 計測したタブが裏で遷移したのに、
  // 戻ってきたとき fresh に見えるのが一番危ない (別ページの率を新鮮な顔で出す)
  if (changeInfo.status === 'loading') navigatedTabs.add(tabId);
  if (tabId !== target.tabId && tabId !== measurement?.tabId) return;
  void resolveTarget();
});
