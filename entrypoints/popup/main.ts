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
  const ja = browser.i18n.getUILanguage().toLowerCase().startsWith('ja');
  for (const el of document.querySelectorAll<HTMLElement>('[data-help]')) {
    el.hidden = el.dataset.help !== (ja ? 'ja' : 'en');
  }
  document.documentElement.lang = ja ? 'ja' : 'en';
}

const editorEl = $<HTMLSelectElement>('editor');
const templateEl = $<HTMLInputElement>('customUrlTemplate');
const muiSkipEl = $<HTMLInputElement>('muiSkip');
const mappingsEl = $<HTMLTextAreaElement>('pathMappings');

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
  mappingsEl.value = settings.pathMappings.map((m) => `${m.from}=${m.to}`).join('\n');
  syncTemplateState();
}

async function save() {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    editor: editorEl.value as Settings['editor'],
    customUrlTemplate: templateEl.value || DEFAULT_SETTINGS.customUrlTemplate,
    muiSkip: muiSkipEl.checked,
    pathMappings: parseMappings(mappingsEl.value),
  };
  await browser.storage.local.set({ settings });
}

// カスタム URL テンプレートは editor === 'custom' の時だけ編集可能
function syncTemplateState() {
  templateEl.disabled = editorEl.value !== 'custom';
}

for (const el of [editorEl, templateEl, muiSkipEl, mappingsEl]) {
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

applyI18n();
void load();
