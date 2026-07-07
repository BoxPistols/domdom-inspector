import type { HookState } from './hook';
import type { Overlay } from './overlay';
import { normalizeRecordKey } from './recordKey';
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
  /** 描画のみ rAF で束ねる。走査 (記録カウント) はコミットごとに即実行する */
  private pendingFlashes: { element: Element; heat: number }[] = [];
  private flashRaf = 0;
  /** 記録トグルキー (設定で変更可、既定 'r') */
  private recordKey = 'r';

  constructor(
    private hookState: HookState,
    private overlay: Overlay,
    private strings: UiStrings = DEFAULT_STRINGS,
  ) {}

  applySettings(recordKey: string) {
    // 単一キーのみ受け付ける (空・複数文字は既定 'r' へフォールバック)
    this.recordKey = normalizeRecordKey(recordKey, 'r');
  }

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
    this.renderControl();
    this.overlay.toast(
      this.hookState.devMode ? this.strings.renderOn : this.strings.renderOnNoDev,
      4000,
    );
  }

  /** 常設コントロールを現在状態で描画 (記録中はボタンが停止に切替) */
  private renderControl() {
    const recording = this.tracker.isRecording();
    const base = recording ? this.strings.ctrlStop : this.strings.ctrlRecord;
    this.overlay.showRenderControl({
      title: this.strings.ctrlTitle,
      recording,
      toggleLabel: `${base} (${this.recordKey.toUpperCase()})`,
      onToggle: () => this.toggleRecording(),
    });
  }

  private disable() {
    this.enabled = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener('keydown', this.onKeyDown, true);
    cancelAnimationFrame(this.flashRaf);
    this.flashRaf = 0;
    this.pendingFlashes = [];
    this.tracker.stopRecording();
    this.overlay.clearRenderFlashes();
    this.overlay.hideRenderStats();
    this.overlay.hideRenderControl();
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
    if (event.key.length === 1 && event.key.toLowerCase() === this.recordKey) {
      event.preventDefault();
      this.toggleRecording();
    }
  };

  /** Esc 処理 (content script の中央ハンドラから呼ぶ)。有効なら解除して true */
  onEscape(): boolean {
    if (!this.enabled) return false;
    this.disable();
    return true;
  }

  private onCommit = (root: unknown) => {
    // コミットごとに即走査 (記録の再描画回数を過少計上しないため #4)。
    // Set で root を束ねると同一 root の複数コミットが 1 回に潰れて数が合わなくなる。
    const { flashes } = this.tracker.handleCommit(root);
    if (flashes.length) {
      this.pendingFlashes.push(...flashes);
      // 明滅の canvas 描画だけは rAF で束ねてフレーム落ちを避ける
      if (!this.flashRaf) this.flashRaf = requestAnimationFrame(this.flushFlashes);
    }
  };

  private flushFlashes = () => {
    this.flashRaf = 0;
    const flashes = this.pendingFlashes;
    this.pendingFlashes = [];
    if (flashes.length) this.overlay.flashRenders(flashes);
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
    // ボタン表示 (記録⇔停止) と REC インジケータを最新状態に更新
    this.renderControl();
  }
}
