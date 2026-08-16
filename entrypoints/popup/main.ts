// v1 の popup は「入口 (権限・モード) + トークン貼り付け + エディタ設定」に絞る。
// トークンカバレッジ計測 / AI デザイン監査 / 表示設定は v1 の配線から外した (実装は温存):
//   - カバレッジ: https://github.com/BoxPistols/domdom-inspector/issues/10 (side panel として再導入)
//   - AI 監査:    https://github.com/BoxPistols/domdom-inspector/issues/11
//   - 表示設定:   https://github.com/BoxPistols/domdom-inspector/issues/12 (計測条件として率の隣へ)
import { parseMappings, serializeMappings } from '../../src/mappings';
import { DEFAULT_SETTINGS, type Settings } from '../../src/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const msg = (key: Parameters<typeof browser.i18n.getMessage>[0]) => browser.i18n.getMessage(key) || '';

// data-i18n を持つ要素の textContent を _locales から流し込み、
// ヘルプは UI 言語に合わせて日本語/英語のどちらかだけ表示する。
function applyI18n() {
  type MsgKey = Parameters<typeof browser.i18n.getMessage>[0];
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n;
    const msg = key && browser.i18n.getMessage(key as MsgKey);
    if (msg) el.textContent = msg;
  }
  // data-i18n-title → title 属性 (ツールチップ)
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle;
    const msg = key && browser.i18n.getMessage(key as MsgKey);
    if (msg) el.title = msg;
  }
  const ja = browser.i18n.getUILanguage().toLowerCase().startsWith('ja');
  for (const el of document.querySelectorAll<HTMLElement>('[data-help]')) {
    el.hidden = el.dataset.help !== (ja ? 'ja' : 'en');
  }
  document.documentElement.lang = ja ? 'ja' : 'en';
}

// 職域スイッチ (designer/engineer) は機能差が無いため除去済みの単一モード
// (Settings.role 型は dormant で温存)。render/tree は **v1 の配線から外してある**
// (実装温存 — issue #4/#5。「再配線済み」と書いてあった旧コメントは v0.4 以前の断面)。
// 表示設定 (badgeDetail / showVarNames / autoTheme) の UI は v1 で外した (issue #12)。
// Settings の値は既定のまま効き続けるので、動作は変わらない
const editorEl = $<HTMLSelectElement>('editor');
const customTemplateRowEl = $<HTMLElement>('customTemplateRow');
const customTemplateEl = $<HTMLInputElement>('customTemplate');
const pathMappingsEl = $<HTMLTextAreaElement>('pathMappings');
const sourceAttrEl = $<HTMLInputElement>('sourceAttr');

// 版数を見出しに出す。**同期フォルダ経由で配っているため、⟳ が効いたのか古いビルドを
// 見ているのかを利用者が判別できる必要がある** (拡張管理ページを開かずに済ませる)。
// manifest が正 (package.json の version を WXT が反映する)
$('version').textContent = `v${browser.runtime.getManifest().version}`;

// モード切替の実バインドを Chrome から取得して表示。commands.getAll() の shortcut は
// OS 表記でレンダリングされる (Mac は ⌥⇧I、Windows は Alt+Shift+I) ため、そのまま OS 最適化される。
async function applyShortcutHints() {
  type MsgKey = Parameters<typeof browser.i18n.getMessage>[0];
  const t = (k: MsgKey) => browser.i18n.getMessage(k) || '';
  const cmds = await browser.commands.getAll();
  const shortcutOf = (name: string) =>
    cmds.find((c) => c.name === name)?.shortcut || t('shortcutUnset');
  $('hintInspect').textContent = t('popupToggleInspectHint').replace(
    '{key}',
    shortcutOf('toggle-inspect'),
  );
}

// トークン JSON 貼り付けは v1 の配線から外した (issue #13)。
// 照合辞書は MUI テーマ自動検出 (src/muiTheme.ts → tokenDict.parseMuiTheme) だけが供給する。
// parseTokens (Figma / W3C / Tokens Studio の判別) は温存 = 再導入時にそのまま使える。

// 「開発者向け」折りたたみの開閉状態を保持 (エンジニアは開きっぱなしにできる)
const devSectionEl = $<HTMLElement>('devSection') as HTMLDetailsElement;
devSectionEl.addEventListener('toggle', () => {
  void browser.storage.local.set({ popupDevOpen: devSectionEl.open });
});

