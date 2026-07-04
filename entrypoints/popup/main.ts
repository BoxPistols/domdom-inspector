import { DEFAULT_SETTINGS, type PathMapping, type Settings } from '../../src/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

for (const el of [editorEl, templateEl, muiSkipEl, mappingsEl]) {
  el.addEventListener('change', () => void save());
}

$('toggle').addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) {
    browser.tabs.sendMessage(tab.id, { type: 'toggle-inspect' }).catch(() => {});
  }
  window.close();
});

void load();
