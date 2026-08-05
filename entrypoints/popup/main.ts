import { AI_SESSION_CALL_LIMIT, estimateTokens } from '../../src/aiCost';
import { buildAuditPrompt, type AuditPrompt } from '../../src/aiPrompt';
import { AI_PROVIDERS, migrateModelId, type AiProviderId } from '../../src/aiProviders';
import { formatCoverageMarkdown, LOW_SAMPLE_THRESHOLD, ratePercent } from '../../src/coverage';
import type { DesignScan } from '../../src/designScan';
import { parseTokens, type TokenDict } from '../../src/tokenDict';
import { DEFAULT_GRID_PX } from '../../src/tokenLint';
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
// (Settings.role 型は dormant で温存)。render/tree は issue #4/#5 で再配線済み。
const badgeDetailEl = $<HTMLSelectElement>('badgeDetail');
const showVarNamesEl = $<HTMLInputElement>('showVarNames');
const autoThemeEl = $<HTMLInputElement>('autoTheme');
const editorEl = $<HTMLSelectElement>('editor');

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

// デザイントークン (Figma) の貼り付け → 解析 → storage 保存。
// bridge が storage 変更を検知して MAIN world のバッジ照合に即反映する。
const tokensEl = $<HTMLTextAreaElement>('tokensJson');
const tokensStatusEl = $('tokensStatus');
const tokensClearEl = $<HTMLButtonElement>('tokensClear');

function showTokensStatus(colors: number, sizes: number) {
  tokensStatusEl.textContent = msg('tokensStatus')
    .replace('{colors}', String(colors))
    .replace('{sizes}', String(sizes));
}

async function saveTokens() {
  const raw = tokensEl.value.trim();
  if (!raw) {
    await browser.storage.local.remove(['tokenDict', 'tokenJson']);
    tokensStatusEl.textContent = msg('tokensEmpty');
    tokensClearEl.hidden = true;
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    tokensStatusEl.textContent = msg('tokensError');
    return;
  }
  const dict = parseTokens(parsed);
  await browser.storage.local.set({ tokenDict: dict, tokenJson: raw });
  showTokensStatus(dict.colors.length, dict.sizes.length);
  tokensClearEl.hidden = false;
}

// change (blur/commit 時) に加え、input のデバウンス保存も行う。
// トークンは「1 回の長文貼り付け」が主操作で、フォーカスを残したまま
// ポップアップを閉じると change が発火せず保存漏れするため。
let tokensSaveTimer: ReturnType<typeof setTimeout> | undefined;
tokensEl.addEventListener('input', () => {
  clearTimeout(tokensSaveTimer);
  tokensSaveTimer = setTimeout(() => void saveTokens(), 400);
});
tokensEl.addEventListener('change', () => {
  clearTimeout(tokensSaveTimer);
  void saveTokens();
});
tokensClearEl.addEventListener('click', () => {
  clearTimeout(tokensSaveTimer);
  tokensEl.value = '';
  void saveTokens();
});

// ---- トークンカバレッジ (決定論・AI 不要) ----------------------------------
const coverageMeasureEl = $<HTMLButtonElement>('coverageMeasure');
const coverageStatusEl = $('coverageStatus');
const coverageResultEl = $('coverageResult');
const coverageScopeEl = $('coverageScope');
const coverageTruncatedEl = $('coverageTruncated');
const coverageFamiliesEl = $('coverageFamilies');
const coverageOverallEl = $('coverageOverall');
const coverageMeasurableEl = $('coverageMeasurable');
const coverageOriginEl = $('coverageOrigin');
const coverageOffGridEl = $('coverageOffGrid');
const coverageTopEl = $('coverageTop');
const coverageCopyEl = $<HTMLButtonElement>('coverageCopy');

const FAMILY_LABEL: Record<string, string> = {
  color: 'coverageFamilyColor',
  spacing: 'coverageFamilySpacing',
  radius: 'coverageFamilyRadius',
  font: 'coverageFamilyFont',
};

/** 直近のスキャン結果。AI セクションと共有して二重スキャンを避ける */
let lastScan: DesignScan | null = null;

