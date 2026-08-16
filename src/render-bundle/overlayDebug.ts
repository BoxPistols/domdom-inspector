import { el } from '../overlayDom';
import { colorFor, shapeClassFor } from '../overlayFormat';
import type { OverlaySurfaceHost } from '../overlay';
import { heatColor } from './heatColor';
import { DEBUG_OVERLAY_CSS } from './overlayDebugStyles';
import type { RenderSnapshot, RenderStat } from './renderTracker';
import type { TreeNode } from './tree';
import { formatVital, type VitalsSnapshot } from './vitals';

/**
 * 温存サーフェス (レンダーヒートマップ / 統計パネル / 記録コントロール / コンポーネント
 * ツリー) の描画。**v1 の配線からは誰も生成しない** — issue #4/#5 で戻すときに
 * `new OverlayDebugSurfaces(overlay.surfaceHost())` するだけで使える形にしてある。
 *
 * なぜ Overlay 本体から分離したか (issue #17): クラスメソッドは tree-shake されないため、
 * 到達不能なまま置いておくと描画コードも `heatColor` / `formatVital` / CSS ごと出荷 JS に
 * 載り続ける (監査時点で inspector.js の約 3 割)。**削除ではなく分離**なので、温存実装の
 * ユニットテストはそのまま生きている。
 */

/** ヒートマップ 1 枚分の明滅 (座標は発生時点のスナップショット) */
interface Flash {
  rect: { left: number; top: number; width: number; height: number };
  born: number;
  heat: number;
}

export class OverlayDebugSurfaces {
  private statsPanel: HTMLDivElement | null = null;
  private renderControl: HTMLDivElement | null = null;
  private treePanel: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private styleEl: HTMLStyleElement | null = null;
  /** ツリー行の nodeId → DOM 行 (scrollTreeTo 用) */
  private treeRows = new Map<number, HTMLElement>();
  private flashes: Flash[] = [];
  private flashRaf = 0;
  private readonly FLASH_MS = 500;
  /**
   * 最後に描いたときの Overlay の再マウント世代。ページ側 JS が overlay host を DOM から
   * 外すと Overlay は shadow root を作り直すため、ここが持つ DOM 参照は全部“外れた木”に
   * なる。世代が変わったらキャッシュを捨てて描き直す (本体のピル復元と同じ理由)。
   */
  private generation = -1;

  constructor(private host: OverlaySurfaceHost) {}

  /**
   * shadow root を用意する。再マウントされていたら自前の DOM キャッシュを捨て、
   * 温存サーフェス用の CSS を注入し直す (本体 CSS には含まれない)。
   */
  private ensureRoot(): ShadowRoot | null {
    this.host.ensureMounted();
    const generation = this.host.generation();
    if (generation !== this.generation) {
      this.generation = generation;
      this.styleEl = null;
      this.statsPanel = null;
      this.renderControl = null;
      this.treePanel = null;
      this.canvas = null;
      this.ctx = null;
      this.treeRows.clear();
    }
    const root = this.host.root();
    if (root && !this.styleEl) {
      const style = document.createElement('style');
      style.textContent = DEBUG_OVERLAY_CSS;
      root.appendChild(style);
      this.styleEl = style;
    }
    return root;
  }

  /** 各サーフェスの実 DOM は初回の show* まで作らない (使わないページを汚さない) */
  private ensureCanvas(): HTMLCanvasElement {
    const root = this.ensureRoot();
    if (!this.canvas) {
      this.canvas = el('canvas', 'render-canvas');
      this.ctx = this.canvas.getContext('2d');
      root?.append(this.canvas);
    }
    return this.canvas;
  }

  private ensureStatsPanel(): HTMLDivElement {
    const root = this.ensureRoot();
    if (!this.statsPanel) {
      this.statsPanel = el('div', 'stats');
      root?.append(this.statsPanel);
    }
    return this.statsPanel;
  }

  private ensureRenderControl(): HTMLDivElement {
    const root = this.ensureRoot();
    if (!this.renderControl) {
      this.renderControl = el('div', 'rctl');
      root?.append(this.renderControl);
    }
    return this.renderControl;
  }

  private ensureTreePanel(): HTMLDivElement {
    const root = this.ensureRoot();
    if (!this.treePanel) {
      this.treePanel = el('div', 'tree');
      root?.append(this.treePanel);
    }
    return this.treePanel;
  }

