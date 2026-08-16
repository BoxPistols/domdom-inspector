import { inspectElement } from '../fiber';
import type { HookState } from '../hook';
import type { Overlay } from '../overlay';
import { OverlayDebugSurfaces } from './overlayDebug';
import {
  buildNodeElementMap,
  buildTree,
  filterTree,
  resolveNodeIdFromElement,
  type NodeElementMap,
  type TreeNode,
} from './tree';
import { DEFAULT_SETTINGS, DEFAULT_STRINGS, type Settings, type UiStrings } from '../types';

/**
 * ビジュアル・コンポーネントツリーのモード制御 (FR-05/06/07)。
 * 既存モード規約 (enable/disable/toggle/onEscape/applySettings, DI) に揃える。
 * - enable: buildTree → filterTree → overlay.showTree。commit ごとに rAF で再構築。
 * - 行 hover → 実 DOM ハイライト、行クリック → エディタジャンプ。
 * - 実 DOM hover → 該当ツリー行へスクロール (双方向連動の逆方向)。
 */
export class TreeView {
  private enabled = false;
  private settings: Settings = DEFAULT_SETTINGS;
  private nodeMap: NodeElementMap | null = null;
  /** フィルタ前の全ノード (DOM → 行 の解決に使う) */
  private allById = new Map<number, TreeNode>();
  /** 表示中の (フィルタ後の) ノード id */
  private visibleIds = new Set<number>();
  private unsubscribe: (() => void) | null = null;
  private refreshRaf = 0;
  private hoverRaf = 0;

  /** ツリーパネルの描画は OverlayDebugSurfaces が持つ (issue #17 で本体から分離) */
  private surfaces: OverlayDebugSurfaces;

  constructor(
    private hookState: HookState,
    private overlay: Overlay,
    private strings: UiStrings = DEFAULT_STRINGS,
  ) {
    this.surfaces = new OverlayDebugSurfaces(overlay.surfaceHost());
  }

  applySettings(settings: Settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle() {
    this.enabled ? this.disable() : this.enable();
  }

  private enable() {
    // production ビルドでは React が名前を minify するため、ツリーは "0e" "je" "Anonymous" が
    // 1000 行並ぶだけで判読不能になる。役に立たないものを開いて時間を使わせるより、
    // 開かずに理由を言う方が誠実 (実機フィードバックによる判断)。
    if (!this.hookState.devMode) {
      this.overlay.toast(this.strings.treeUnavailableProd, 5000);
      return;
    }
    this.enabled = true;
    this.refresh();
    this.unsubscribe = this.hookState.onCommit(this.scheduleRefresh);
    window.addEventListener('pointermove', this.onDomHover, true);
    this.overlay.toast(this.strings.treeOn, 4000);
  }

  private disable() {
    this.enabled = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener('pointermove', this.onDomHover, true);
    cancelAnimationFrame(this.refreshRaf);
    cancelAnimationFrame(this.hoverRaf);
    this.refreshRaf = 0;
    this.hoverRaf = 0;
    this.surfaces.hideTree();
    this.overlay.hideHighlight();
    this.overlay.toast(this.strings.treeOff);
  }

  /** Esc 処理 (content script の中央ハンドラから呼ぶ) */
  onEscape(): boolean {
    if (!this.enabled) return false;
    this.disable();
    return true;
  }

  private refresh() {
    // div/span 等の host 要素は「表示から」隠す。含めると 1000 ノード超で判読できない (FR-06)。
    // ただし要素対応マップは **フィルタ前の全ノード** から作る — host ノードだけが
    // hostElement を持つため、フィルタ後から作ると対応が空になり双方向連動が死ぬ。
    const all = buildTree(this.hookState);
    const filtered = filterTree(all, { hideHostComponents: true });
    this.nodeMap = buildNodeElementMap(all);
    this.allById = new Map(all.map((n) => [n.id, n]));
    this.visibleIds = new Set(filtered.map((n) => n.id));
    this.surfaces.showTree(filtered, {
      title: this.strings.treeTitle,
      onHoverNode: (node) => this.highlightNode(node),
      onClickNode: (node) => this.jumpToNode(node),
      onClose: () => this.disable(),
    });
  }

  // commit は高頻度なので rAF で束ねて再構築 (NFR-01)
  private scheduleRefresh = () => {
    if (this.refreshRaf) return;
    this.refreshRaf = requestAnimationFrame(() => {
      this.refreshRaf = 0;
      if (this.enabled) this.refresh();
    });
  };

  /** ツリー行 hover → 対応 DOM 要素をハイライト */
  private highlightNode(node: TreeNode) {
    const el = this.nodeMap?.nodeToElement.get(node.id);
    if (!el || !el.isConnected) {
      this.overlay.hideHighlight();
      return;
    }
    const info = inspectElement(el, this.settings.muiSkip);
    if (info) this.overlay.show(el, info);
  }

  /** ツリー行クリック → その要素のソースをエディタで開く (連携 OFF 時は何もしない) */
  private jumpToNode(node: TreeNode) {
    if (!this.settings.openEditorOnClick) return;
    const el = this.nodeMap?.nodeToElement.get(node.id);
    if (!el) return;
    const info = inspectElement(el, this.settings.muiSkip);
    if (info?.jumpTarget) this.overlay.openEditor(info.jumpTarget);
  }

  /** 非表示ノードに解決されたとき、表示されている最近傍の祖先 id へ繰り上げる */
  private nearestVisible(id: number | null): number | null {
    let cur = id;
    while (cur !== null) {
      if (this.visibleIds.has(cur)) return cur;
      cur = this.allById.get(cur)?.parentId ?? null;
    }
    return null;
  }

  /** 実 DOM hover → 最近傍ノードを解決し、ツリーの該当行へスクロール&強調 (逆方向) */
  private onDomHover = (event: PointerEvent) => {
    if (this.overlay.containsTarget(event.target)) return; // ツリーパネル上は無視
    cancelAnimationFrame(this.hoverRaf);
    this.hoverRaf = requestAnimationFrame(() => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || !this.nodeMap) return;
      const id = resolveNodeIdFromElement(el, this.nodeMap.elementToNode);
      // 解決先が host ノード等で非表示なら、表示されている最近傍の祖先まで繰り上げる
      const visible = this.nearestVisible(id);
      if (visible !== null) this.surfaces.scrollTreeTo(visible);
    });
  };
}
