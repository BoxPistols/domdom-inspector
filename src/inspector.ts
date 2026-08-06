import { detectReactOnPage, getParentComponentElement, inspectElement } from './fiber';
import type { HookState } from './hook';
import { Overlay } from './overlay';
import { isBundledSource } from './source';
import {
  DEFAULT_SETTINGS,
  DEFAULT_STRINGS,
  type InspectInfo,
  type Settings,
  type UiStrings,
} from './types';

/**
 * ↑ で選ぶ「1 つ外側」の要素を返す。React ではコンポーネント親 (wrapper を読み飛ばした
 * host)、Fiber が無い / コンポーネント親が尽きた場合は素の DOM 親へフォールバックする。
 * これにより非 React な HTML/CSS サイトでも親要素をたどれる (design 計測は React 非依存)。
 * componentParent は DI (テスト時にモック可能)。
 */
export function resolveOuterElement(
  element: Element,
  componentParent: (el: Element) => Element | null,
): Element | null {
  // shadow root の内側では parentElement が null になる (境界で行き止まる)。
  // その場合はホスト要素へ抜ける = 利用者から見た「1 つ外側」と一致する
  return componentParent(element) ?? element.parentElement ?? shadowHostOf(element);
}

/** element が shadow root の中にあれば、そのホスト要素 */
function shadowHostOf(element: Element): Element | null {
  const root = element.getRootNode?.();
  return root && root !== document && 'host' in root
    ? ((root as ShadowRoot).host ?? null)
    : null;
}

/**
 * カーソル直下の**最も内側**の要素まで shadow root を貫通して降りる。
 *
 * `document.elementFromPoint` は shadow 境界で止まりホスト要素を返すため、これを入れないと
 * Web Components のページで**カーソル下の要素ではなくホストの計測値を出す** (利用者には
 * 区別がつかないので、欠測ではなく誤答になる)。
 *
 * closed shadow root は仕様上外から辿れないのでホストで止まる。これは限界であって誤りでは
 * ない (ホストの値を、ホストの値として出す)。深さ上限は病的な入れ子での暴走防止。
 */
