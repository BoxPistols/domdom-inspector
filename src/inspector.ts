import { winningRuleRef } from './cssVars';
import { detectReactOnPage, getParentComponentElement, inspectElement } from './fiber';
import type { HookState } from './hook';
import { Overlay } from './overlay';
import { resolveFirstAuthored } from './openInEditor';
import { isBundledSource, looksLocalDev } from './source';
import { resolveSourceAttr } from './sourceAttr';
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

/**
 * ↑↓ を奪ってはいけない対象 (テキスト入力中のカーソル移動・選択肢移動)。
 * インスペクト中でもページのフォーム操作は生かす。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target instanceof HTMLElement && target.isContentEditable;
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
 * 選択中の要素を測り直す最小間隔 (ms)。テーマ切替のトランジション中は style/class の
 * 変化が毎フレーム飛んでくるため、素直に測り直すとホバー追従の 60fps を壊す (issue #19)。
 */
export const LIVE_RESYNC_MS = 150;

/**
 * live 追従の待ち時間を決める純ロジック。直前の測り直しから `interval` 未満なら
 * 残り時間だけ待ち、以上経っていれば 0 (即座)。
 *
 * **戻り値は必ず 0〜interval に収める。** 素朴に `interval - (now - lastSync)` と書くと、
 * システム時計が巻き戻ったとき (NTP 補正・スリープ復帰) に interval より長い待ちが出て、
 * バッジが数分止まったように見える。
 */
export function liveResyncDelay(now: number, lastSync: number, interval: number): number {
  return Math.max(0, Math.min(interval, lastSync + interval - now));
}

/**
 * Inspector の生成オプション。**フレーム構成のために要る** (issue #14)。
 * content script は全フレームに注入されるため、モードピルやトーストを各フレームが出すと
 * iframe の数だけ重複し、しかも「どのピルの ✕ を押せば全部消えるのか」が分からなくなる。
 */
export interface InspectorOptions {
  /**
   * モードピルと ON/OFF トーストを出すか。子フレームでは false にする
   * (計測バッジ自体は各フレームで出す — そのフレームの要素はそのフレームでしか測れない)。
   */
  announce?: boolean;
  /**
   * ON/OFF が実際に変化したときに呼ばれる。呼び出し側 (content script) がこれを使って
   * **同じタブの全フレームへ同じ状態を配る**ことで、フレームごとに状態が食い違う
   * (= Esc で親だけ OFF になり iframe 内のクリックが死ぬ) 現象を構造的に消す。
   */
  onStateChange?: (enabled: boolean) => void;
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
  // ---- 選択中の要素の live 追従 (issue #19) ----
  private liveMutation: MutationObserver | null = null;
  private liveResize: ResizeObserver | null = null;
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLiveSync = 0;

  constructor(
    private hookState: HookState,
    private overlay: Overlay,
    private strings: UiStrings = DEFAULT_STRINGS,
    private options: InspectorOptions = {},
  ) {}

  applySettings(settings: Settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.overlay.updateSettings(this.settings);
  }

  toggle() {
    this.enabled ? this.disable() : this.enable();
  }

  /** 現在 ON か。呼び出し側が状態を配る (フレーム間同期) ために必要 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** 冪等な ON。popup の「サイト有効化 → 自動 ON」導線から呼ばれる (既に ON なら何もしない) */
  enableOnly() {
    if (!this.enabled) this.enable();
  }

  /**
   * 冪等な OFF。**フレーム間同期の要** (issue #14)。
   * 既に OFF なら何もしない = 何度配っても位相が反転しないので、
   * 「どこかのフレームで Esc / ピルの ✕ が押されたら全フレームを OFF」を安全に実現できる。
   */
  disableOnly() {
    if (this.enabled) this.disable();
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
    // **告知は 1 フレームだけ** (既定 = トップ)。子フレームでも出すと iframe の数だけ
    // ピルとトーストが重なり、終了導線がどれなのか読めなくなる (issue #14)
    if (this.options.announce !== false) {
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
    this.options.onStateChange?.(true);
  }

  private disable() {
    this.enabled = false;
    // **pointermove が積んだ未実行の rAF を必ず捨てる。** 捨てないと hideAll() の後に
    // rAF が select() → show() を実行し、モード OFF なのに枠とバッジがリロードまで
    // 残る (リスナは解除済みなので以後更新も消去もされない。実測で 1/1 再現)
    cancelAnimationFrame(this.rafId);
    // 選択中要素の監視も必ず外す。残すと OFF 後にコールバックが枠を描き直す
    this.stopObservingLive();
    window.removeEventListener('pointermove', this.onPointerMove, true);
    for (const type of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
      window.removeEventListener(type, this.onIntercept, true);
    }
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange, true);
    this.overlay.hideAll();
    // ピルは announce 側のフレームしか持たない (出していないものを消しに行かない)
    if (this.options.announce !== false) this.overlay.hideModePill();
    this.currentElement = null;
    this.currentInfo = null;
    this.navStack = [];
    this.keyboardNav = false;
    if (this.options.announce !== false) this.overlay.toast(this.strings.inspectOff);
    this.options.onStateChange?.(false);
  }

