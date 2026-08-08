import { isColorValue } from './designStyle';
import { buildEditorUrl, formatSourceRef } from './editor';
import { isBundledSource } from './source';
import { el } from './overlayDom';
import {
  clampBadgePosition,
  colorFor,
  designLabel,
  heatColor,
  visibleProps,
} from './overlayFormat';
import { OVERLAY_CSS } from './overlayStyles';
import type { RenderSnapshot, RenderStat } from './renderTracker';
import { annotateProp, EMPTY_TOKEN_DICT, type TokenDict } from './tokenDict';
import { lintSpacing } from './tokenLint';
import type { TreeNode } from './tree';
import { formatVital, type VitalsSnapshot } from './vitals';
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

/**
 * エディタ起動の成否を判定するまでの猶予。外部アプリが立ち上がればページは blur するので、
 * この時間内に blur も visibilitychange も来なければ「開かなかった」と見なす。
 * 短すぎると起動が遅いエディタで誤検知し、長すぎると気づくのが遅れる。
 */
const EDITOR_LAUNCH_GRACE_MS = 1200;

export class Overlay {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private box!: HTMLDivElement;
  private badge!: HTMLDivElement;
  private panel!: HTMLDivElement;
  // ---- v1 で到達不能なサーフェス (render/tree — issue #4/#5 で温存) は**遅延生成**する。
  // mount のたびに canvas + 2D context / stats / rctl / tree の実 DOM を作るのは、
  // 使われない要素をページごとに増やすだけ (監査 2026-08-07 medium)。初回の show* で作る
  private statsPanel: HTMLDivElement | null = null;
  private renderControl: HTMLDivElement | null = null;
  private treePanel: HTMLDivElement | null = null;
  private inspectPillEl!: HTMLDivElement;
  /** ツリー行の nodeId → DOM 行 (scrollTreeTo 用) */
  private treeRows = new Map<number, HTMLElement>();
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private toastEl!: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * モードピルの現在値。ページ側 JS が overlay host ごと DOM から外すことがあり
   * (仮想 DOM の巻き戻し・body 差し替え等)、その場合 ensureMounted が作り直すが、
   * ピルは「モード ON の間ずっと出ている」契約なので**再マウント時に再描画する**。
   * これが無いと、モードは ON のままマウスでの終了導線だけが消える。
   */
  private pill: { label: string; closeLabel: string; onClose: () => void } | null = null;
  private flashes: Flash[] = [];
  private flashRaf = 0;
  private readonly FLASH_MS = 500;

  constructor(
    private settings: Settings,
    private strings: UiStrings = DEFAULT_STRINGS,
  ) {}

  /** Figma トークン辞書 (bridge → inspector.content 経由で注入)。空 = 照合オフ */
  private tokenDict: TokenDict = EMPTY_TOKEN_DICT;

  updateSettings(settings: Settings) {
    this.settings = settings;
  }

  updateTokens(dict: TokenDict) {
    this.tokenDict = dict;
  }

  /** イベントがオーバーレイ自身の上で起きたか (自己ホバーの除外用) */
  containsTarget(target: EventTarget | null): boolean {
    return !!this.host && target instanceof Node && this.host.contains(target);
  }

  private ensureMounted() {
    if (this.host?.isConnected) return;
    this.host = document.createElement('domdom-inspector-overlay');
    const root = this.host.attachShadow({ mode: 'closed' });
    this.root = root;
    // 再マウント時 (ページ側 JS が host を外した場合) は遅延サーフェスも作り直しになる
    this.statsPanel = null;
    this.renderControl = null;
    this.treePanel = null;
    this.canvas = null;
    this.ctx = null;

    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    root.appendChild(style);

    this.box = el('div', 'box');
    this.badge = el('div', 'badge');
    this.panel = el('div', 'panel');
    this.toastEl = el('div', 'toast');
    // AT にも届くように。トーストは唯一の状態通知 (モード ON/OFF・エディタ起動の結果) なので
    // 視覚だけに載せない。aria-live は要素が先に存在している必要があるためここで付ける
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    this.inspectPillEl = el('div', 'inspect-pill');
    root.append(this.box, this.badge, this.panel, this.inspectPillEl, this.toastEl);
    document.documentElement.appendChild(this.host);
    // ページ側に host を外されて作り直した場合、モード ON ならピルを復元する
    if (this.pill) this.renderPill(this.pill);
  }