/**
 * 検査したページから検出したプロジェクトのルート候補を出す。
 *
 * 拡張はディスクを見られないので、正解は分からない。**候補として出し、押したら
 * 対応表に 1 行入れるところまで**をやる (パスが本当に正しいかは利用者が確かめる)。
 * 文字列の出所はページなので、ここを経由せず自動で設定へ入れてはいけない。
 */
async function renderRootCandidates() {
  const box = $<HTMLElement>('rootCandidates');
  const list = $<HTMLElement>('rootList');
  list.replaceChildren();
  // **アクティブタブの URL に依存しない。** tabs.query は権限が無いと url を伏せるため、
  // それを前提にすると「候補はあるのに出ない」が起きる (実機の検証で踏んだ)。
  // 保存済みの `roots:<host>` を列挙する
  const all = await browser.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([k, v]) => k.startsWith('roots:') && Array.isArray(v) && v.length)
    .slice(0, 4) as [string, string[]][];
  if (!entries.length) return;
  for (const [key, roots] of entries) {
    const host = key.slice('roots:'.length);
    for (const root of roots.slice(0, 3)) {
      const line = `/src=${root}/src @ ${host}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = line;
      btn.addEventListener('click', () => {
        const cur = pathMappingsEl.value.trim();
        // 既に同じ行があれば増やさない (押すたびに重複させない)
        if (!cur.split('\n').some((l) => l.trim() === line)) {
          pathMappingsEl.value = cur ? `${cur}\n${line}` : line;
        }
        void save();
      });
      list.append(btn);
    }
  }
  box.hidden = false;
}

async function load() {
  const stored = await browser.storage.local.get('settings');
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
  const { popupDevOpen } = await browser.storage.local.get('popupDevOpen');
  devSectionEl.open = popupDevOpen === true;
  editorEl.value = settings.editor;
  customTemplateEl.value = settings.customUrlTemplate;
  // 保存形は PathMapping[]。編集は 1 行 1 件のテキストで行う (parseMappings と対)
  pathMappingsEl.value = serializeMappings(settings.pathMappings);
  sourceAttrEl.value = settings.sourceAttr;
  syncEditorRows();
  void applyShortcutHints();
}

/** editor=custom のときだけ URL テンプレート欄を出す (選べない設定を見せない) */
function syncEditorRows() {
  customTemplateRowEl.hidden = editorEl.value !== 'custom';
}

async function save() {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    editor: editorEl.value as Settings['editor'],
    // 空なら既定に戻す (空テンプレートを保存するとジャンプが無言で壊れる)
    customUrlTemplate: customTemplateEl.value.trim() || DEFAULT_SETTINGS.customUrlTemplate,
    pathMappings: parseMappings(pathMappingsEl.value),
    sourceAttr: sourceAttrEl.value.trim(),
  };
  await browser.storage.local.set({ settings });
  void applyShortcutHints();
}

for (const el of [editorEl, customTemplateEl, pathMappingsEl, sourceAttrEl]) {
  el.addEventListener('change', () => {
    // エディタ種別を変えたら URL テンプレート欄の出し入れを即反映する
    // (選べない設定を見せない / custom を選んだのに入力欄が無い、を作らない)
    syncEditorRows();
    void save();
  });
}

async function sendToActiveTab(type: string) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (tabId != null) {
    // **トグルはトップフレームだけに送る** (issue #14)。全フレームに送ると各フレームが
    // 独立に反転して逆位相を作る。結果の状態は background が全フレームへ配る。
    // 入っていなければ従来どおり全フレームへ (iframe 側だけが対象オリジンのケース)
    browser.tabs
      .sendMessage(tabId, { type }, { frameId: 0 })
      .catch(() => browser.tabs.sendMessage(tabId, { type }).catch(() => {}));
  }
  window.close();
}

$('toggle').addEventListener('click', () => void sendToActiveTab('toggle-inspect'));

/**
 * カバレッジのパネルを開く (issue #10)。
 *
 * **`await` を一切挟まずに `sidePanel.open()` を呼ぶ。** これは `permissions.request` と
 * 同じ user gesture の規律で、await を跨ぐと gesture が失効して**無言で拒否される**
 * (handoff_notes.md が「崩すと権限フローが無言で死ぬ」と警告している領域)。
 * よって tabId は click 時点で既に手元にある `siteTabId` を使い、tabs.query しない。
 *
 * `window.close()` は呼ばない。パネルが開けばフォーカスが移って popup は閉じるので、
 * 呼び出し元フレームの破棄と IPC を競合させる理由が無い (実機で挙動を確認する)。
 */
$('openPanel').addEventListener('click', () => {
  const showFailure = () => {
    // **黙って終わらせない。** 押したのに何も起きないのが一番わかりにくい壊れ方
    const notice = $('modeUnavailable');
    notice.hidden = false;
    notice.textContent = msg('panelOpenFailed');
  };
  // 対象タブが解決できていない = 開く先が無い。理由を言ってから降りる
  if (siteTabId === null) {
    showFailure();
    return;
  }
  // 失敗しても popup を閉じない = 理由を出せる状態のまま残す。
  // **専用の文言を使う。** 以前はここで「インスペクタが動いていません。有効化して
  // 再読み込みしてください」を流用していたが、パネルが開けなかった理由はそれではない
  // (理由が嘘になる類型 — commit 459db69 で一度潰したもの)
  void browser.sidePanel.open({ tabId: siteTabId }).catch(showFailure);
});

// 任意オリジン (デプロイ済み App) をユーザー明示許可で有効化 (M1)。
// 重要: permissions.request はユーザー操作直後 (await を挟まず) に呼ぶ必要があるため、
// origin/tabId はポップアップ表示時に先読みしておく。
let siteOrigin: string | null = null;
let siteTabId: number | null = null;
// blob: top-level タブ (新規タブで開いたプレビュー等) は registerContentScripts 不可。
// executeScript のみで注入する専用パスを使う。
let isBlobTab = false;
/**
 * URL がまったく読めないタブ (Chrome が blob: 等をスクラブして tab.url を返さない場合)。
 * **「http/https でない」と断定してはいけない** — 読めないだけで注入は成功しうる。
 * 全サイト許可がある場合のみ「試す」導線に倒す (拒否ではなく試行 + 結果の明示)。
 */
let isUnknownUrlTab = false;

// blob:https://example.com/uuid 形式を含む URL が executeScript 可能か判定
function canInjectUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (/^https?:$/.test(url.protocol)) return true;
    if (url.protocol === 'blob:') return /^https?:$/.test(new URL(url.pathname).protocol);
  } catch { /* ignore */ }
  return false;
}

/**
 * このタブで機能が動く条件が揃っているかを反映する。
 * **動かない機能は disabled にし、理由を書く** — 押せるのに何も起きないのが一番わかりにくい。
 * 判定材料: http(s) のページか / localhost か (静的注入) / このオリジンが許可済みか。
 */
async function applyAvailability(origin: string | null, injectable = false) {
  const notice = $('modeUnavailable');
  const toggleBtn = $<HTMLButtonElement>('toggle');

  let available = false;
  // 注入を試せるタブ (URL が読めないだけ) は「検査できない」ではなく「まだ有効化していない」。
  // 理由を取り違えると、上のボタンで解決できるのに諦めさせてしまう
  let reason: 'ok' | 'notEnabled' | 'notInspectable' = injectable
    ? 'notEnabled'
    : 'notInspectable';
  if (origin) {
    // localhost / 127.0.0.1 は静的 content script の対象なので許可不要
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (isLocal) {
      available = true;
      reason = 'ok';
    } else {
      let granted = allSitesGranted;
      if (!granted) {
        try {
          granted = await browser.permissions.contains({ origins: [`${origin}/*`] });
        } catch {
          granted = false;
        }
      }
      available = granted;
      reason = granted ? 'ok' : 'notEnabled';
    }
  }

  toggleBtn.disabled = !available;
  // **カバレッジのパネルも同じ規律で閉じる** (issue #10 §6-7)。計測できないページで
  // 押せてしまうと、パネルが開いてから「読めません」と言う二度手間になる。
  // commit 459db69 の「押せるのに無反応が一番わかりにくい」を移設先でも守る
  $<HTMLButtonElement>('openPanel').disabled = !available;
  notice.hidden = available;
  if (!available) {
    notice.textContent = msg(reason === 'notEnabled' ? 'modeNotEnabledHere' : 'modeNotInspectable');
  }
}

async function detectSite() {
  const status = $('siteStatus');
  const btn = $<HTMLButtonElement>('enableSite');
  isBlobTab = false;
  isUnknownUrlTab = false;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    siteTabId = tab?.id ?? null;
    // Chrome は blob: トップレベルタブ等で url / pendingUrl を返さないことがある。
    // その場合「URL 不明」であって「http/https でない」ではない
    const raw = tab?.url || tab?.pendingUrl || '';
    isUnknownUrlTab = !raw && siteTabId != null;
    const url = raw ? new URL(raw) : null;
    if (url?.protocol === 'blob:') {
      // blob:https://origin/uuid → pathname が親 URL
      try {
        const parentUrl = new URL(url.pathname);
        if (/^https?:$/.test(parentUrl.protocol)) {
          isBlobTab = true;
          siteOrigin = parentUrl.origin;
        } else {
          siteOrigin = null;
        }
      } catch {
        siteOrigin = null;
      }
    } else {
      siteOrigin = url && /^https?:$/.test(url.protocol) ? url.origin : null;
    }
  } catch {
    siteOrigin = null;
  }

  if (isBlobTab && siteOrigin != null && siteTabId != null) {
    // blob タブは allSitesGranted がないと executeScript できない。
    // **理由を取り違えない**: 「http/https 以外だから不可」ではなく「全サイト許可があれば
    // 使える」— 誤った理由は直下のボタンで解決できることから利用者を遠ざける
    btn.disabled = !allSitesGranted;
    status.textContent = allSitesGranted
      ? msg('siteTarget').replace('{origin}', `blob: (${siteOrigin})`)
      : msg('siteBlobNeedsAllSites');
  } else if (isUnknownUrlTab && allSitesGranted) {
    // URL が読めないので許可の要求先が決められない。全サイト許可済みなら注入だけ試せる
    btn.disabled = false;
    status.textContent = msg('siteUnknownUrl');
  } else if (!siteOrigin || siteTabId == null) {
    btn.disabled = true;
    status.textContent = msg('siteUnavailable');
  } else {
    btn.disabled = false;
    status.textContent = msg('siteTarget').replace('{origin}', siteOrigin);
  }
  await applyAvailability(siteOrigin, isUnknownUrlTab && allSitesGranted);
}

async function enableCurrentSite() {
  const status = $('siteStatus');
  // URL が読めないタブ (blob: 等をスクラブされた場合) は origin が無くても注入を試せる。
  // 全サイト許可済みが前提。**拒否ではなく試行 + 結果の明示**にする
  if (isUnknownUrlTab && allSitesGranted && siteTabId != null) {
    const tabId = siteTabId;
    try {
      await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['/content-scripts/bridge.js'],
      });
      await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['/content-scripts/inspector.js'],
        world: 'MAIN',
      });
    } catch {
      // 本当に注入できないページだった (chrome:// 等)。理由を出して閉じない
      status.textContent = msg('injectError');
      return;
    }
    browser.tabs.sendMessage(tabId, { type: 'inspect-on' }).catch(() => {});
    window.close();
    return;
  }
  if (!siteOrigin || siteTabId == null) return;
  const tabId = siteTabId;

  if (isBlobTab) {
    // blob: top-level タブ: Chrome は blob: scheme を content script match に登録不可。
    // allSitesGranted 前提で executeScript のみで即時注入する (永続登録なし = タブ固有)。
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/bridge.js'],
      });
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/inspector.js'],
        world: 'MAIN',
      });
    } catch {
      status.textContent = msg('injectError');
      return;
    }
    browser.tabs.sendMessage(tabId, { type: 'inspect-on' }).catch(() => {});
    window.close();
    return;
  }

  const origin = siteOrigin;
  const pattern = `${origin}/*`;
  // await を挟まず即 request (ユーザー操作コンテキストを保つ)
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [pattern] });
  } catch {
    // request の例外はほぼ gesture 失効 — 生例外ではなく対処可能な定型案内を出す
    status.textContent = msg('permError');
    return;
  }
  if (!granted) {
    status.textContent = msg('permDenied');
    return;
  }
  const key = origin.replace(/[^a-z0-9]/gi, '_');
  // 次回以降のロード用に永続登録 (document_start でフック確立)
  try {
    await browser.scripting.registerContentScripts([
      {
        id: `dyn_bridge_${key}`,
        matches: [pattern],
        js: ['content-scripts/bridge.js'],
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
      {
        id: `dyn_inspector_${key}`,
        matches: [pattern],
        js: ['content-scripts/inspector.js'],
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
    ]);
  } catch {
    // 既に登録済みのオリジンは無視 (再有効化)
  }
  // 現在のタブには即注入 = リロード不要でその場で有効化 (一発 ON)。
  // production では document_start 前でなくても __reactFiber$ + computed style を
  // 読めるので動作する (再初期化はガードで防止)。
  try {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['/content-scripts/bridge.js'],
    });
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['/content-scripts/inspector.js'],
      world: 'MAIN',
    });
  } catch {
    status.textContent = msg('injectError');
    return;
  }
  // 有効化直後にインスペクトを冪等 ON (inspect-on は既に ON なら何もしない)。
  // ページ側のトーストが即時フィードバックになり「押しても何も起きない」を防ぐ。
  browser.tabs.sendMessage(tabId, { type: 'inspect-on' }).catch(() => {});
  window.close();
}

$('enableSite').addEventListener('click', () => void enableCurrentSite());
// blob タブのボタン有効化は allSitesGranted に依存するため refreshAllSites 後に呼ぶ

// 全サイト一度だけ許可モード (toggle: 許可 ⇔ 解除)。デザイナーが都度許可なしで
// どのデプロイ済みサイトでも使えるようにする。安全性の根拠は SECURITY.md。
const ALL_ORIGINS = { origins: ['*://*/*'] };
let allSitesGranted = false;

async function refreshAllSites() {
  try {
    allSitesGranted = await browser.permissions.contains(ALL_ORIGINS);
  } catch {
    allSitesGranted = false;
  }
  $('enableAll').textContent = allSitesGranted ? msg('btnAllSitesOff') : msg('btnAllSitesOn');
}

async function toggleAllSites() {
  const status = $('siteStatus');
  if (allSitesGranted) {
    // 解除 (gesture 不要)
    await browser.scripting
      .unregisterContentScripts({ ids: ['all_bridge', 'all_inspector'] })
      .catch(() => {});
    await browser.permissions.remove(ALL_ORIGINS).catch(() => {});
    status.textContent = msg('allSitesRevoked');
    await refreshAllSites();
    return;
  }
  // 未許可 → gesture 内で即 request (前に await を挟まない)
  let ok = false;
  try {
    ok = await browser.permissions.request(ALL_ORIGINS);
  } catch {
    // request の例外はほぼ gesture 失効 — 生例外ではなく対処可能な定型案内を出す
    status.textContent = msg('permError');
    return;
  }
  if (!ok) {
    status.textContent = msg('permDenied');
    return;
  }
  try {
    await browser.scripting.registerContentScripts([
      {
        id: 'all_bridge',
        matches: ['*://*/*'],
        js: ['content-scripts/bridge.js'],
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
      {
        id: 'all_inspector',
        matches: ['*://*/*'],
        js: ['content-scripts/inspector.js'],
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
    ]);
  } catch {
    // 既に登録済みは無視
  }
  // 現タブへ即注入 (リロード不要)。blob: top-level タブも canInjectUrl で拾う
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null && tab.url && canInjectUrl(tab.url)) {
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['/content-scripts/bridge.js'] });
      await browser.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['/content-scripts/inspector.js'],
        world: 'MAIN',
      });
      // 現タブで即使えるので、インスペクトを冪等 ON にして閉じる (enableCurrentSite と同じ導線)
      browser.tabs.sendMessage(tab.id, { type: 'inspect-on' }).catch(() => {});
      window.close();
      return;
    } catch {
      // 注入不可 (chrome:// 等) は無視してステータス表示にフォールバック
    }
  }
  status.textContent = msg('allSitesEnabled');
  await refreshAllSites();
}

$('enableAll').addEventListener('click', () => void toggleAllSites());
void refreshAllSites()
  .then(() => detectSite())
  // 候補の提示は検査したページの host に紐づく (detectSite で siteOrigin が決まる)
  .then(() => renderRootCandidates())
  .catch(() => {
    // 候補が出せなくても本体機能には影響しない
  });

// モード切替 (Alt+Shift+I / Alt+Shift+R) の再割当は Chrome 純正ページに委ねる
// (拡張からショートカットを直接書き換える API は存在しないため)
$('configureShortcuts').addEventListener('click', () => {
  void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

applyI18n();
void load();