function fillTemplate(key: Parameters<typeof msg>[0], vars: Record<string, string | number>): string {
  let s = msg(key);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderCoverage(scan: DesignScan) {
  const cov = scan.coverage;
  coverageResultEl.hidden = false;

  coverageScopeEl.textContent = fillTemplate('coverageScope', {
    elements: scan.elementCount,
    colors: scan.tokenCounts.colors,
    sizes: scan.tokenCounts.sizes,
  });
  coverageTruncatedEl.hidden = !scan.truncated;
  if (scan.truncated) {
    coverageTruncatedEl.textContent = fillTemplate('coverageTruncated', {
      shown: scan.elementCount,
      total: scan.candidateCount,
    });
  }

  // 辞書が空なら率を一切出さない (0% は「何にも準拠していない」と誤読される)
  const dictEmpty = scan.tokenCounts.colors === 0 && scan.tokenCounts.sizes === 0;
  coverageFamiliesEl.replaceChildren();
  if (dictEmpty) {
    coverageFamiliesEl.append(el('div', 'hint', msg('coverageEmptyDict')));
    coverageOverallEl.textContent = '';
    coverageMeasurableEl.textContent = '';
  } else {
    for (const f of cov.families) {
      const row = el('div', 'cov-row');
      row.append(el('span', 'cov-name', msg(FAMILY_LABEL[f.family] as Parameters<typeof msg>[0])));
      const rate = ratePercent(f.hit, f.judged);
      if (rate === null) {
        row.append(el('span', 'cov-rate cov-none', msg('coverageNoDict')));
      } else {
        const low = f.judged < LOW_SAMPLE_THRESHOLD ? ` (${msg('coverageLowSample')})` : '';
        row.append(el('span', 'cov-rate', `${rate}% (${f.hit}/${f.judged})${low}`));
        const bar = el('div', 'cov-bar');
        bar.title = `${f.hit} / ${f.near} / ${f.far}`;
        for (const [cls, n] of [['cov-hit', f.hit], ['cov-near', f.near], ['cov-far', f.far]] as const) {
          if (n > 0) {
            const seg = el('i', cls);
            seg.style.width = `${(n / f.judged) * 100}%`;
            bar.append(seg);
          }
        }
        row.append(bar);
      }
      row.setAttribute('aria-label', `${f.family}: ${f.hit}/${f.judged}`);
      coverageFamiliesEl.append(row);
    }
    const overall = ratePercent(cov.overall.hit, cov.overall.judged);
    coverageOverallEl.textContent =
      overall === null
        ? ''
        : `${fillTemplate('coverageOverall', { rate: overall, hit: cov.overall.hit, judged: cov.overall.judged })} ${msg('coverageOverallNote')}`;
    const mRate = ratePercent(cov.measurable.judged, cov.measurable.total);
    coverageMeasurableEl.textContent =
      mRate === null
        ? ''
        : fillTemplate('coverageMeasurable', {
            judged: cov.measurable.judged,
            total: cov.measurable.total,
            rate: mRate,
          });
  }

  // 来歴 (ハードコード検出の本体)。判定できなければ率を出さず理由を書く
  coverageOriginEl.replaceChildren();
  if (scan.styleSource === 'css-in-js') {
    // MUI の sx={{ p: 2 }} は theme 由来でも出力は padding: 16px になる。
    // これを「ベタ書き = トークン変更に追従しない」と報告するのは誤りなので主張を止める。
    coverageOriginEl.append(el('div', 'hint', msg('coverageOriginCssInJs')));
  } else if (!scan.originAvailable || cov.originKnown === 0) {
    coverageOriginEl.append(el('div', 'hint', msg('coverageOriginUnavailable')));
  } else {
    coverageOriginEl.append(el('div', 'hint', msg('coverageOriginTitle')));
    const grid = el('div', 'cov-quad');
    const cells: [string, string, number][] = [
      ['good', 'coverageOriginVarHit', cov.matrix.varHit],
      ['warn', 'coverageOriginVarMiss', cov.matrix.varMiss],
      ['warn', 'coverageOriginLiteralHit', cov.matrix.literalHit],
      ['bad', 'coverageOriginLiteralMiss', cov.matrix.literalMiss],
    ];
    for (const [tone, key, n] of cells) {
      const cell = el('div', `cov-cell ${tone}`);
      cell.append(el('b', undefined, String(n)));
      cell.append(document.createTextNode(msg(key as Parameters<typeof msg>[0])));
      grid.append(cell);
    }
    coverageOriginEl.append(grid);
    if (cov.matrix.literalHit > 0) {
      coverageOriginEl.append(
        el('div', 'hint', fillTemplate('coverageOriginNote', { n: cov.matrix.literalHit })),
      );
    }
    // 「該当トークンが無い」を来歴の問題として出さない (この文言は継承・ブラウザ既定・
    // stylesheet が読めない、の 3 つを名指ししている)。判定できなかった分は判定カバー率で申告済み
    if (cov.matrix.originUnknown > 0) {
      coverageOriginEl.append(
        el('div', 'hint', fillTemplate('coverageOriginExcluded', { n: cov.matrix.originUnknown })),
      );
    }
    const varRate = ratePercent(cov.originVar, cov.originKnown);
    if (varRate !== null) {
      coverageOriginEl.append(
        el('div', 'hint', fillTemplate('coverageVarRate', {
          rate: varRate, vars: cov.originVar, known: cov.originKnown,
        })),
      );
    }
  }

  const offRate = ratePercent(cov.offGrid.off, cov.offGrid.total);
  coverageOffGridEl.textContent =
    offRate === null
      ? ''
      : fillTemplate('coverageOffGrid', {
          grid: scan.grid, rate: offRate, off: cov.offGrid.off, total: cov.offGrid.total,
        });

  coverageTopEl.replaceChildren();
  if (cov.top.length) {
    coverageTopEl.append(el('div', 'hint', msg('coverageTopTitle')));
    for (const t of cov.top) {
      coverageTopEl.append(
        el('div', undefined, t.nearest
          ? fillTemplate('coverageTopLine', { value: t.value, count: t.count, token: t.nearest })
          : fillTemplate('coverageTopLineFar', { value: t.value, count: t.count })),
      );
    }
  }
}

/** design-scan を投げて結果を取る。shape を検証してから返す (不正 payload で popup を壊さない) */
async function requestScan(): Promise<DesignScan | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return null;
  let scan: unknown = null;
  try {
    // frameId: 0 = トップフレームのみ (指定しないと iframe の結果が本文を置き換える)
    scan = await browser.tabs.sendMessage(tab.id, { type: 'design-scan' }, { frameId: 0 });
  } catch {
    return null;
  }
  const s = scan as DesignScan | null;
  if (!s || typeof s.elementCount !== 'number' || !s.elementCount) return null;
  if (!s.coverage || !Array.isArray(s.coverage.families)) return null;
  if (typeof s.stats !== 'object' || s.stats === null) return null;
  // 拡張を更新した直後のタブでは **古い content script が残ったまま応答する**。
  // 後から足したフィールドが欠けるので、型が保証する形へ正規化してから返す
  // (欠けたまま描くと "Off the undefinedpx grid" のような表示になる)。
  if (typeof s.grid !== 'number') s.grid = DEFAULT_GRID_PX;
  if (s.tokenSources === undefined) s.tokenSources = null;
  return s;
}

