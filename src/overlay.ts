import { isColorValue } from './designStyle';
import { buildEditorUrl } from './editor';
import { el } from './overlayDom';
import { colorFor, designLabel, heatColor, visibleProps } from './overlayFormat';
import { OVERLAY_CSS } from './overlayStyles';
import { lintSpacing } from './tokenLint';
import type { TreeNode } from './tree';
import { DEFAULT_STRINGS, type InspectInfo, type Settings, type UiStrings } from './types';

/** lintSpacing に渡すグリッド幅 (px)。警告文の {grid} 表示と必ず一致させる */
const SPACING_GRID = 4;

/**
 * 対象ページと干渉しない Shadow DOM 隔離オーバーレイ (v3.0 §7)。
 * ハイライト枠 + バッジは pointer-events: none、owner チェーンパネルのみ操作可能。
 */
interface Flash {
  rect: { left: number; top: number; width: number; height: number };
  born: number;
  heat: number;
}

export class Overlay {
  private host: HTMLElement | null = null;
  private box!: HTMLDivElement;
  private badge!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private statsPanel!: HTMLDivElement;
  private renderControl!: HTMLDivElement;
  private treePanel!: HTMLDivElement;
  private inspectPillEl!: HTMLDivElement;
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
    style.textContent = OVERLAY_CSS;
    root.appendChild(style);

    this.box = el('div', 'box');
    this.badge = el('div', 'badge');
    this.panel = el('div', 'panel');
    this.toastEl = el('div', 'toast');
    this.canvas = el('canvas', 'render-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.statsPanel = el('div', 'stats');
    this.renderControl = el('div', 'rctl');
    this.treePanel = el('div', 'tree');
    this.inspectPillEl = el('div', 'inspect-pill');
    root.append(
      this.canvas,
      this.box,
      this.badge,
      this.panel,
      this.statsPanel,
      this.renderControl,
      this.treePanel,
      this.inspectPillEl,
      this.toastEl,
    );
    document.documentElement.appendChild(this.host);
  }