  private select(element: Element) {
    this.currentElement = element;
    this.currentInfo = inspectElement(element, this.settings.muiSkip);
    this.lastLiveSync = Date.now();
    this.observeLive(element);
    if (this.currentInfo) {
      this.overlay.show(element, this.currentInfo);
    } else {
      this.overlay.hideHighlight();
    }
  }

  /**
   * 選択中の要素の変化を監視する (issue #19)。マウスを動かさずに見ている間に
   * ページ側がスタイルを書き換えても、バッジが古い値のまま残らないようにする。
   *
   * 見る対象を 3 つに絞っている (全 DOM の subtree 監視はホバーの 60fps を壊す):
   * 1. 対象自身の style/class — JS による直接の書き換え
   * 2. html / body の style/class — テーマ切替。**対象自身は何も変わらない**が、
   *    継承値と CSS 変数が入れ替わるので測り直しが要る (実際に一番よく起きる形)
   * 3. 対象のサイズ — 折返し・コンテンツ変化・@media 跨ぎ (枠が旧サイズのまま残る)
   *
   * 位置だけが動く変化 (兄弟のレイアウトシフト) は見ていない。監視コストに見合わないため、
   * 次の pointermove / scroll / クリックでの引き直しに任せる。
   */
  private observeLive(element: Element) {
    this.stopObservingLive();
    if (typeof MutationObserver !== 'undefined') {
      this.liveMutation = new MutationObserver(this.onLiveChange);
      const attrs = { attributes: true, attributeFilter: ['style', 'class'] };
      this.liveMutation.observe(element, attrs);
      for (const host of [document.documentElement, document.body]) {
        if (host && host !== element) this.liveMutation.observe(host, attrs);
      }
    }
    if (typeof ResizeObserver !== 'undefined') {
      // ResizeObserver は observe した直後に必ず 1 回呼ばれる。それは「変化」ではないので
      // 捨てる (捨てないと選択のたびに無駄な測り直しが 1 回走る)
      let initial = true;
      this.liveResize = new ResizeObserver(() => {
        if (initial) {
          initial = false;
          return;
        }
        this.onLiveChange();
      });
      this.liveResize.observe(element);
    }
  }

  private stopObservingLive() {
    this.liveMutation?.disconnect();
    this.liveMutation = null;
    this.liveResize?.disconnect();
    this.liveResize = null;
    clearTimeout(this.liveTimer);
    this.liveTimer = undefined;
  }

  /** 変化の通知。連続変化 (トランジション等) は 1 回にまとめる */
  private onLiveChange = () => {
    if (!this.enabled || !this.currentElement) return;
    // 既に予約済みなら何もしない = 変化が続く間もタイマーは 1 本だけ
    if (this.liveTimer !== undefined) return;
    const delay = liveResyncDelay(Date.now(), this.lastLiveSync, LIVE_RESYNC_MS);
    this.liveTimer = setTimeout(() => {
      this.liveTimer = undefined;
      this.resyncSelected();
    }, delay);
  };