coverageMeasureEl.addEventListener('click', async () => {
  coverageMeasureEl.disabled = true;
  coverageStatusEl.textContent = msg('coverageMeasuring');
  const scan = await requestScan();
  coverageMeasureEl.disabled = false;
  if (!scan) {
    coverageStatusEl.textContent = msg('aiStatusScanFail');
    return;
  }
  lastScan = scan;
  coverageStatusEl.textContent = '';
  coverageMeasureEl.className = 'secondary';
  renderCoverage(scan);
});

coverageCopyEl.addEventListener('click', async () => {
  if (!lastScan) return;
  // 来歴を出すかは report.originTrusted が持つ (ここで styleSource を渡し忘れて
  // 「画面では主張しないがコピー出力では主張する」状態になっていたのを構造で塞いだ)
  const md = formatCoverageMarkdown(lastScan.coverage, {
    elementCount: lastScan.elementCount,
    truncated: lastScan.truncated,
    grid: lastScan.grid,
    tokenCounts: lastScan.tokenCounts,
    tokenSources: lastScan.tokenSources,
  });
  try {
    await navigator.clipboard.writeText(md);
    coverageStatusEl.textContent = msg('aiStatusCopied');
  } catch {
    coverageStatusEl.textContent = msg('statsCopyFail');
  }
});

// 「開発者向け」折りたたみの開閉状態を保持 (エンジニアは開きっぱなしにできる)
const devSectionEl = $<HTMLElement>('devSection') as HTMLDetailsElement;
devSectionEl.addEventListener('toggle', () => {
  void browser.storage.local.set({ popupDevOpen: devSectionEl.open });
});