  /** インスペクトモード中の常設ピル。マウスだけで終了できる導線 (ST-5) */
  showModePill(label: string, closeLabel: string, onClose: () => void) {
    this.ensureMounted();
    while (this.inspectPillEl.firstChild) this.inspectPillEl.removeChild(this.inspectPillEl.firstChild);
    const lbl = el('span', 'lbl', label);
    const btn = el('button', undefined, '✕');
    btn.title = closeLabel;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClose();
    });
    this.inspectPillEl.append(lbl, btn);
    this.inspectPillEl.classList.add('on');
  }

  hideModePill() {
    this.inspectPillEl?.classList.remove('on');
  }

  /** ハイライト + バッジを対象要素に合わせて表示 (FR-02 / FR-03) */
  show(element: Element, info: InspectInfo) {
    this.ensureMounted();
    const rect = element.getBoundingClientRect();
    const color = colorFor(info.classification, this.settings.colors);
    this.positionBox(rect, color);
    this.buildBadge(info, color);
    this.positionBadge(rect);
  }

  /** ハイライト枠を対象要素の矩形・分類色に合わせる */
  private positionBox(rect: DOMRect, color: string) {
    Object.assign(this.box.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderColor: color,
      background: `${color}1a`,
    });
  }

  /** バッジの中身 (名前 / メタ / file:line / デザインチップ / 野良値警告) を再構築する */
  private buildBadge(info: InspectInfo, color: string) {
    // 情報量 (compact/normal/detailed) に応じて props の表示件数を決める。
    // detailed=全件、normal=先頭4件、compact=無し。
    const detail = this.settings.badgeDetail ?? 'normal';
    const entries = Object.entries(info.props);
    const propsShown = visibleProps(entries, detail);
    const propsText = propsShown.map(([k, v]) => `${k}=${v}`).join(' ');
    const file = info.jumpTarget
      ? `${info.jumpTarget.fileName.split('/').pop()}:${info.jumpTarget.lineNumber}`
      : info.devMode
        ? this.strings.sourceUnavailable
        : this.strings.prodSafeMode;

    this.badge.replaceChildren();
    const name = el('span', 'name', `<${info.name}>`);
    name.style.color = color;
    this.badge.append(name);
    if (detail !== 'compact') {
      const metaBits = [info.internalName, propsText].filter(Boolean).join(' · ');
      if (metaBits) {
        const meta = el('span', 'meta', metaBits);
        this.badge.append(meta);
      }
    }
    // React 要素は file:line (最重要のジャンプ先) を必ず独立行で表示。
    // 非 React (素の DOM) はソースが存在しないので file 行は出さず design を主情報にする。
    if (info.isReact) {
      const fileEl = el('span', 'file', file);
      this.badge.append(fileEl);
    }

    // デザイン情報 (computed style): compact 以外は常に表示 (デザイナーの主価値なので既定で出す)。
    // production では Fiber が取れずソースジャンプ不可なので、代わりにこれが主情報になる。
    if ((detail !== 'compact' || !info.devMode) && info.design.length) {
      const designEl = el('div', 'design');
      for (const p of info.design) {
        const chip = el('span', 'chip');
        const lb = el('span', 'lb', designLabel(p.label, this.strings));
        chip.append(lb);
        // 色値は hex 文字列だけでは読めないため実色スウォッチを前置 (半透明もそのまま描画)
        if (isColorValue(p.value)) {
          const sw = el('span', 'sw');
          sw.style.background = p.value;
          chip.append(sw);
        }
        const val = el('span', undefined, p.value);
        chip.append(val);
        designEl.append(chip);
      }
      this.badge.append(designEl);

      // 野良値検出 (グリッド外の余白/角丸)。テーマ非依存で production でも動く。
      const findings = lintSpacing(info.design, SPACING_GRID);
      if (findings.length) {
        const warn = el('span', 'warn');
        warn.textContent =
          '⚠ ' +
          findings
            .map((f) =>
              this.strings.offGridWarn
                .replace('{label}', designLabel(f.label, this.strings))
                .replace('{values}', f.offGrid.join('/'))
                .replace('{grid}', String(SPACING_GRID)),
            )
            .join(' · ');
        this.badge.append(warn);
      }
    }
  }

  /** 複数行で高さが可変になるため、実測してからバッジの上下配置を決める */
  private positionBadge(rect: DOMRect) {
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
    const title = el('div', 'title', this.strings.ownerPanelTitle);
    this.panel.appendChild(title);

    for (const entry of info.ownerChain) {
      const row = el('div', 'row');
      const dot = el('span', 'dot');
      dot.style.background = colorFor(entry.classification, this.settings.colors);
      const name = el('span', undefined, entry.name);
      const file = el('span', 'file');
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

    const head = el('div', 'head');
    const title = el('span', undefined, this.strings.statsTitle.replace('{n}', String(snapshot.commits)));
    const close = el('button', undefined, '×');
    close.addEventListener('click', () => {
      this.hideRenderStats();
      onClose();
    });
    head.append(title, close);
    this.statsPanel.appendChild(head);

    const sub = el(
      'div',
      'sub',
      supported ? this.strings.statsColsSupported : this.strings.statsColsUnsupported,
    );
    this.statsPanel.appendChild(sub);

    if (snapshot.stats.length === 0) {
      const empty = el('div', 'r', this.strings.statsEmpty);
      this.statsPanel.appendChild(empty);
    }
    for (const s of snapshot.stats.slice(0, 100)) {
      const row = el('div', 'r');
      const nm = el('span', 'nm', s.name);
      const ct = el('span', 'ct', String(s.count));
      const ms = el('span', 'ms', s.selfMs > 0 ? s.selfMs.toFixed(1) : '—');
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
    const status = el('span', 'st');
    const dot = el('span', 'd');
    const label = el('span', undefined, opts.recording ? this.strings.ctrlRecording : opts.title);
    status.append(dot, label);
    const btn = el('button', undefined, opts.toggleLabel);
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

    const head = el('div', 'head');
    const title = el('span', undefined, `${opts.title} (${nodes.length})`);
    const close = el('button', undefined, '×');
    close.addEventListener('click', () => {
      this.hideTree();
      opts.onClose();
    });
    head.append(title, close);
    this.treePanel.appendChild(head);

    if (nodes.length === 0) {
      const empty = el('div', 'empty', this.strings.statsEmpty);
      this.treePanel.appendChild(empty);
    }

    for (const node of nodes) {
      const row = el('div', 'trow');
      row.style.paddingLeft = `${8 + node.depth * 13}px`;
      const dot = el('span', 'dot');
      dot.style.background = colorFor(node.classification, this.settings.colors);
      const nm = el('span', 'nm', node.name);
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
