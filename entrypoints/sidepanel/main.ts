import type { DesignScan } from '../../src/designScan';
import {
  derivePanelState,
  tokenSignatureOf,
  type PanelMeasurement,
  type PanelTarget,
} from '../../src/panelState';
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
  if (freshness === 'stale-tokens') return msg('panelStaleTokens');
  // **理由を断定しない** (§6-2): パネルは activeTab を受けないので、
  // 「http(s) だが未許可」と「そもそも検査できないページ」を区別できない
  if (availability === 'unknown' && target.tabId !== null) return msg('panelTargetUnreadable');
  return null;
}

/** Phase A の暫定表示。率と内訳 (§4-1 ③〜⑦) は Phase C で入れる */
function renderFacts(scan: DesignScan) {
  $('factElements').textContent = scan.elementCount.toLocaleString();
  const { colors, sizes } = scan.tokenCounts;
  $('factTokens').textContent = msg('panelTokenCounts')
    .replace('{colors}', String(colors))
    .replace('{sizes}', String(sizes));

  // **計測が何をカバーしていないかを、数字より先に読ませる** (§4-1 ③)
  const notes: string[] = [];
  if (scan.truncated) notes.push(msg('panelNoteTruncated'));
  if (colors === 0 && sizes === 0) notes.push(msg('panelNoteNoDict'));
  $('factNotes').textContent = notes.join(' ');
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
    // タブが変わったら、前のページの世代は捨てる (残すと別ページを fresh に見せる)
    const documentKey = tabId === measurement?.tabId ? target.documentKey : null;
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
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== target.tabId) return;
  // loading = そのタブで新しい document が始まった。世代を捨てて stale へ倒す
  if (changeInfo.status === 'loading') {
    target = { ...target, documentKey: null };
  }
  void resolveTarget();
});