  /** レンダーデバッグ: 再描画した要素群をヒートマップ色で明滅させる */
  flashRenders(entries: { element: Element; heat: number }[]) {
    this.ensureCanvas();
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
    if (!canvas || !ctx) {
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

  /**
   * レンダー記録の統計パネル (再描画ランキング + why-did-render + Page vitals)。
   * 行にホバーすると原因内訳 (state/props/parent/mount) と直近変化の props/hook が見える。
   * 「AI レポートをコピー」で Markdown 分析レポートをクリップボードへ。
   */
  showRenderStats(
    snapshot: RenderSnapshot,
    vitals: VitalsSnapshot,
    opts: { onClose: () => void; buildReport: () => string },
  ) {
    const strings = this.host.strings();
    const statsPanel = this.ensureStatsPanel();
    statsPanel.replaceChildren();
    const titleText = strings.statsTitle.replace('{n}', String(snapshot.commits));
    statsPanel.setAttribute('role', 'dialog');
    statsPanel.setAttribute('aria-label', titleText);

    const head = el('div', 'head');
    const title = el('span', 'ttl', titleText);
    const acts = el('span', 'acts');
    const copyBtn = el('button', 'act', strings.statsCopy);
    copyBtn.addEventListener('click', () => {
      void this.copyText(opts.buildReport()).then((ok) => {
        this.host.toast(ok ? strings.statsCopied : strings.statsCopyFail, 4000);
      });
    });
    const close = el('button', 'x', '×');
    close.title = strings.panelClose;
    close.setAttribute('aria-label', strings.panelClose);
    close.addEventListener('click', () => {
      this.hideRenderStats();
      opts.onClose();
    });
    acts.append(copyBtn, close);
    head.append(title, acts);
    statsPanel.appendChild(head);

    // Page vitals (Closed 環境の Lighthouse 代替。観測できた指標だけをチップ表示)
    if (vitals.metrics.length || vitals.longTasks > 0) {
      const vit = el('div', 'vit');
      vit.append(el('span', 'vlb', strings.vitalsTitle));
      for (const m of vitals.metrics) {
        const cls = m.rating === 'good' ? 'ok' : m.rating === 'needs-improvement' ? 'ni' : 'bad';
        const chip = el('span', `vchip ${cls}`);
        chip.title = m.rating;
        chip.append(el('span', 'vd'), el('span', undefined, `${m.id} ${formatVital(m.id, m.value)}`));
        vit.append(chip);
      }
      if (vitals.longTasks > 0) {
        const chip = el('span', 'vchip');
        chip.append(el('span', undefined, `${strings.vitalsLongTasks} ${vitals.longTasks}`));
        vit.append(chip);
      }
      statsPanel.appendChild(vit);
    }

    const totalRenders = snapshot.stats.reduce((a, s) => a + s.count, 0);
    const summary = el(
      'div',
      'sum',
      strings.statsSummary
        .replace('{renders}', String(totalRenders))
        .replace('{wasted}', String(snapshot.totalWasted))
        .replace('{ms}', snapshot.timingSupported ? snapshot.totalSelfMs.toFixed(1) : '—'),
    );
    statsPanel.appendChild(summary);

    const sub = el(
      'div',
      'sub',
      snapshot.timingSupported ? strings.statsColsSupported : strings.statsColsUnsupported,
    );
    statsPanel.appendChild(sub);

    if (snapshot.stats.length === 0) {
      statsPanel.appendChild(el('div', 'r', strings.statsEmpty));
    } else {
      const hd = el('div', 'r hd');
      hd.append(
        el('span', 'nm', strings.statsColComponent),
        el('span', 'ct', strings.statsColRenders),
        el('span', 'ws', strings.statsColWasted),
        el('span', 'ms', strings.statsColMs),
      );
      statsPanel.appendChild(hd);
    }
    for (const s of snapshot.stats.slice(0, 100)) {
      const row = el('div', 'r');
      row.title = this.causeTooltip(s);
      const nm = el('span', 'nm', s.name);
      const ct = el('span', 'ct', String(s.count));
      const wasted = s.causes.parent;
      const ws = el('span', 'ws' + (wasted > 0 ? ' warn' : ''), wasted > 0 ? String(wasted) : '·');
      const ms = el('span', 'ms', s.selfMs > 0 ? s.selfMs.toFixed(1) : '—');
      row.append(nm, ct, ws, ms);
      statsPanel.appendChild(row);
    }

    if (snapshot.totalWasted > 0) {
      statsPanel.appendChild(el('div', 'foot', strings.statsWastedHint));
    }
    statsPanel.style.display = 'block';
  }

  /** 行ツールチップ: 原因内訳 + 直近で変化した props / hooks */
  private causeTooltip(s: RenderStat): string {
    const strings = this.host.strings();
    const lines: string[] = [];
    const labels: [keyof RenderStat['causes'], string][] = [
      ['state', strings.causeState],
      ['props', strings.causeProps],
      ['parent', strings.causeParent],
      ['mount', strings.causeMount],
      ['other', strings.causeOther],
    ];
    for (const [key, label] of labels) {
      if (s.causes[key] > 0) lines.push(`${label}: ×${s.causes[key]}`);
    }
    if (s.lastChangedProps.length) {
      lines.push(strings.changedPropsHint.replace('{list}', s.lastChangedProps.join(', ')));
    }
    if (s.lastChangedHooks.length) {
      lines.push(
        strings.changedHooksHint.replace(
          '{list}',
          s.lastChangedHooks.map((i) => `#${i}`).join(', '),
        ),
      );
    }
    return lines.join('\n');
  }

  /**
   * クリップボードへコピー (AI レポート用)。navigator.clipboard が使えない
   * ページ (permissions policy / 非フォーカス) は textarea + execCommand へフォールバック。
   */
  private async copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // フォールバックへ
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  hideRenderStats() {
    if (this.statsPanel) this.statsPanel.style.display = 'none';
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
    const renderControl = this.ensureRenderControl();
    renderControl.replaceChildren();
    const status = el('span', 'st');
    const dot = el('span', 'd');
    const label = el(
      'span',
      undefined,
      opts.recording ? this.host.strings().ctrlRecording : opts.title,
    );
    status.append(dot, label);
    const btn = el('button', undefined, opts.toggleLabel);
    btn.addEventListener('click', opts.onToggle);
    renderControl.append(status, btn);
    renderControl.classList.toggle('rec', opts.recording);
    renderControl.classList.add('on');
  }

  hideRenderControl() {
    if (this.renderControl) this.renderControl.classList.remove('on', 'rec');
  }

  /**
   * ビジュアルツリーを描画 (FR-05)。nodes は buildTree/filterTree が返す depth 付き平坦配列。
   * 行 hover → onHoverNode、クリック → onClickNode。owner 用 panel とは別サーフェス。
   */
  showTree(
    nodes: TreeNode[],
    opts: {
      title: string;
      onHoverNode: (node: TreeNode) => void;
      onClickNode: (node: TreeNode) => void;
      onClose: () => void;
    },
  ) {
    const strings = this.host.strings();
    const colors = this.host.settings().colors;
    const treePanel = this.ensureTreePanel();
    treePanel.replaceChildren();
    this.treeRows.clear();
    treePanel.setAttribute('role', 'dialog');
    treePanel.setAttribute('aria-label', opts.title);

    const head = el('div', 'head');
    const title = el('span', undefined, `${opts.title} (${nodes.length})`);
    const close = el('button', 'x', '×');
    close.title = strings.panelClose;
    close.setAttribute('aria-label', strings.panelClose);
    close.addEventListener('click', () => {
      this.hideTree();
      opts.onClose();
    });
    head.append(title, close);
    treePanel.appendChild(head);

    if (nodes.length === 0) {
      const empty = el('div', 'empty', strings.statsEmpty);
      treePanel.appendChild(empty);
    }

    for (const node of nodes) {
      const row = el('div', 'trow');
      row.style.paddingLeft = `${8 + node.depth * 13}px`;
      const dot = el('span', 'dot');
      // 分類は色だけで伝えない (SC 1.4.1)。形状クラスは本体バッジ / owner パネルと共通
      dot.classList.add(shapeClassFor(node.classification));
      dot.style.background = colorFor(node.classification, colors);
      const nm = el('span', 'nm', node.name);
      row.append(dot, nm);
      row.addEventListener('mouseenter', () => opts.onHoverNode(node));
      row.addEventListener('click', () => opts.onClickNode(node));
      treePanel.appendChild(row);
      this.treeRows.set(node.id, row);
    }
    treePanel.style.display = 'block';
  }

  hideTree() {
    if (this.treePanel) this.treePanel.style.display = 'none';
  }

  isTreeOpen(): boolean {
    return !!this.treePanel && this.treePanel.style.display === 'block';
  }

  /** 実 DOM hover → 該当ツリー行へスクロール&一時強調 (FR-07 逆方向) */
  scrollTreeTo(nodeId: number) {
    const row = this.treeRows.get(nodeId);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    for (const r of this.treeRows.values()) r.classList.remove('hl');
    row.classList.add('hl');
  }
}
