import { buildEditorUrl } from './editor';
import type { Classification, InspectInfo, Settings } from './types';

/**
 * 対象ページと干渉しない Shadow DOM 隔離オーバーレイ (v3.0 §7)。
 * ハイライト枠 + バッジは pointer-events: none、owner チェーンパネルのみ操作可能。
 */
export class Overlay {
  private host: HTMLElement | null = null;
  private box!: HTMLDivElement;
  private badge!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private settings: Settings) {}

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
        max-width: 480px;
        padding: 6px 10px;
        border-radius: 6px;
        background: rgba(20, 20, 24, 0.92);
        color: #fff;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badge .name { font-weight: 700; }
      .badge .meta { opacity: 0.75; }
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
    root.append(this.box, this.badge, this.panel, this.toastEl);
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

    const propsText = Object.entries(info.props)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    const file = info.jumpTarget
      ? `${info.jumpTarget.fileName.split('/').pop()}:${info.jumpTarget.lineNumber}`
      : info.devMode
        ? 'source unavailable'
        : 'production build (safe mode)';
    this.badge.replaceChildren();
    const name = document.createElement('span');
    name.className = 'name';
    name.style.color = color;
    name.textContent = `<${info.name}>`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const metaParts = [info.internalName, propsText, file].filter(Boolean).join(' · ');
    meta.textContent = ` ${metaParts}`;
    this.badge.append(name, meta);

    const badgeTop = rect.top > 40 ? rect.top - 34 : rect.bottom + 6;
    Object.assign(this.badge.style, {
      display: 'block',
      left: `${Math.max(4, rect.left)}px`,
      top: `${badgeTop}px`,
    });
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
    title.textContent = 'Rendered by (クリックでエディタへ)';
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