  /**
   * 選択中の要素をその場で測り直す (**選択は動かさない**)。
   * ページから外れていたら枠ごと畳む — 消えた要素の枠を残すのは誤答になる。
   */
  private resyncSelected() {
    const element = this.currentElement;
    if (!this.enabled || !element) return;
    this.lastLiveSync = Date.now();
    if (!element.isConnected) {
      this.currentElement = null;
      this.currentInfo = null;
      this.stopObservingLive();
      this.overlay.hideHighlight();
      return;
    }
    this.currentInfo = inspectElement(element, this.settings.muiSkip);
    if (this.currentInfo) this.overlay.show(element, this.currentInfo);
    else this.overlay.hideHighlight();
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
      // 同一要素なら何もしない。**ここで測り直さない**のは 60fps を守るため —
      // 選択中の style/class 変化は observeLive() の監視が拾う (issue #19)
      if (element === this.currentElement) return;
      this.select(element);
    });
  };

  /**
   * 座標から対象を引き直す。**クリック時に必ず通す**: ホバー時点の選択は
   * スクロール・DOM 差し替え・resize で実際のカーソル下と食い違いうる。
   *
   * **同一要素でも再計測する。** ホバー中に JS がその要素のスタイルを書き換えても
   * pointermove は同一要素で早期 return するため、バッジは古い値のまま残る。
   * せめて「クリックした瞬間」は必ず現在の computed style を測り直す
   * (ここをホバー時の情報で済ませると、⌘Click が古い値の要素として動く誤答になる)。
   */
  private resyncToPointer(x: number, y: number) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return;
    if (this.overlay.containsTarget(hit)) return;
    this.select(drillToInnermost(hit, x, y));
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
    // 同一要素でも必ず再計測する (ホバー中のスタイル書き換えを拾う — resync の docstring 参照)
    this.resyncToPointer(me.clientX, me.clientY);
    // Alt+Click: 描画元 (owner) の一覧を出し、行クリックでそのファイルをエディタで開く。
    // モード ON のトーストで案内している操作なので、必ずここで応答する
    // (以前はハンドラが無く、preventDefault だけが効いて完全な無反応になっていた)。
    // resync 後も currentInfo が無い (カーソル下に要素が無い等) 場合も黙らない —
    // 案内した操作の無反応は「押しても効かない」という一番わかりにくい壊れ方になる
    if (me.altKey) {
      if (this.currentInfo) {
        this.overlay.showChainPanel(this.currentInfo, me.clientX, me.clientY);
      } else {
        this.overlay.toast(this.strings.jumpUnresolved);
      }
      return;
    }
    // Cmd(Mac)/Ctrl(Win)+Click で該当ソースをエディタで開く (dev の実ソースのみ)
    if (!me.metaKey && !me.ctrlKey) return;
    this.openEditorFor(this.currentElement, this.currentInfo);
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
    this.openEditorFor(element, inspectElement(element, this.settings.muiSkip));
  }

  /**
   * ジャンプ可能ならエディタを開き、**不可なら理由をトーストで言う**。
   * 黙って何もしないと「押しても無反応」= 一番わかりにくい壊れ方になる。
   *
   * 開く手段は 3 段 (上から順に精度が高い):
   * 1. React dev ビルドの jumpTarget (_debugSource 由来。行番号まで正確)
   * 2. ソース注釈属性 (data-v-inspector / data-source 等。フレームワーク非依存 —
   *    Express/EJS でもサーバーが書き出していれば行番号まで開ける)
   * 3. cascade で勝っている外部 CSS ファイル (行番号は取れない — CSSOM が公開して
   *    おらず、探すには fetch が要る。送信経路ゼロの提出前提を壊すので選ばない)
   */
  private openEditorFor(element: Element | null, info: InspectInfo | null) {
    const jt = info?.jumpTarget;
    if (jt && !isBundledSource(jt.fileName)) {
      this.overlay.openEditor(jt);
      return;
    }
    // **バンドル出力なら source map で元ソースへ戻す** (issue: React 19 対応)。
    // React 19 は `_debugSource` を削除したので、位置は Owner Stacks から来る =
    // 必ずバンドル後の座標になる。ここで諦めると **React 19 のアプリでは
    // ソースジャンプが原理的に一度も成功しない** (実機で確認した状態)。
    // 送信はローカル開発オリジンのときだけ (他人のサイトへは何も出さない)
    if (jt && looksLocalDev(location.host)) {
      // **候補を順に試す。** 先頭が当たりとは限らない (React の共有スタック)
      const candidates = info?.jumpCandidates?.length ? info.jumpCandidates : [jt];
      void resolveFirstAuthored(candidates).then((outcome) => {
        if (outcome.ok) {
          this.overlay.openEditor(outcome.loc);
          return;
        }
        // **どの層で失敗したかを言う。** 潰すと「バンドル出力です」とだけ出て、
        // dev サーバが落ちているのか対応が無いのか誰にも分からない (実際に起きた)
        this.overlay.toast(
          outcome.reason === 'no-map'
            ? this.strings.srcMapNoMap
            : outcome.reason === 'no-mapping'
              ? this.strings.srcMapNoMapping
              : outcome.reason === 'library'
                ? this.strings.srcMapLibrary
                : this.strings.srcMapNotLocal,
          8000,
        );
        this.reportUnjumpable(element, info);
      });
      return;
    }
    this.reportUnjumpable(element, info);
  }

  /**
   * ソースジャンプの最終段。**黙って終わらせない** —
   * 注釈属性 → 自オリジンの CSS → 手がかりのコピー、の順で必ず何かを返す。
   * source map の解決に失敗した経路もここへ合流する。
   */
  private reportUnjumpable(element: Element | null, info: InspectInfo | null) {
    if (element) {
      const attr = resolveSourceAttr(element, this.settings.sourceAttr);
      if (attr) {
        this.overlay.openEditor(attr);
        return;
      }
      const css = winningRuleRef(element);
      // 自オリジンの CSS だけ自動で開く。CDN 等のクロスオリジンはローカルに実体が
      // 無い可能性が高く、開けない URL をエディタに投げるより手がかりに回す。
      // **ビルド出力の CSS も除く** — Next の `/_next/static/chunks/*.css` のような
      // 生成物はディスク上の編集対象ではない (実機で「存在しません」を出した)
      if (css?.href && this.isOwnOrigin(css.href) && !isBundledSource(css.href)) {
        this.overlay.openEditor({ fileName: css.href, lineNumber: 1, columnNumber: 1 });
        return;
      }
      // どの経路でも開けない: 理由 + エディタ側で検索するための手がかりを渡す
      this.overlay.toastAction(
        this.explainNoJump(info),
        this.strings.editorCopyHints,
        () => void this.overlay.copySearchHints(element, css),
      );
      return;
    }
    this.overlay.toast(this.explainNoJump(info));
  }

  /** href が現在のページと同一オリジンか (解釈不能な URL は false) */
  private isOwnOrigin(href: string): boolean {
    try {
      return new URL(href, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
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
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    // **オーバーレイ自身の上での ↑↓ は奪わない。** owner チェーンパネルの行は
    // フォーカス可能 (`.row.jumpable:focus-visible`) なので、ここで食うとパネル内の
    // キーボード移動が死ぬ。onIntercept には同型のガードがあるのに keydown だけ
    // 無かった (`docs/design-coverage-screen.md` §5-4 が指摘した潜在バグ)。
    // closed shadow root のイベントは host に再ターゲットされるので target で判定できる
    if (this.overlay.containsTarget(event.target)) return;
    // **入力中・修飾キー付きの ↑↓ は奪わない。** テキスト入力のカーソル移動や
    // ⌘↑ (ページ先頭へ) はページの操作であって、インスペクタのナビゲーションではない。
    // composedPath()[0] を使う: event.target は shadow 境界でホストに再ターゲットされる
    // ため、Web Components 内の入力欄 (Lit/Ionic 等) を event.target だけで判定すると
    // ガードが黙って破れる (contextmenu ハンドラと同じ罠)
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const innermost = event.composedPath?.()[0] ?? event.target;
    if (isEditableTarget(innermost)) return;
    // **選択が無いときは preventDefault しない。** スクロール後は選択を捨てる仕様
    // (onViewportChange) なので、ここで奪うと「↑ が無反応 + ページのキースクロールも
    // 死んでいる」という説明のつかない状態になる。選択が無ければページに返す
    if (event.key === 'ArrowUp') {
      if (!this.currentElement) return;
      event.preventDefault();
      event.stopImmediatePropagation();
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
    // ↓: 遡った履歴が無ければページに返す (常に奪うとキースクロールが死ぬ)。
    // DOM から消えた要素は履歴として無効なので**まとめて捨ててから**判定する
    // (先頭 1 件だけ pop して返すと、履歴を消費したのにページへ流れてスクロールが走り、
    // onViewportChange が残りの履歴ごと選択を消す — 1 押下で状態が丸ごと飛ぶ)
    let child = this.navStack.pop();
    while (child && !child.isConnected) child = this.navStack.pop();
    if (!child) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.keyboardNav = true;
    this.select(child);
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
    // 選択を捨てるので監視も畳む (対象を持たない監視が残ると、以後の変化で
    // 誰も選んでいないのにコールバックが走る)
    this.stopObservingLive();
    this.currentElement = null;
    this.currentInfo = null;
    this.navStack = [];
    this.keyboardNav = false;
  };
}
