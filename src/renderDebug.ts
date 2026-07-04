import type { HookState } from './hook';
import type { Overlay } from './overlay';
import { RenderTracker } from './renderTracker';
import { DEFAULT_STRINGS, type UiStrings } from './types';

/**
 * レンダーデバッガ (React DevTools Profiler の軽量版):
 * - onCommitFiberRoot を購読し、各コミットで再描画した DOM をヒートマップ明滅
 * - 記録モードでコンポーネント別の再描画回数・自己時間を集計しランキング表示
 *
 * コミットは高頻度で発生しうるため、走査は requestAnimationFrame で束ねて
 * 対象ページのフレーム落ちを避ける (NFR-01)。
 */
export class RenderDebugger {
  private enabled = false;
  private tracker = new RenderTracker();
  private unsubscribe: (() => void) | null = null;
  private pendingRoots = new Set<unknown>();
  private processRaf = 0;
  private warnedUnsupported = false;

  constructor(
    private hookState: HookState,
    private overlay: Overlay,
    private strings: UiStrings = DEFAULT_STRINGS,
  ) {}

  toggle() {
    this.enabled ? this.disable() : this.enable();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private enable() {
    this.enabled = true;
    this.tracker.reset();
    this.unsubscribe = this.hookState.onCommit(this.onCommit);
    window.addEventListener('keydown', this.onKeyDown, true);
    this.overlay.toast(
      this.hookState.devMode ? this.strings.renderOn : this.strings.renderOnNoDev,
      4000,
    );
  }

  private disable() {
    this.enabled = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener('keydown', this.onKeyDown, true);
    cancelAnimationFrame(this.processRaf);
    this.processRaf = 0;
    this.pendingRoots.clear();
    this.tracker.stopRecording();
    this.overlay.clearRenderFlashes();
    this.overlay.hideRenderStats();
    this.overlay.toast(this.strings.renderOff);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    // フォーム入力中の R などは無視 (可視化モードはページ操作を妨げないため)
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      this.toggleRecording();
    } else if (event.key === 'Escape') {
      this.disable();
    }
  };

  private onCommit = (root: unknown) => {
    this.pendingRoots.add(root);
    if (!this.processRaf) {
      this.processRaf = requestAnimationFrame(this.flush);
    }
  };

  private flush = () => {
    this.processRaf = 0;
    const roots = [...this.pendingRoots];
    this.pendingRoots.clear();
    const flashes: { element: Element; heat: number }[] = [];
    let supported = false;
    for (const root of roots) {
      const result = this.tracker.handleCommit(root);
      flashes.push(...result.flashes);
      supported = supported || result.supported;
    }
    if (flashes.length) this.overlay.flashRenders(flashes);
    if (!supported && !this.warnedUnsupported && this.hookState.devMode) {
      this.warnedUnsupported = true;
    }
  };

  /** 記録モードのトグル (R キー)。停止時にランキングパネルを開く */
  toggleRecording() {
    if (!this.enabled) return;
    if (this.tracker.isRecording()) {
      this.tracker.stopRecording();
      this.overlay.showRenderStats(
        this.tracker.snapshot(),
        this.hookState.devMode,
        () => this.tracker.reset(),
      );
    } else {
      this.overlay.hideRenderStats();
      this.tracker.startRecording();
      this.overlay.toast(this.strings.recordStart);
    }
  }
}