  /** v1 で到達不能なサーフェスの遅延生成 (render/tree の再配線時に初めて DOM を作る) */
  private ensureCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      this.canvas = el('canvas', 'render-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.root?.append(this.canvas);
    }
    return this.canvas;
  }

  private ensureStatsPanel(): HTMLDivElement {
    if (!this.statsPanel) {
      this.statsPanel = el('div', 'stats');
      this.root?.append(this.statsPanel);
    }
    return this.statsPanel;
  }

  private ensureRenderControl(): HTMLDivElement {
    if (!this.renderControl) {
      this.renderControl = el('div', 'rctl');
      this.root?.append(this.renderControl);
    }
    return this.renderControl;
  }

  private ensureTreePanel(): HTMLDivElement {
    if (!this.treePanel) {
      this.treePanel = el('div', 'tree');
      this.root?.append(this.treePanel);
    }
    return this.treePanel;
  }

  /** インスペクトモード中の常設ピル。マウスだけで終了できる導線 (ST-5) */
  showModePill(label: string, closeLabel: string, onClose: () => void) {
    this.pill = { label, closeLabel, onClose };
    this.ensureMounted();
    this.renderPill(this.pill);
  }

  private renderPill(pill: { label: string; closeLabel: string; onClose: () => void }) {
    while (this.inspectPillEl.firstChild) this.inspectPillEl.removeChild(this.inspectPillEl.firstChild);
    const lbl = el('span', 'lbl', pill.label);
    const btn = el('button', undefined, '✕');
    btn.title = pill.closeLabel;
    // accessible name を "✕" にしない。title は Chromium で SUPERSEDED 扱いになるため
    // ローカライズ済みラベルを aria-label で明示する
    btn.setAttribute('aria-label', pill.closeLabel);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pill.onClose();
    });
    this.inspectPillEl.append(lbl, btn);
    this.inspectPillEl.classList.add('on');
  }

  hideModePill() {
    this.pill = null;
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
    // jumpTarget は dev のみ設定される。ただしバンドル出力 (ハッシュ付きチャンク) は
    // 実ソースでなく開けないため、file:line を出さず注記に切替える (Cmd+Click ジャンプも不可)。
    const jt = info.jumpTarget;
    const canJump = !!jt && !isBundledSource(jt.fileName);
    const file = canJump
      ? `${jt.fileName.split('/').pop()}:${jt.lineNumber}`
      : jt
        ? this.strings.sourceMinified
        : info.devMode
          ? this.strings.sourceUnavailable
          : this.strings.prodSafeMode;

    this.badge.replaceChildren();
    // 名前は白文字に固定し、分類は色ドット + 枠色で示す。分類色をテキストに使うと
    // 「枠は白ページ上で 3:1」「文字は暗いバッジ上で 4.5:1」を同じ色では満たせない
    // (overlayContrast.test.ts が両方を機械検証する)
    const name = el('span', 'name');
    const cdot = el('span', 'cdot');
    cdot.style.background = color;
    name.append(cdot, `<${info.name}>`);
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
      // 実ソースにジャンプ可能な時だけ操作ヒントを添える
      if (canJump) fileEl.append(el('span', 'ehint', ` · ${this.strings.editorHint}`));
      this.badge.append(fileEl);
    }

    // デザイン情報 (computed style): compact 以外で表示。
    // 以前は production のとき compact を無視していたが、設定を選んでも何も変わらないため
    // 「効いていない」と見える不具合になっていた。設定は常に効かせ、代わりに選択肢の
    // 文言で「少なめ = デザイン値を出さない」と明示する。
    if (detail !== 'compact' && info.design.length) {
      const designEl = el('div', 'design');
      // トークン注釈を先に計算 (トークン一致したラベルはグリッド警告を抑制するため)
      const annotations = new Map(
        info.design.map((p) => [p.label, annotateProp(p, this.tokenDict)] as const),
      );
      for (const p of info.design) {
        const chip = el('span', 'chip');
        const lb = el('span', 'lb', designLabel(p.label, this.strings));
        chip.append(lb);
        // 色値は hex 文字列だけでは読めないため実色スウォッチを前置。
        // **半透明色は市松の上に描く**: バッジの暗背景と合成すると実際とかけ離れた色に
        // 見える (実測 ΔRGB=331)。上層 = 実色 / 下層 = 市松 の 2 層背景にする
        if (isColorValue(p.value)) {
          const sw = el('span', 'sw');
          sw.style.backgroundImage =
            `linear-gradient(${p.value}, ${p.value}), ` +
            'conic-gradient(#9a9a9a 25%, #fff 0 50%, #9a9a9a 0 75%, #fff 0)';
          chip.append(sw);
        }
        // 変数名優先 (showVarNames かつ宣言された CSS 変数がある) なら変数名を主・生値を従で描画。
        // トークン準拠の検証が主目的なので「実装で宣言された変数名」を第一級で見せる。
        if (this.settings.showVarNames && p.varName) {
          const suffix = p.ambiguous ? ` (+${(p.varNames?.length ?? 1) - 1})` : '';
          const varEl = el('span', 'var', `${p.varName}${suffix}`);
          if (p.ambiguous && p.varNames) varEl.title = p.varNames.join(', ');
          chip.append(varEl);
          chip.append(el('span', 'raw', p.value));
        } else {
          chip.append(el('span', undefined, p.value));
        }
        // Figma トークン照合: 一致ならトークン名、外れなら野良値警告 + 最近傍
        const token = annotations.get(p.label) ?? null;
        if (token?.kind === 'hit') {
          chip.append(el('span', 'tk ok', token.names.join(', ')));
        } else if (token?.kind === 'miss') {
          const text = token.nearest
            ? this.strings.tokenNear.replace('{name}', token.nearest)
            : this.strings.tokenNone;
          chip.append(el('span', 'tk ng', text));
          chip.classList.add('stray');
        }
        designEl.append(chip);
      }
      this.badge.append(designEl);

      // 野良値検出 (グリッド外の余白/角丸)。テーマ非依存で production でも動く。
      // ただしトークン辞書に一致したラベルはトークンが正なのでグリッド警告を抑制する
      // (例: radius/md=6px はグリッド 4px の倍数でなくても正規値)。
      const findings = lintSpacing(info.design, SPACING_GRID).filter(
        (f) => annotations.get(f.label)?.kind !== 'hit',
      );
      if (findings.length) {
        const warn = el('span', 'warn');
        warn.textContent =
          '⚠ ' +
          findings
            .map((f) =>
              this.strings.offGridWarn
                .replace('{label}', designLabel(f.label, this.strings))
                // "13/5px" は分数に見える。区切りにも px を付けて "13px / 5px" にする
                // (末尾の px はテンプレート側 `{values}px` が持つ)
                .replace('{values}', f.offGrid.join('px / '))
                .replace('{grid}', String(SPACING_GRID)),
            )
            .join(' · ');
        this.badge.append(warn);
      }
    }
  }

  /** 複数行で高さも幅も可変になるため、実測してからビューポート内に収める */
  private positionBadge(rect: DOMRect) {
    this.badge.style.display = 'block';
    // 実測のため一旦左上に置く (max-width は CSS 側なので幅も測ってから決める)
    this.badge.style.left = '0px';
    this.badge.style.top = '0px';
    const box = this.badge.getBoundingClientRect();
    const { left, top } = clampBadgePosition(
      { left: rect.left, top: rect.top, bottom: rect.bottom },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    this.badge.style.left = `${left}px`;
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

    // 空のまま出すと「タイトルだけの箱」になり、押しても何も起きないのと同じ体験になる。
    // 素の DOM 要素と production ビルドでは owner が取れないので理由を書く
    if (!info.ownerChain.length) {
      this.panel.appendChild(el('div', 'row', this.strings.chainEmpty));
    }

    for (const entry of info.ownerChain) {
      const row = el('div', 'row');
      const dot = el('span', 'dot');
      dot.style.background = colorFor(entry.classification, this.settings.colors);
      const name = el('span', undefined, entry.name);
      const file = el('span', 'file');
      // バッジと同じ規約: バンドル出力 (ハッシュ付きチャンク) は実ソースでないので
      // file:line を出さずジャンプもさせない (開いても存在しないパスになる)
      const jumpable = !!entry.source && !isBundledSource(entry.source.fileName);
      if (entry.source && jumpable) {
        file.textContent = `${entry.source.fileName.split('/').pop()}:${entry.source.lineNumber}`;
        row.classList.add('jumpable');
        const source = entry.source;
        const activate = () => {
          this.openEditor(source);
          this.hideChainPanel();
        };
        row.addEventListener('click', activate);
        // マウス専用にしない: Tab で行に到達でき、Enter/Space で同じ操作ができる
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          activate();
        });
      } else if (entry.source) {
        file.textContent = this.strings.sourceMinified;
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

  /**
   * エディタを開く唯一の実装。MAIN world は `browser.*` を使えないため
   * `a[href="cursor://…"]` を生成して click する。
   *
   * `window.location.href = url` は使わない: スキーム未登録のとき**ページ遷移として扱われて
   * 現在の画面を失う**ことがあり、検査中に押した結果ページが飛ぶのは回復不能な事故になる。
   * アンカーには data-domdom-editor を付け、インスペクタのクリック抑止を素通りさせる。
   */
  openEditor(loc: { fileName: string; lineNumber: number; columnNumber: number }) {
    const url = buildEditorUrl(this.settings, loc);
    const ref = formatSourceRef(this.settings, loc);

    // 外部アプリが起動するとページはフォーカスを失う。それを**イベントで捕まえてフラグに残し**、
    // 遅延側ではフラグだけで判定する (遅延の中で document.hasFocus() を読み直すと、
    // その間に別の理由で変わった状態を見てしまう)。
    let leftPage = false;
    const mark = () => {
      leftPage = true;
    };
    window.addEventListener('blur', mark, { once: true });
    document.addEventListener('visibilitychange', mark, { once: true });

    try {
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('data-domdom-editor', '1');
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 0);
    } catch {
      // scheme を開けない環境。下のフォールバックで拾う
    }
    // 「開いています」と断定しない (成否が取れないため)。送った先と場所だけ言う
    this.toast(this.strings.editorOpening.replace('{file}', ref));

    setTimeout(() => {
      window.removeEventListener('blur', mark);
      document.removeEventListener('visibilitychange', mark);
      if (leftPage) return;
      // 何も起きなかった = エディタ未インストール / scheme 未登録の可能性。
      // 黙って終わらせず、手で辿れるパスとコピー導線を出す
      this.toastAction(
        `${this.strings.editorNotOpened} ${ref}`,
        this.strings.editorCopyPath,
        () => void this.copyToClipboard(ref, this.strings.editorPathCopied),
      );
    }, EDITOR_LAUNCH_GRACE_MS);
  }

  /** クリップボードへコピーし、結果をトーストで返す (失敗を黙らせない) */
  private async copyToClipboard(text: string, okMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(okMessage);
    } catch {
      // 権限やフォーカスで失敗しうる。文字列は操作可能なトーストに残っているので選択できる
      this.toast(this.strings.statsCopyFail, 4000);
    }
  }

  /** レンダーデバッグ: 再描画した要素群をヒートマップ色で明滅させる */
  flashRenders(entries: { element: Element; heat: number }[]) {
    this.ensureMounted();
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

  // ---- 以下 render/tree サーフェスの show/hide は v1 で到達不能 (温存)。
  //      遅延生成後はローカル変数に受けて null を消す ----

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
    this.ensureMounted();
    const statsPanel = this.ensureStatsPanel();
    statsPanel.replaceChildren();
    const titleText = this.strings.statsTitle.replace('{n}', String(snapshot.commits));
    statsPanel.setAttribute('role', 'dialog');
    statsPanel.setAttribute('aria-label', titleText);

    const head = el('div', 'head');
    const title = el('span', 'ttl', titleText);
    const acts = el('span', 'acts');
    const copyBtn = el('button', 'act', this.strings.statsCopy);
    copyBtn.addEventListener('click', () => {
      void this.copyText(opts.buildReport()).then((ok) => {
        this.toast(ok ? this.strings.statsCopied : this.strings.statsCopyFail, 4000);
      });
    });
    const close = el('button', 'x', '×');
    close.title = this.strings.panelClose;
    close.setAttribute('aria-label', this.strings.panelClose);
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
      vit.append(el('span', 'vlb', this.strings.vitalsTitle));
      for (const m of vitals.metrics) {
        const cls =
          m.rating === 'good' ? 'ok' : m.rating === 'needs-improvement' ? 'ni' : 'bad';
        const chip = el('span', `vchip ${cls}`);
        chip.title = m.rating;
        chip.append(el('span', 'vd'), el('span', undefined, `${m.id} ${formatVital(m.id, m.value)}`));
        vit.append(chip);
      }
      if (vitals.longTasks > 0) {
        const chip = el('span', 'vchip');
        chip.append(
          el('span', undefined, `${this.strings.vitalsLongTasks} ${vitals.longTasks}`),
        );
        vit.append(chip);
      }
      statsPanel.appendChild(vit);
    }

    const totalRenders = snapshot.stats.reduce((a, s) => a + s.count, 0);
    const summary = el(
      'div',
      'sum',
      this.strings.statsSummary
        .replace('{renders}', String(totalRenders))
        .replace('{wasted}', String(snapshot.totalWasted))
        .replace('{ms}', snapshot.timingSupported ? snapshot.totalSelfMs.toFixed(1) : '—'),
    );
    statsPanel.appendChild(summary);

    const sub = el(
      'div',
      'sub',
      snapshot.timingSupported
        ? this.strings.statsColsSupported
        : this.strings.statsColsUnsupported,
    );
    statsPanel.appendChild(sub);

    if (snapshot.stats.length === 0) {
      statsPanel.appendChild(el('div', 'r', this.strings.statsEmpty));
    } else {
      const hd = el('div', 'r hd');
      hd.append(
        el('span', 'nm', this.strings.statsColComponent),
        el('span', 'ct', this.strings.statsColRenders),
        el('span', 'ws', this.strings.statsColWasted),
        el('span', 'ms', this.strings.statsColMs),
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
      statsPanel.appendChild(el('div', 'foot', this.strings.statsWastedHint));
    }
    statsPanel.style.display = 'block';
  }

  /** 行ツールチップ: 原因内訳 + 直近で変化した props / hooks */
  private causeTooltip(s: RenderStat): string {
    const lines: string[] = [];
    const labels: [keyof RenderStat['causes'], string][] = [
      ['state', this.strings.causeState],
      ['props', this.strings.causeProps],
      ['parent', this.strings.causeParent],
      ['mount', this.strings.causeMount],
      ['other', this.strings.causeOther],
    ];
    for (const [key, label] of labels) {
      if (s.causes[key] > 0) lines.push(`${label}: ×${s.causes[key]}`);
    }
    if (s.lastChangedProps.length) {
      lines.push(this.strings.changedPropsHint.replace('{list}', s.lastChangedProps.join(', ')));
    }
    if (s.lastChangedHooks.length) {
      lines.push(
        this.strings.changedHooksHint.replace(
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
    this.ensureMounted();
    const renderControl = this.ensureRenderControl();
    renderControl.replaceChildren();
    const status = el('span', 'st');
    const dot = el('span', 'd');
    const label = el('span', undefined, opts.recording ? this.strings.ctrlRecording : opts.title);
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
    opts: { title: string; onHoverNode: (node: TreeNode) => void; onClickNode: (node: TreeNode) => void; onClose: () => void },
  ) {
    this.ensureMounted();
    const treePanel = this.ensureTreePanel();
    treePanel.replaceChildren();
    this.treeRows.clear();
    treePanel.setAttribute('role', 'dialog');
    treePanel.setAttribute('aria-label', opts.title);

    const head = el('div', 'head');
    const title = el('span', undefined, `${opts.title} (${nodes.length})`);
    const close = el('button', 'x', '×');
    close.title = this.strings.panelClose;
    close.setAttribute('aria-label', this.strings.panelClose);
    close.addEventListener('click', () => {
      this.hideTree();
      opts.onClose();
    });
    head.append(title, close);
    treePanel.appendChild(head);

    if (nodes.length === 0) {
      const empty = el('div', 'empty', this.strings.statsEmpty);
      treePanel.appendChild(empty);
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

  toast(message: string, ms = 2600) {
    this.ensureMounted();
    // 前回の操作可能トーストの残骸 (ボタン / pointer-events) を必ず落とす
    this.toastEl.classList.remove('interactive');
    this.toastEl.textContent = message;
    this.toastEl.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, ms);
  }

  /**
   * 操作できるトースト (本文 + ボタン 1 つ)。押せる要素を出すので既定より長く出す。
   * ハイライト枠やバッジと違い pointer-events を有効にする必要があるため class で切り替える。
   */
  toastAction(message: string, actionLabel: string, onAction: () => void, ms = 9000) {
    this.ensureMounted();
    this.toastEl.classList.add('interactive');
    this.toastEl.replaceChildren();
    this.toastEl.append(el('span', undefined, message));
    const button = el('button', undefined, actionLabel) as HTMLButtonElement;
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onAction();
    });
    this.toastEl.append(button);
    this.toastEl.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.style.display = 'none';
      this.toastEl.classList.remove('interactive');
    }, ms);
  }
}
