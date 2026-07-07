import { parseMappings } from '../../src/mappings';
import { normalizeRecordKey } from '../../src/recordKey';
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

const editorEl = $<HTMLSelectElement>('editor');
const templateEl = $<HTMLInputElement>('customUrlTemplate');
const muiSkipEl = $<HTMLInputElement>('muiSkip');
const openEditorEl = $<HTMLInputElement>('openEditorOnClick');
const badgeDetailEl = $<HTMLSelectElement>('badgeDetail');
const mappingsEl = $<HTMLTextAreaElement>('pathMappings');
const recordKeyEl = $<HTMLInputElement>('recordKey');

// モード切替の実バインドを Chrome から取得して表示。commands.getAll() の shortcut は
// OS 表記でレンダリングされる (Mac は ⌥⇧I、Windows は Alt+Shift+I) ため、そのまま OS 最適化される。
async function applyShortcutHints() {
  type MsgKey = Parameters<typeof browser.i18n.getMessage>[0];
  const t = (k: MsgKey) => browser.i18n.getMessage(k) || '';
  const cmds = await browser.commands.getAll();
  const shortcutOf = (name: string) =>
    cmds.find((c) => c.name === name)?.shortcut || t('shortcutUnset');
  const rec = (recordKeyEl.value || 'r').toUpperCase();
  $('hintInspect').textContent = t('popupToggleInspectHint').replace(
    '{key}',
    shortcutOf('toggle-inspect'),
  );
  $('hintTree').textContent = t('popupToggleTreeHint').replace(
    '{key}',
    shortcutOf('toggle-tree'),
  );
  $('hintRender').textContent = t('popupToggleRenderHint')
    .replace('{key}', shortcutOf('toggle-render'))
    .replace('{rec}', rec);
}

// 「開発者向け」折りたたみの開閉状態を保持 (エンジニアは開きっぱなしにできる)
const devSectionEl = $<HTMLElement>('devSection') as HTMLDetailsElement;
devSectionEl.addEventListener('toggle', () => {
  void browser.storage.local.set({ popupDevOpen: devSectionEl.open });
});

async function load() {
  const stored = await browser.storage.local.get('settings');
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
  const { popupDevOpen } = await browser.storage.local.get('popupDevOpen');
  devSectionEl.open = popupDevOpen === true;
  editorEl.value = settings.editor;
  templateEl.value = settings.customUrlTemplate;
  muiSkipEl.checked = settings.muiSkip;
  openEditorEl.checked = settings.openEditorOnClick;
  badgeDetailEl.value = settings.badgeDetail;
  mappingsEl.value = settings.pathMappings.map((m) => `${m.from}=${m.to}`).join('\n');
  recordKeyEl.value = settings.recordKey;
  syncTemplateState();
  void applyShortcutHints();
}

async function save() {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    editor: editorEl.value as Settings['editor'],
    customUrlTemplate: templateEl.value || DEFAULT_SETTINGS.customUrlTemplate,
    muiSkip: muiSkipEl.checked,
    openEditorOnClick: openEditorEl.checked,
    badgeDetail: badgeDetailEl.value as Settings['badgeDetail'],
    pathMappings: parseMappings(mappingsEl.value),
    // 単一キーのみ (空・複数は既定へフォールバック)
    recordKey: normalizeRecordKey(recordKeyEl.value, DEFAULT_SETTINGS.recordKey),
  };
  await browser.storage.local.set({ settings });
  void applyShortcutHints();
}

// カスタム URL テンプレートは editor === 'custom' の時だけ編集可能
function syncTemplateState() {
  templateEl.disabled = editorEl.value !== 'custom';
}

for (const el of [editorEl, templateEl, muiSkipEl, openEditorEl, badgeDetailEl, mappingsEl, recordKeyEl]) {
  el.addEventListener('change', () => {
    syncTemplateState();
    void save();
  });
}

async function sendToActiveTab(type: string) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) {
    browser.tabs.sendMessage(tab.id, { type }).catch(() => {});
  }
  window.close();
}

$('toggle').addEventListener('click', () => void sendToActiveTab('toggle-inspect'));
$('toggleTree').addEventListener('click', () => void sendToActiveTab('toggle-tree'));
$('toggleRender').addEventListener('click', () => void sendToActiveTab('toggle-render'));

// 任意オリジン (デプロイ済み App) をユーザー明示許可で有効化 (M1)。
// 重要: permissions.request はユーザー操作直後 (await を挟まず) に呼ぶ必要があるため、
// origin/tabId はポップアップ表示時に先読みしておく。
let siteOrigin: string | null = null;
let siteTabId: number | null = null;

async function detectSite() {
  const status = $('siteStatus');
  const btn = $<HTMLButtonElement>('enableSite');
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    siteTabId = tab?.id ?? null;
    const url = tab?.url ? new URL(tab.url) : null;
    siteOrigin = url && /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    siteOrigin = null;
  }
  if (!siteOrigin || siteTabId == null) {
    btn.disabled = true;
    status.textContent = msg('siteUnavailable');
  } else {
    btn.disabled = false;
    status.textContent = msg('siteTarget').replace('{origin}', siteOrigin);
  }
}

async function enableCurrentSite() {
  const status = $('siteStatus');
  if (!siteOrigin || siteTabId == null) return;
  const origin = siteOrigin;
  const tabId = siteTabId;
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
      },
      {
        id: `dyn_inspector_${key}`,
        matches: [pattern],
        js: ['content-scripts/inspector.js'],
        world: 'MAIN',
        runAt: 'document_start',
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
  // 有効化直後にインスペクトを冪等 ON (inspect-on は既に ON なら何もしない)。
  // ページ側のトーストが即時フィードバックになり「押しても何も起きない」を防ぐ。
  browser.tabs.sendMessage(tabId, { type: 'inspect-on' }).catch(() => {});
  window.close();
}

$('enableSite').addEventListener('click', () => void enableCurrentSite());
void detectSite();

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
      { id: 'all_bridge', matches: ['*://*/*'], js: ['content-scripts/bridge.js'], runAt: 'document_start' },
      {
        id: 'all_inspector',
        matches: ['*://*/*'],
        js: ['content-scripts/inspector.js'],
        world: 'MAIN',
        runAt: 'document_start',
      },
    ]);
  } catch {
    // 既に登録済みは無視
  }
  // 現タブへ即注入 (リロード不要)
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null && tab.url && /^https?:$/.test(new URL(tab.url).protocol)) {
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/bridge.js'] });
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
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
void refreshAllSites();

// モード切替 (Alt+Shift+I / Alt+Shift+R) の再割当は Chrome 純正ページに委ねる
// (拡張からショートカットを直接書き換える API は存在しないため)
$('configureShortcuts').addEventListener('click', () => {
  void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

applyI18n();
void load();
