import { buildEditorUrl } from './editor';
import { lintSpacing } from './tokenLint';
import type { TreeNode } from './tree';
import { DEFAULT_STRINGS, type Classification, type InspectInfo, type Settings, type UiStrings } from './types';

/**
 * 対象ページと干渉しない Shadow DOM 隔離オーバーレイ (v3.0 §7)。
 * ハイライト枠 + バッジは pointer-events: none、owner チェーンパネルのみ操作可能。
 */
interface Flash {
  rect: { left: number; top: number; width: number; height: number };
  born: number;
  heat: number;
}

/** 再描画ヒートマップの色: 回数が多いほど青→緑→黄→赤 */
function heatColor(heat: number): string {
  if (heat <= 1) return '96,165,250'; // 青
  if (heat <= 3) return '52,211,153'; // 緑
  if (heat <= 7) return '251,191,36'; // 黄
  return '248,113,113'; // 赤
}

export class Overlay {
  private host: HTMLElement | null = null;
  private box!: HTMLDivElement;
  private badge!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private statsPanel!: HTMLDivElement;
  private renderControl!: HTMLDivElement;
  private treePanel!: HTMLDivElement;
  /** ツリー行の nodeId → DOM 行 (scrollTreeTo 用) */
  private treeRows = new Map<number, HTMLElement>();
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D | null;
  private toastEl!: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private flashes: Flash[] = [];
  private flashRaf = 0;
  private readonly FLASH_MS = 500;

  constructor(
    private settings: Settings,
    private strings: UiStrings = DEFAULT_STRINGS,
  ) {}

  updateSettings(settings: Settings) {
    this.settings = settings;
  }

  /** イベントがオーバーレイ自身の上で起きたか (自己ホバーの除外用) */
  containsTarget(target: EventTarget | null): boolean {
    return !!this.host && target instanceof Node && this.host.contains(target);
  }