// ---- AI デザイン監査 (BYOK / FR-24〜27) ----------------------------------
// 設定は Settings に混ぜず専用キーに置く: settings は bridge → MAIN world へ
// postMessage されるため、キーはもちろんプロバイダ設定もページ側に流さない。
const aiEnabledEl = $<HTMLInputElement>('aiEnabled');
const aiProviderEl = $<HTMLSelectElement>('aiProvider');
const aiModelEl = $<HTMLInputElement>('aiModel');
const aiKeyEl = $<HTMLInputElement>('aiKey');
const aiCollectEl = $<HTMLButtonElement>('aiCollect');
const aiPreviewEl = $<HTMLTextAreaElement>('aiPreview');
const aiPreviewLabelEl = $('aiPreviewLabel');
const aiEstimateEl = $('aiEstimate');
const aiSendEl = $<HTMLButtonElement>('aiSend');
const aiStatusEl = $('aiStatus');
const aiResultWrapEl = $('aiResultWrap');
const aiResultEl = $<HTMLTextAreaElement>('aiResult');
const aiCopyEl = $<HTMLButtonElement>('aiCopy');

interface AiConfig {
  /** ハード無効化トグル (FR-27)。false で AI 機能全体を inert にする */
  enabled: boolean;
  provider: AiProviderId;
  /** モデル ID はハードコードせず設定値 (FR-24)。既定は最安クラス */
  models: Record<AiProviderId, string>;
}
const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: true,
  provider: 'openai',
  models: {
    openai: AI_PROVIDERS.openai.defaultModel,
    gemini: AI_PROVIDERS.gemini.defaultModel,
  },
};
let aiConfig: AiConfig = DEFAULT_AI_CONFIG;
let aiKeys: Record<AiProviderId, string> = { openai: '', gemini: '' };
/** 直近の「収集 → プレビュー」結果。送信はこの内容以外を送らない (FR-26) */
let auditPrompt: AuditPrompt | null = null;

function syncAiState() {
  const on = aiConfig.enabled;
  for (const el of [aiProviderEl, aiModelEl, aiKeyEl, aiCollectEl, aiSendEl, aiCopyEl]) {
    el.disabled = !on;
  }
  aiModelEl.value = aiConfig.models[aiConfig.provider];
  aiKeyEl.value = aiKeys[aiConfig.provider];
}

async function saveAiConfig() {
  await browser.storage.local.set({ aiConfig, aiKeys });
}

aiEnabledEl.addEventListener('change', () => {
  aiConfig.enabled = aiEnabledEl.checked;
  syncAiState();
  void saveAiConfig();
});
aiProviderEl.addEventListener('change', () => {
  aiConfig.provider = aiProviderEl.value as AiProviderId;
  syncAiState();
  void saveAiConfig();
});
aiModelEl.addEventListener('change', () => {
  aiConfig.models[aiConfig.provider] =
    aiModelEl.value.trim() || AI_PROVIDERS[aiConfig.provider].defaultModel;
  aiModelEl.value = aiConfig.models[aiConfig.provider];
  void saveAiConfig();
});
// change (blur) だけだと、キーを貼り付けてフォーカスを残したまま popup を閉じた時に
// 保存されず入力が消える (トークン欄と同じ対策のデバウンス保存)
let aiKeySaveTimer: ReturnType<typeof setTimeout> | undefined;
const saveAiKey = () => {
  aiKeys[aiConfig.provider] = aiKeyEl.value.trim();
  void saveAiConfig();
};
aiKeyEl.addEventListener('input', () => {
  clearTimeout(aiKeySaveTimer);
  aiKeySaveTimer = setTimeout(saveAiKey, 400);
});
aiKeyEl.addEventListener('change', () => {
  clearTimeout(aiKeySaveTimer);
  saveAiKey();
});

// storage.session が使えない環境でも上限が無言で無効化されないよう、
// popup のライフタイム内のカウントを保持してフォールバックにする
let localCallCount = 0;

async function sessionCalls(): Promise<number> {
  try {
    const { aiCalls } = await browser.storage.session.get('aiCalls');
    return Math.max(typeof aiCalls === 'number' ? aiCalls : 0, localCallCount);
  } catch {
    return localCallCount;
  }
}

/** 上限カウントは送信の成否によらず消費する (失敗連打で上限を回避させない) */
async function countCall(current: number): Promise<void> {
  localCallCount = current + 1;
  try {
    await browser.storage.session.set({ aiCalls: localCallCount });
  } catch {
    // storage.session 非対応環境では localCallCount のみで運用する
  }
}

