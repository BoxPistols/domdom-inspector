import { DEFAULT_SETTINGS, type PathMapping, type Settings } from '../../src/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
    cmds.find((c) => c.name === name)?.shortcut || '(unset)';
  const rec = (recordKeyEl.value || 'r').toUpperCase();
  $('hintInspect').textContent = t('popupToggleInspectHint').replace(
    '{key}',
    shortcutOf('toggle-inspect'),
  );
  $('hintRender').textContent = t('popupToggleRenderHint')
    .replace('{key}', shortcutOf('toggle-render'))
    .replace('{rec}', rec);
}

function parseMappings(text: string): PathMapping[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return { from: line.slice(0, index), to: line.slice(index + 1) };
    });
}

async function load() {
  const stored = await browser.storage.local.get('settings');
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
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
    // 単一キーのみ (空・複数は既定 'r')
    recordKey: recordKeyEl.value.length === 1 ? recordKeyEl.value.toLowerCase() : DEFAULT_SETTINGS.recordKey,
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
    status.textContent = 'このページ (http/https 以外、または URL 不明) では有効化できません。';
  } else {
    btn.disabled = false;
    status.textContent = `対象: ${siteOrigin}`;
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
  } catch (e) {
    status.textContent = `許可要求エラー: ${String(e)}`;
    return;
  }
  if (!granted) {
    status.textContent = '許可されませんでした。';
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
  } catch (e) {
    status.textContent = `注入エラー: ${String(e)} — ページをリロードしてお試しください`;
    return;
  }
  status.textContent = `${origin} を有効化しました。インスペクトを ON にできます。`;
}

$('enableSite').addEventListener('click', () => void enableCurrentSite());
void detectSite();

// モード切替 (Alt+Shift+I / Alt+Shift+R) の再割当は Chrome 純正ページに委ねる
// (拡張からショートカットを直接書き換える API は存在しないため)
$('configureShortcuts').addEventListener('click', () => {
  void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

applyI18n();
void load();
