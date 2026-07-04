import { getParentComponentElement, inspectElement } from './fiber';
import type { HookState } from './hook';
import { Overlay } from './overlay';
import { DEFAULT_SETTINGS, type InspectInfo, type Settings } from './types';

/**
 * インスペクトモードの状態機械 (FR-01〜04)。
 * 有効中は click / pointer 系を capture で握りつぶし、ページ誤操作を防ぐ。
 */
export class Inspector {
  private enabled = false;
  private settings: Settings = DEFAULT_SETTINGS;
  private rafId = 0;
  private currentElement: Element | null = null;
  private currentInfo: InspectInfo | null = null;
  /** ↑ で遡った子要素の履歴 (↓ で戻る) */
  private navStack: Element[] = [];
  /** キーボード選択中はマウスの微動でホバー追従に戻さないためのフラグ */
  private keyboardNav = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(
    private hookState: HookState,
    private overlay: Overlay,
  ) {}

  applySettings(settings: Settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.overlay.updateSettings(this.settings);
  }

  toggle() {
    this.enabled ? this.disable() : this.enable();
  }

  private enable() {
    this.enabled = true;
    window.addEventListener('pointermove', this.onPointerMove, true);
    for (const type of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
      window.addEventListener(type, this.onIntercept, true);
    }
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.onScroll, true);

    if (!this.hookState.devMode) {
      this.overlay.toast(
        'Inspect ON — dev ビルド未検出のためセーフモード (名前のみ表示 / Esc で解除)',
        4000,
      );
    } else {
      this.overlay.toast(
        'Inspect ON — クリック: エディタ / Alt+クリック: owner ツリー / ↑↓: 親子移動 / Esc: 解除',
        4000,
      );
    }
  }

  private disable() {
    this.enabled = false;
    window.removeEventListener('pointermove', this.onPointerMove, true);
    for (const type of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
      window.removeEventListener(type, this.onIntercept, true);
    }
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('scroll', this.onScroll, true);
    this.overlay.hideAll();
    this.currentElement = null;
    this.currentInfo = null;
    this.navStack = [];
    this.keyboardNav = false;
    this.overlay.toast('Inspect OFF');
  }

  private select(element: Element) {
    this.currentElement = element;
    this.currentInfo = inspectElement(element, this.settings.muiSkip);
    if (this.currentInfo) {
      this.overlay.show(element, this.currentInfo);
    } else {
      this.overlay.hideHighlight();
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.overlay.containsTarget(event.target)) return;
    // キーボードで親子選択中は、マウスの微動 (16px 未満) でホバー追従に戻さない
    if (this.keyboardNav) {
      const distance = Math.hypot(
        event.clientX - this.lastPointer.x,
        event.clientY - this.lastPointer.y,
      );
      if (distance < 16) return;
      this.keyboardNav = false;
      this.navStack = [];
    }
    this.lastPointer = { x: event.clientX, y: event.clientY };
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element || element === this.currentElement) return;
      this.select(element);
    });
  };

  private onIntercept = (event: Event) => {
    // パネル内クリックは通す (エディタジャンプ行の操作)
    if (this.overlay.containsTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;

    const mouse = event as MouseEvent;
    if (!this.currentInfo) return;

    if (mouse.altKey) {
      // Alt+クリック: owner チェーンパネル (FR-04)
      this.overlay.showChainPanel(this.currentInfo, mouse.clientX, mouse.clientY);
      return;
    }
    if (this.overlay.isChainPanelOpen()) {
      this.overlay.hideChainPanel();
      return;
    }
    if (this.currentInfo.jumpTarget) {
      this.overlay.openEditor(this.currentInfo.jumpTarget);
    } else {
      this.overlay.toast(
        this.currentInfo.devMode
          ? 'ソース位置を解決できませんでした (React 19 では babel plugin なしの場合があります)'
          : 'production ビルドのためソースジャンプは利用できません',
      );
    }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.overlay.isChainPanelOpen()) {
        this.overlay.hideChainPanel();
      } else {
        this.disable();
      }
      return;
    }
    // ↑: 親コンポーネントへ / ↓: 遡った履歴を子へ戻る (FR-04 補完)
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.currentElement) return;
      const parent = getParentComponentElement(this.currentElement);
      if (parent) {
        this.navStack.push(this.currentElement);
        this.keyboardNav = true;
        this.select(parent);
      } else {
        this.overlay.toast('これ以上外側のコンポーネントはありません');
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const child = this.navStack.pop();
      if (child?.isConnected) {
        this.keyboardNav = true;
        this.select(child);
      }
    }
  };

  private onScroll = () => {
    // スクロール中は座標がずれるため一旦隠す (次の pointermove で再表示)
    this.overlay.hideHighlight();
    this.currentElement = null;
    this.navStack = [];
    this.keyboardNav = false;
  };
}