// 収集 → プレビュー (FR-26: 送信前に全文を見せる。この段階では何も送らない)
aiCollectEl.addEventListener('click', async () => {
  aiStatusEl.textContent = '';
  // 既に測定済みならその結果を使い、重いスキャンを 2 回走らせない
  const scan = lastScan ?? (await requestScan());
  if (!scan) {
    aiStatusEl.textContent = msg('aiStatusScanFail');
    return;
  }
  lastScan = scan;
  const locale = browser.i18n.getUILanguage().toLowerCase().startsWith('ja') ? 'ja' : 'en';
  auditPrompt = buildAuditPrompt(scan, locale);
  // プレビュー = 実際に送信する全文 (system + user)。ページ由来データは user 側のみ
  aiPreviewEl.value = `[system]\n${auditPrompt.system}\n\n[user]\n${auditPrompt.user}`;
  aiPreviewLabelEl.hidden = false;
  aiPreviewEl.hidden = false;
  aiSendEl.hidden = false;
  const tokens = estimateTokens(auditPrompt.system + auditPrompt.user);
  aiEstimateEl.textContent = msg('aiEstimateLine')
    .replace('{tokens}', String(tokens))
    .replace('{n}', String(await sessionCalls()))
    .replace('{cap}', String(AI_SESSION_CALL_LIMIT));
  aiEstimateEl.hidden = false;
});

// 送信 (FR-25: 明示ボタン起点のみ / FR-24: 通信は background から公式エンドポイントへ)
aiSendEl.addEventListener('click', async () => {
  if (!auditPrompt) return;
  const provider = AI_PROVIDERS[aiConfig.provider];
  const apiKey = aiKeys[aiConfig.provider];
  if (!apiKey) {
    aiStatusEl.textContent = msg('aiStatusNoKey');
    return;
  }
  // gesture 内で最初に権限 request (前に await を挟むと権限ダイアログが無言拒否される)
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [provider.originPattern] });
  } catch {
    aiStatusEl.textContent = msg('permError');
    return;
  }
  if (!granted) {
    aiStatusEl.textContent = msg('permDenied');
    return;
  }
  const calls = await sessionCalls();
  if (calls >= AI_SESSION_CALL_LIMIT) {
    aiStatusEl.textContent = msg('aiStatusCap').replace('{cap}', String(AI_SESSION_CALL_LIMIT));
    return;
  }
  aiSendEl.disabled = true;
  aiStatusEl.textContent = msg('aiStatusSending');
  await countCall(calls); // 送信を試みた時点で消費 (失敗連打での上限回避を防ぐ)
  const res = (await browser.runtime
    .sendMessage({
      type: 'ai-review',
      provider: aiConfig.provider,
      model: aiConfig.models[aiConfig.provider],
      apiKey,
      system: auditPrompt.system,
      user: auditPrompt.user,
    })
    .catch((e: unknown) => ({ ok: false as const, error: String(e) }))) as
    | { ok: true; text: string }
    | { ok: false; error: string }
    | undefined;
  aiSendEl.disabled = false;
  if (res?.ok && typeof res.text === 'string') {
    aiResultEl.value = res.text;
    aiResultWrapEl.hidden = false;
    aiStatusEl.textContent = '';
  } else {
    // 応答自体が届かない (SW 未応答) 場合も含めて定型エラーにする
    aiStatusEl.textContent = msg('aiStatusError').replace(
      '{error}',
      res && !res.ok ? res.error : 'no response',
    );
  }
});

aiCopyEl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(aiResultEl.value);
    aiStatusEl.textContent = msg('aiStatusCopied');
  } catch {
    aiStatusEl.textContent = msg('statsCopyFail');
  }
});