export function drillToInnermost(element: Element, x: number, y: number, maxDepth = 16): Element {
  let current = element;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const root = current.shadowRoot;
    if (!root) return current;
    const inner = root.elementFromPoint?.(x, y) ?? null;
    // 自分自身が返る / 何も無い = これ以上内側は無い
    if (!inner || inner === current) return current;
    current = inner;
  }
  return current;
}

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
    window.addEventListener('scroll', this.onViewportChange, true);
    // resize / ズームでも枠が旧サイズのまま残るため同じ扱いにする
    window.addEventListener('resize', this.onViewportChange, true);

    // **3 状態を区別する。** 以前は devMode の 2 分岐で、React が無い素の HTML ページでも
    // 「本番ビルドだから出ない」と説明していた (理由が嘘)。
    // フックは自分から設置しない (React DevTools を沈黙させるため) ので、piggyback できた
    // ときだけ renderers が埋まる。空なら DOM の Fiber から判定する
    const fromHook = this.hookState.renderers.size > 0;
    const { hasReact, devMode } = fromHook
      ? { hasReact: true, devMode: this.hookState.devMode }
      : detectReactOnPage();
    this.overlay.toast(
      hasReact
        ? devMode
          ? this.strings.inspectOn
          : this.strings.inspectOnSafe
        : this.strings.inspectOnNoReact,
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
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange, true);
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
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (!hit) return;
      // shadow root を貫通してカーソル直下の要素まで降りる (ホストの値を誤って出さない)
      const element = drillToInnermost(hit, event.clientX, event.clientY);
      if (element === this.currentElement) return;
      this.select(element);
    });
  };

  /**
   * 座標から対象を引き直す。**クリック時に必ず通す**: ホバー時点の選択は
   * スクロール・DOM 差し替え・resize で実際のカーソル下と食い違いうる。
   * 一致していれば何もしない (select は currentElement 比較で早期 return する)。
   */
  private resyncToPointer(x: number, y: number) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return;
    if (this.overlay.containsTarget(hit)) return;
    const element = drillToInnermost(hit, x, y);
    if (element !== this.currentElement) this.select(element);
  }

  private onIntercept = (event: Event) => {
    // パネル内クリック / 自前のエディタ起動アンカーは通す (scheme を開かせる)
    if (this.overlay.containsTarget(event.target)) return;
    if (event.target instanceof Element && event.target.closest('[data-domdom-editor]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // 通常クリックはページ誤操作の抑止だけ (デザイン検査に専念)。
    if (event.type !== 'click') return;
    const me = event as MouseEvent;
    // **押した瞬間の座標から対象を引き直す。** hover 時の情報をそのまま使うと、
    // スクロール後 / 選択要素が DOM から消えた後に「別要素のソース」を開く誤答になる。
    // 現在の選択と一致していれば select は走らない (無駄な再計測をしない)
    this.resyncToPointer(me.clientX, me.clientY);
    // Alt+Click: 描画元 (owner) の一覧を出し、行クリックでそのファイルをエディタで開く。
    // モード ON のトーストで案内している操作なので、必ずここで応答する
    // (以前はハンドラが無く、preventDefault だけが効いて完全な無反応になっていた)。
    if (me.altKey) {
      if (this.currentInfo) this.overlay.showChainPanel(this.currentInfo, me.clientX, me.clientY);
      return;
    }
    // Cmd(Mac)/Ctrl(Win)+Click で該当ソースをエディタで開く (dev の実ソースのみ)
    if (!me.metaKey && !me.ctrlKey) return;
    this.openEditorFor(this.currentInfo);
  };

  /**
   * 右クリックメニュー「この要素を検査」: モードを ON にして対象要素を選択する。
   * モードが OFF でも 1 アクションで結果まで到達させる (押して何も起きないを作らない)。
   */
  inspectAt(element: Element) {
    if (!this.enabled) this.enable();
    this.keyboardNav = false;
    this.navStack = [];
    this.select(element);
  }

  /** 右クリックメニュー「ソースをエディタで開く」: モード ON を必要としない */
  openEditorAt(element: Element) {
    this.openEditorFor(inspectElement(element, this.settings.muiSkip));
  }

  /**
   * ジャンプ可能ならエディタを開き、**不可なら理由をトーストで言う**。
   * 黙って何もしないと「押しても無反応」= 一番わかりにくい壊れ方になる。
   */
  private openEditorFor(info: InspectInfo | null) {
    const jt = info?.jumpTarget;
    if (jt && !isBundledSource(jt.fileName)) {
      this.overlay.openEditor(jt);
      return;
    }
    this.overlay.toast(this.explainNoJump(info));
  }

  /** ジャンプできない理由を実状態から選ぶ (取り違えると「理由が嘘」になる) */
  private explainNoJump(info: InspectInfo | null): string {
    if (!info) return this.strings.jumpUnresolved;
    // 素の DOM 要素はソースファイルが原理的に存在しない (production とは別の理由)
    if (!info.isReact) return this.strings.noSourceDom;
    if (!info.devMode) return this.strings.jumpProd;
    // dev だがバンドル出力 (ハッシュ付きチャンク) を指している
    if (info.jumpTarget) return this.strings.sourceMinified;
    return this.strings.jumpUnresolved;
  }

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
      const parent = resolveOuterElement(this.currentElement, getParentComponentElement);
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

  /**
   * スクロール / resize で座標がずれたら一旦隠す (次の pointermove で再表示)。
   *
   * **currentInfo も必ず落とす。** 以前は currentElement だけ落として currentInfo を
   * 残していたため、ホイールスクロール直後の ⌘/Ctrl+Click が「スクロール前にホバーして
   * いた要素」のソースを開いた (実測で 100% 再現)。ホイールでは Chrome が pointermove を
   * 出さないので再同期の機会が無く、タイミング依存ではなく決定論的な誤答だった。
   */
  private onViewportChange = () => {
    this.overlay.hideHighlight();
    this.currentElement = null;
    this.currentInfo = null;
    this.navStack = [];
    this.keyboardNav = false;
  };
}