  private ensureMounted() {
    if (this.host?.isConnected) return;
    this.host = document.createElement('mui-inspector-overlay');
    const root = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .box, .badge, .toast, .panel {
        position: fixed;
        z-index: 2147483647;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .box {
        pointer-events: none;
        border: 2px solid transparent;
        background: transparent;
        display: none;
      }
      .badge {
        pointer-events: none;
        display: none;
        max-width: 560px;
        padding: 6px 10px;
        border-radius: 6px;
        background: rgba(20, 20, 24, 0.92);
        color: #fff;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        /* 複数行を許可し肝心な file:line を省略しない */
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .badge .name { font-weight: 700; display: block; }
      .badge .meta { opacity: 0.8; display: block; }
      .badge .file { opacity: 0.95; display: block; margin-top: 2px; }
      .badge .design { opacity: 0.85; display: block; margin-top: 3px; color: #a5d8ff; }
      .badge .warn { display: block; margin-top: 2px; color: #ffd43b; }
      .toast {
        display: none;
        left: 50%;
        transform: translateX(-50%);
        bottom: 24px;
        padding: 8px 14px;
        border-radius: 8px;
        background: rgba(20, 20, 24, 0.92);
        color: #fff;
        font-size: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      }
      .panel {
        display: none;
        pointer-events: auto;
        min-width: 320px;
        max-width: 560px;
        max-height: 60vh;
        overflow: auto;
        padding: 8px 0;
        border-radius: 8px;
        background: rgba(20, 20, 24, 0.96);
        color: #fff;
        font-size: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      }
      .panel .title { padding: 4px 12px 8px; font-weight: 700; opacity: 0.85; }
      .panel .row {
        display: flex;
        gap: 8px;
        align-items: baseline;
        padding: 5px 12px;
        cursor: default;
      }
      .panel .row.jumpable { cursor: pointer; }
      .panel .row.jumpable:hover { background: rgba(255,255,255,0.08); }
      .panel .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
      .panel .file { opacity: 0.65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .render-canvas { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
      .stats {
        position: fixed;
        z-index: 2147483647;
        display: none;
        pointer-events: auto;
        top: 12px;
        right: 12px;
        width: 340px;
        max-height: 70vh;
        overflow: auto;
        border-radius: 8px;
        background: rgba(20, 20, 24, 0.96);
        color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      }
      .stats .head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; font-weight: 700; position: sticky; top: 0;
        background: rgba(20,20,24,0.98);
      }
      .stats .head button {
        all: unset; cursor: pointer; opacity: 0.6; font-size: 14px; padding: 0 4px;
      }
      .stats .head button:hover { opacity: 1; }
      .stats .sub { padding: 0 12px 8px; opacity: 0.6; font-size: 11px; }
      .stats .r {
        display: grid; grid-template-columns: 1fr auto auto; gap: 8px;
        padding: 4px 12px; align-items: baseline;
      }
      .stats .r:nth-child(even) { background: rgba(255,255,255,0.04); }
      .stats .r .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stats .r .ct { font-weight: 700; text-align: right; }
      .stats .r .ms { opacity: 0.6; text-align: right; }
      .rctl {
        position: fixed; z-index: 2147483647; display: none;
        pointer-events: auto; left: 12px; bottom: 12px;
        align-items: center; gap: 10px; padding: 8px 12px;
        border-radius: 999px; background: rgba(20,20,24,0.94); color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.4);
      }
      .rctl.on { display: inline-flex; }
      .rctl .st { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
      .rctl .st .d { width: 8px; height: 8px; border-radius: 50%; background: #34d399; }
      .rctl.rec .st .d { background: #ef4444; animation: rctlblink 1s steps(2, start) infinite; }
      @keyframes rctlblink { 50% { opacity: 0.25; } }
      .rctl button {
        all: unset; cursor: pointer; padding: 4px 12px; border-radius: 999px;
        background: #ef4444; color: #fff; font-weight: 700; font-size: 12px;
      }
      .rctl.rec button { background: #6b7280; }
      .rctl button:hover { filter: brightness(1.1); }
      .tree {
        position: fixed; z-index: 2147483647; display: none;
        pointer-events: auto; top: 12px; left: 12px;
        width: 360px; max-height: 78vh; overflow: auto;
        border-radius: 8px; background: rgba(20,20,24,0.96); color: #fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      }
      .tree .head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; font-weight: 700; position: sticky; top: 0;
        background: rgba(20,20,24,0.98);
      }
      .tree .head button { all: unset; cursor: pointer; opacity: 0.6; font-size: 14px; padding: 0 4px; }
      .tree .head button:hover { opacity: 1; }
      .tree .trow {
        display: flex; align-items: center; gap: 6px;
        padding: 3px 12px 3px 0; cursor: pointer; white-space: nowrap;
      }
      .tree .trow:hover { background: rgba(255,255,255,0.08); }
      .tree .trow.hl { background: rgba(96,165,250,0.35); }
      .tree .trow .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .tree .trow .nm { overflow: hidden; text-overflow: ellipsis; }
      .tree .trow .tag { opacity: 0.4; font-size: 10px; }
      .tree .empty { padding: 8px 12px; opacity: 0.6; }
    `;
    root.appendChild(style);

    this.box = document.createElement('div');
    this.box.className = 'box';
    this.badge = document.createElement('div');
    this.badge.className = 'badge';
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'render-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.statsPanel = document.createElement('div');
    this.statsPanel.className = 'stats';
    this.renderControl = document.createElement('div');
    this.renderControl.className = 'rctl';
    this.treePanel = document.createElement('div');
    this.treePanel.className = 'tree';
    root.append(
      this.canvas,
      this.box,
      this.badge,
      this.panel,
      this.statsPanel,
      this.renderControl,
      this.treePanel,
      this.toastEl,
    );
    document.documentElement.appendChild(this.host);
  }

  private colorFor(classification: Classification): string {
    const { colors } = this.settings;
    return classification === 'mui'
      ? colors.mui
      : classification === 'custom'
        ? colors.custom
        : colors.thirdParty;
  }

  /** ハイライト + バッジを対象要素に合わせて表示 (FR-02 / FR-03) */
  show(element: Element, info: InspectInfo) {
    this.ensureMounted();
    const rect = element.getBoundingClientRect();
    const color = this.colorFor(info.classification);

    Object.assign(this.box.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderColor: color,
      background: `${color}1a`,
    });

    // 情報量 (compact/normal/detailed) に応じて props の表示件数を決める。
    // detailed=全件、normal=先頭4件、compact=無し。
    const detail = this.settings.badgeDetail ?? 'normal';
    const entries = Object.entries(info.props);
    const propsShown = detail === 'compact' ? [] : detail === 'detailed' ? entries : entries.slice(0, 4);
    const propsText = propsShown.map(([k, v]) => `${k}=${v}`).join(' ');
    const file = info.jumpTarget
      ? `${info.jumpTarget.fileName.split('/').pop()}:${info.jumpTarget.lineNumber}`
      : info.devMode
        ? this.strings.sourceUnavailable
        : this.strings.prodSafeMode;

    this.badge.replaceChildren();
    const name = document.createElement('span');
    name.className = 'name';
    name.style.color = color;
    name.textContent = `<${info.name}>`;
    this.badge.append(name);
    if (detail !== 'compact') {
      const metaBits = [info.internalName, propsText].filter(Boolean).join(' · ');
      if (metaBits) {
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = metaBits;
        this.badge.append(meta);
      }
    }
    // file:line は常に独立行で必ず表示する (最重要のジャンプ先を省略しない)
    const fileEl = document.createElement('span');
    fileEl.className = 'file';
    fileEl.textContent = file;
    this.badge.append(fileEl);

    // デザイン情報 (computed style): production=セーフモード or detailed 時に表示。
    // production では Fiber が取れずソースジャンプ不可なので、代わりにこれが主情報になる。
    if ((detail === 'detailed' || !info.devMode) && info.design.length) {
      const designEl = document.createElement('span');
      designEl.className = 'design';
      designEl.textContent = info.design.map((p) => `${p.label}:${p.value}`).join(' · ');
      this.badge.append(designEl);

      // 野良値検出 (4px グリッド外の余白/角丸)。テーマ非依存で production でも動く。
      const findings = lintSpacing(info.design);
      if (findings.length) {
        const warn = document.createElement('span');
        warn.className = 'warn';
        warn.textContent =
          '⚠ ' + findings.map((f) => `${f.label} off-grid(${f.offGrid.join('/')}px)`).join(' · ');
        this.badge.append(warn);
      }
    }

    // 複数行で高さが可変になるため、実測してから上下配置を決める
    this.badge.style.display = 'block';
    this.badge.style.left = `${Math.max(4, rect.left)}px`;
    this.badge.style.top = '0px';
    const badgeHeight = this.badge.getBoundingClientRect().height;
    const top = rect.top > badgeHeight + 8 ? rect.top - badgeHeight - 4 : rect.bottom + 6;
    this.badge.style.top = `${top}px`;
  }

  hideHighlight() {
    if (!this.host) return;
    this.box.style.display = 'none';
    this.badge.style.display = 'none';
  }

  /** Alt+クリックの owner チェーンパネル (FR-04) */
  showChainPanel(info: InspectInfo, x: number, y: number) {
    this.ensureMounted();
    this.panel.replaceChildren();
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = this.strings.ownerPanelTitle;
    this.panel.appendChild(title);

    for (const entry of info.ownerChain) {
      const row = document.createElement('div');
      row.className = 'row';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = this.colorFor(entry.classification);
      const name = document.createElement('span');
      name.textContent = entry.name;
      const file = document.createElement('span');
      file.className = 'file';
      if (entry.source) {
        file.textContent = `${entry.source.fileName.split('/').pop()}:${entry.source.lineNumber}`;
        row.classList.add('jumpable');
        const source = entry.source;
        row.addEventListener('click', () => {
          this.openEditor(source);
          this.hideChainPanel();
        });
      }
      row.append(dot, name, file);
      this.panel.appendChild(row);
    }

    Object.assign(this.panel.style, {
      display: 'block',
      left: `${Math.min(x, window.innerWidth - 340)}px`,
      top: `${Math.min(y, window.innerHeight * 0.4)}px`,
    });
  }

  hideChainPanel() {
    if (this.host) this.panel.style.display = 'none';
  }

  isChainPanelOpen(): boolean {
    return !!this.host && this.panel.style.display === 'block';
  }

  hideAll() {
    this.hideHighlight();
    this.hideChainPanel();
  }

  openEditor(loc: { fileName: string; lineNumber: number; columnNumber: number }) {
    const url = buildEditorUrl(this.settings, loc);
    // カスタムスキームはページ遷移せず外部プロトコルダイアログを開く
    window.location.href = url;
  }

  /** レンダーデバッグ: 再描画した要素群をヒートマップ色で明滅させる */
  flashRenders(entries: { element: Element; heat: number }[]) {
    this.ensureMounted();
    const now = Date.now();
    for (const { element, heat } of entries) {
      const r = element.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      this.flashes.push({
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        born: now,
        heat,
      });
    }
    // 過剰蓄積を防ぐ (古いものから捨てる)
    if (this.flashes.length > 400) this.flashes.splice(0, this.flashes.length - 400);
    if (!this.flashRaf) this.flashRaf = requestAnimationFrame(this.drawFlashes);
  }

  private drawFlashes = () => {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!ctx) {
      this.flashRaf = 0;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const now = Date.now();
    this.flashes = this.flashes.filter((f) => now - f.born < this.FLASH_MS);
    for (const f of this.flashes) {
      const alpha = 1 - (now - f.born) / this.FLASH_MS;
      const rgb = heatColor(f.heat);
      ctx.strokeStyle = `rgba(${rgb},${alpha})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(f.rect.left, f.rect.top, f.rect.width, f.rect.height);
      ctx.fillStyle = `rgba(${rgb},${alpha * 0.12})`;
      ctx.fillRect(f.rect.left, f.rect.top, f.rect.width, f.rect.height);
    }

    this.flashRaf = this.flashes.length ? requestAnimationFrame(this.drawFlashes) : 0;
  };

  clearRenderFlashes() {
    this.flashes = [];
    cancelAnimationFrame(this.flashRaf);
    this.flashRaf = 0;
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /** レンダー記録の統計パネル (再描画回数ランキング) */
  showRenderStats(
    snapshot: { stats: { name: string; count: number; selfMs: number }[]; commits: number },
    supported: boolean,
    onClose: () => void,
  ) {
    this.ensureMounted();
    this.statsPanel.replaceChildren();

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('span');
    title.textContent = this.strings.statsTitle.replace('{n}', String(snapshot.commits));
    const close = document.createElement('button');
    close.textContent = '×';
    close.addEventListener('click', () => {
      this.hideRenderStats();
      onClose();
    });
    head.append(title, close);
    this.statsPanel.appendChild(head);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = supported
      ? this.strings.statsColsSupported
      : this.strings.statsColsUnsupported;
    this.statsPanel.appendChild(sub);

    if (snapshot.stats.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'r';
      empty.textContent = this.strings.statsEmpty;
      this.statsPanel.appendChild(empty);
    }
    for (const s of snapshot.stats.slice(0, 100)) {
      const row = document.createElement('div');
      row.className = 'r';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = s.name;
      const ct = document.createElement('span');
      ct.className = 'ct';
      ct.textContent = String(s.count);
      const ms = document.createElement('span');
      ms.className = 'ms';
      ms.textContent = s.selfMs > 0 ? s.selfMs.toFixed(1) : '—';
      row.append(nm, ct, ms);
      this.statsPanel.appendChild(row);
    }
    this.statsPanel.style.display = 'block';
  }

  hideRenderStats() {
    if (this.host) this.statsPanel.style.display = 'none';
  }

  /**
   * レンダーモードの常設コントロール (状態表示 + 記録トグルボタン)。
   * キー操作を知らなくても記録を開始/停止できるようにする。
   */
  showRenderControl(opts: {
    title: string;
    recording: boolean;
    toggleLabel: string;
    onToggle: () => void;
  }) {
    this.ensureMounted();
    this.renderControl.replaceChildren();
    const status = document.createElement('span');
    status.className = 'st';
    const dot = document.createElement('span');
    dot.className = 'd';
    const label = document.createElement('span');
    label.textContent = opts.recording ? 'REC' : opts.title;
    status.append(dot, label);
    const btn = document.createElement('button');
    btn.textContent = opts.toggleLabel;
    btn.addEventListener('click', opts.onToggle);
    this.renderControl.append(status, btn);
    this.renderControl.classList.toggle('rec', opts.recording);
    this.renderControl.classList.add('on');
  }

  hideRenderControl() {
    if (this.host) this.renderControl.classList.remove('on', 'rec');
  }

  /**
   * ビジュアルツリーを描画 (FR-05)。nodes は buildTree/filterTree が返す depth 付き平坦配列。
   * 行 hover → onHoverNode、クリック → onClickNode。owner 用 panel とは別サーフェス。
   */
  showTree(
    nodes: TreeNode[],
    opts: { title: string; onHoverNode: (node: TreeNode) => void; onClickNode: (node: TreeNode) => void; onClose: () => void },
  ) {
    this.ensureMounted();
    this.treePanel.replaceChildren();
    this.treeRows.clear();

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('span');
    title.textContent = `${opts.title} (${nodes.length})`;
    const close = document.createElement('button');
    close.textContent = '×';
    close.addEventListener('click', () => {
      this.hideTree();
      opts.onClose();
    });
    head.append(title, close);
    this.treePanel.appendChild(head);

    if (nodes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = this.strings.statsEmpty;
      this.treePanel.appendChild(empty);
    }

    for (const node of nodes) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.style.paddingLeft = `${8 + node.depth * 13}px`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = this.colorFor(node.classification);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = node.name;
      row.append(dot, nm);
      row.addEventListener('mouseenter', () => opts.onHoverNode(node));
      row.addEventListener('click', () => opts.onClickNode(node));
      this.treePanel.appendChild(row);
      this.treeRows.set(node.id, row);
    }
    this.treePanel.style.display = 'block';
  }

  hideTree() {
    if (this.host) this.treePanel.style.display = 'none';
  }

  isTreeOpen(): boolean {
    return !!this.host && this.treePanel.style.display === 'block';
  }

  /** 実 DOM hover → 該当ツリー行へスクロール&一時強調 (FR-07 逆方向) */
  scrollTreeTo(nodeId: number) {
    const row = this.treeRows.get(nodeId);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    for (const r of this.treeRows.values()) r.classList.remove('hl');
    row.classList.add('hl');
  }

  toast(message: string, ms = 2600) {
    this.ensureMounted();
    this.toastEl.textContent = message;
    this.toastEl.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, ms);
  }
}