async function load() {
  const stored = await browser.storage.local.get('settings');
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
  const { popupDevOpen } = await browser.storage.local.get('popupDevOpen');
  devSectionEl.open = popupDevOpen === true;
  badgeDetailEl.value = settings.badgeDetail;
  showVarNamesEl.checked = settings.showVarNames;
  autoThemeEl.checked = settings.autoTheme;
  editorEl.value = settings.editor;
  // 保存済みトークンの復元 (raw テキスト + 解析結果の件数表示)
  const { tokenJson, tokenDict } = (await browser.storage.local.get([
    'tokenJson',
    'tokenDict',
  ])) as { tokenJson?: string; tokenDict?: TokenDict };
  if (typeof tokenJson === 'string' && tokenDict) {
    tokensEl.value = tokenJson;
    showTokensStatus(tokenDict.colors?.length ?? 0, tokenDict.sizes?.length ?? 0);
    tokensClearEl.hidden = false;
  } else {
    tokensStatusEl.textContent = msg('tokensEmpty');
  }
  // AI 設定 (専用キー — settings と違い bridge へは流れない)
  const stored2 = (await browser.storage.local.get(['aiConfig', 'aiKeys'])) as {
    aiConfig?: Partial<AiConfig>;
    aiKeys?: Partial<Record<AiProviderId, string>>;
  };
  aiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...(stored2.aiConfig ?? {}),
    models: { ...DEFAULT_AI_CONFIG.models, ...(stored2.aiConfig?.models ?? {}) },
  };
  // 破損値で AI セクションが静かに壊れないよう既知の provider に丸める
  if (!(aiConfig.provider in AI_PROVIDERS)) aiConfig.provider = DEFAULT_AI_CONFIG.provider;
  // 旧既定のまま保存されているモデル ID を現在の既定へ移行する。
  // これが無いと、既定を差し替えても一度でも AI 設定を触った利用者には反映されない。
  let migrated = false;
  for (const id of Object.keys(AI_PROVIDERS) as AiProviderId[]) {
    const next = migrateModelId(id, aiConfig.models[id]);
    if (next !== aiConfig.models[id]) {
      aiConfig.models[id] = next;
      migrated = true;
    }
  }
  if (migrated) void saveAiConfig();
  aiKeys = { openai: '', gemini: '', ...(stored2.aiKeys ?? {}) };
  aiEnabledEl.checked = aiConfig.enabled;
  aiProviderEl.value = aiConfig.provider;
  syncAiState();
  void applyShortcutHints();
}

async function save() {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    badgeDetail: badgeDetailEl.value as Settings['badgeDetail'],
    showVarNames: showVarNamesEl.checked,
    autoTheme: autoThemeEl.checked,
    editor: editorEl.value as Settings['editor'],
  };
  await browser.storage.local.set({ settings });
  void applyShortcutHints();
}

for (const el of [badgeDetailEl, showVarNamesEl, autoThemeEl, editorEl]) {
  el.addEventListener('change', () => {
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

// 任意オリジン (デプロイ済み App) をユーザー明示許可で有効化 (M1)。
// 重要: permissions.request はユーザー操作直後 (await を挟まず) に呼ぶ必要があるため、
// origin/tabId はポップアップ表示時に先読みしておく。
let siteOrigin: string | null = null;
let siteTabId: number | null = null;
// blob: top-level タブ (新規タブで開いたプレビュー等) は registerContentScripts 不可。
// executeScript のみで注入する専用パスを使う。
let isBlobTab = false;

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
async function applyAvailability(origin: string | null) {
  const notice = $('modeUnavailable');
  const toggleBtn = $<HTMLButtonElement>('toggle');
  const measureBtn = $<HTMLButtonElement>('coverageMeasure');

  let available = false;
  let reason: 'ok' | 'notEnabled' | 'notInspectable' = 'notInspectable';
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
  measureBtn.disabled = !available;
  notice.hidden = available;
  if (!available) {
    notice.textContent = msg(reason === 'notEnabled' ? 'modeNotEnabledHere' : 'modeNotInspectable');
  }
}

async function detectSite() {
  const status = $('siteStatus');
  const btn = $<HTMLButtonElement>('enableSite');
  isBlobTab = false;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    siteTabId = tab?.id ?? null;
    const url = tab?.url ? new URL(tab.url) : null;
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
    // blob タブは allSitesGranted がないと executeScript できない
    btn.disabled = !allSitesGranted;
    status.textContent = allSitesGranted
      ? msg('siteTarget').replace('{origin}', `blob: (${siteOrigin})`)
      : msg('siteUnavailable');
  } else if (!siteOrigin || siteTabId == null) {
    btn.disabled = true;
    status.textContent = msg('siteUnavailable');
  } else {
    btn.disabled = false;
    status.textContent = msg('siteTarget').replace('{origin}', siteOrigin);
  }
  await applyAvailability(siteOrigin);
}

async function enableCurrentSite() {
  const status = $('siteStatus');
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
void refreshAllSites().then(() => detectSite());

// モード切替 (Alt+Shift+I / Alt+Shift+R) の再割当は Chrome 純正ページに委ねる
// (拡張からショートカットを直接書き換える API は存在しないため)
$('configureShortcuts').addEventListener('click', () => {
  void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

applyI18n();
void load();
