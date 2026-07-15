import { getParentComponentElement, inspectElement } from './fiber';
import type { HookState } from './hook';
import { Overlay } from './overlay';
import { DEFAULT_SETTINGS, DEFAULT_STRINGS, type InspectInfo, type Settings, type UiStrings } from './types';

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
    private strings: UiStrings = DEFAULT_STRINGS,
  ) {}

  applySettings(settings: Settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.overlay.updateSettings(this.settings);
  }

  toggle() {
    this.enabled ? this.disable() : this.enable();
  }

  /** 冪等な ON。popup の「サイト有効化 → 自動 ON」導線から呼ばれる (既に ON なら何もしない) */
  enableOnly() {
    if (!this.enabled) this.enable();
  }

  private enable() {
    this.enabled = true;
    window.addEventListener('pointermove', this.onPointerMove, true);
    for (const type of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
      window.addEventListener(type, this.onIntercept, true);
    }
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.onScroll, true);

    this.overlay.toast(
      this.hookState.devMode ? this.strings.inspectOn : this.strings.inspectOnSafe,
      4000,
    );
    this.overlay.showModePill(this.strings.inspectPill, this.strings.inspectPillClose, () =>
      this.disable(),
    );
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
    this.overlay.hideModePill();
    this.currentElement = null;
    this.currentInfo = null;
    this.navStack = [];
    this.keyboardNav = false;
    this.overlay.toast(this.strings.inspectOff);
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
    // パネル内クリックは通す
    if (this.overlay.containsTarget(event.target)) return;
    // 初回リリースはデザイン計測のみ: クリックのページ側動作だけ抑止する。
    // エディタジャンプ (issue #6) / owner チェーンパネル (issue #5) は将来化 (配線外し)。
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /**
   * Esc 処理。owner パネルが開いていれば閉じ、そうでなければモード解除。
   * 何か消費したら true。Esc は content script の中央ハンドラが所有し、
   * インスペクタ→レンダーの優先順で 1 度に 1 つだけ閉じる (両モード同時 ON の競合回避)。
   */
  onEscape(): boolean {
    if (this.overlay.isChainPanelOpen()) {
      this.overlay.hideChainPanel();
      return true;
    }
    if (this.enabled) {
      this.disable();
      return true;
    }
    return false;
  }

  private onKeyDown = (event: KeyboardEvent) => {
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
        this.overlay.toast(this.strings.noOuterComponent);
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
