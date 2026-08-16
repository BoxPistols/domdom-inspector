import { isColorValue } from './designStyle';
import { buildEditorUrl, formatSourceRef, needsPathMapping, resolvedPath } from './editor';
import { openViaDevServer } from './openInEditor';
import { isBundledSource, looksLocalDev, suggestMapping } from './source';
import { buildSearchHints } from './sourceAttr';
import { el } from './overlayDom';
import {
  clampBadgePosition,
  colorFor,
  designLabel,
  shapeClassFor,
  visibleProps,
} from './overlayFormat';
import { OVERLAY_CSS } from './overlayStyles';
import { annotateProp, EMPTY_TOKEN_DICT, type TokenDict } from './tokenDict';
import { lintSpacing } from './tokenLint';
import { DEFAULT_STRINGS, type InspectInfo, type Settings, type UiStrings } from './types';

/** lintSpacing に渡すグリッド幅 (px)。警告文の {grid} 表示と必ず一致させる */
const SPACING_GRID = 4;

/**
 * 温存サーフェス (render/tree) が Overlay 本体から借りる最小の口 (issue #17)。
 *
 * 描画コードは `render-bundle/overlayDebug.ts` にあり、v1 では誰も import しない
 * (クラスメソッドは tree-shake されないため、本体に持たせると出荷 JS に載り続ける)。
 * 再配線は `new OverlayDebugSurfaces(overlay.surfaceHost())` の 1 行で足りる。
 */
export interface OverlaySurfaceHost {
  /** shadow root を用意する (ページ側に host を外されていれば作り直す) */
  ensureMounted(): void;
  /** 現在の shadow root。ensureMounted() の後は非 null */
  root(): ShadowRoot | null;
  /** 再マウント世代。変わっていたら前に描いた DOM は既に捨てられている */
  generation(): number;
  settings(): Settings;
  strings(): UiStrings;
  toast(message: string, ms?: number): void;
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
  private inspectPillEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  /**
   * shadow root を作り直した回数。温存サーフェス (render/tree) は自前で DOM を持つので、
   * 「本体が作り直した = 前に描いたものは外れている」を知る必要がある (surfaceHost 参照)。
   */
  private mountGeneration = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * モードピルの現在値。ページ側 JS が overlay host ごと DOM から外すことがあり
   * (仮想 DOM の巻き戻し・body 差し替え等)、その場合 ensureMounted が作り直すが、
   * ピルは「モード ON の間ずっと出ている」契約なので**再マウント時に再描画する**。
   * これが無いと、モードは ON のままマウスでの終了導線だけが消える。
   */
  private pill: { label: string; closeLabel: string; onClose: () => void } | null = null;

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
    // 再マウント時 (ページ側 JS が host を外した場合)、外部サーフェスが持つ DOM 参照は
    // 全部“外れた木”になる。世代を進めて相手が捨てられるようにする (surfaceHost 参照)
    this.mountGeneration += 1;

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
    // ページ側に host を外されて作り直した場合、モード ON ならピルを復元する。
    // **再配線時の申し送り (issue #4/#5)**: OverlayDebugSurfaces は mountGeneration を見て
    // DOM を作り直すが、「最後に表示していた内容」までは復元しない (v1 では到達不能なので
    // 放置している既存の非対称)。render/tree を再配線するならピルと同様に状態を持たせること
    if (this.pill) this.renderPill(this.pill);
  }

  /**
   * 温存サーフェス (render/tree) へ渡す口。**v1 では誰も呼ばない** — issue #4/#5 の
   * 再配線時に `new OverlayDebugSurfaces(overlay.surfaceHost())` で使う (issue #17)。
   */
  surfaceHost(): OverlaySurfaceHost {
    return {
      ensureMounted: () => this.ensureMounted(),
      root: () => this.root,
      generation: () => this.mountGeneration,
      settings: () => this.settings,
      strings: () => this.strings,
      toast: (message, ms) => this.toast(message, ms),
    };
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
    cdot.classList.add(shapeClassFor(info.classification));
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
      dot.classList.add(shapeClassFor(entry.classification));
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
    // **本線は dev サーバ経由。** そのサーバは自分がプロジェクトなのでルートを知っており、
    // 相対パスを渡すだけで開ける = 利用者の設定が要らない (Vue DevTools と同じ方式)。
    // ローカル開発オリジンのときだけ試し、それ以外へは 1 バイトも出さない。
    // 開けなければ従来のスキーム経路へ落ちる (dev サーバを持たない構成のため)
    // **判定材料は呼び出し時点で捕まえる。** 非同期の続きで location を読み直すと、
    // その間に変わった状態を見てしまう (テストでも実ページの遷移でも起きる)
    const host = typeof location !== 'undefined' ? location.host : '';
    const origin = typeof location !== 'undefined' ? location.origin : '';
    if (looksLocalDev(host)) {
      void openViaDevServer(origin, loc).then((opened) => {
        if (opened) {
          // 位置はサーバが解決したので、こちらのパス表示は出さない (嘘になりうる)
          this.toast(this.strings.editorOpenedViaDevServer);
        } else {
          this.openEditorViaScheme(loc, host);
        }
      });
      return;
    }
    this.openEditorViaScheme(loc, host);
  }

  /**
   * OS のスキーム (`cursor://file…`) で開く従来経路。**絶対パスしか受けない**ため、
   * ブラウザが知り得ない情報 (プロジェクトのディスク上の位置) を利用者に設定させる
   * 必要がある。dev サーバ経路が使えないときだけここへ来る。
   */
  private openEditorViaScheme(
    loc: { fileName: string; lineNumber: number; columnNumber: number },
    host: string,
  ) {
    // **ここが「エディタへ送る」唯一の出口。** 開けないと分かっているものは
    // ここで止める — 呼び出し側 (React の jumpTarget / ソース注釈属性 / CSS) が
    // 増えるたびに同じ判定を書き忘れ、実機で「存在しません」を繰り返し出した。
    // 生成物 (バンドル出力) はディスク上の編集対象ではない
    if (isBundledSource(loc.fileName)) {
      this.toast(this.strings.sourceMinified);
      return;
    }
    // **「~」入りのパスを送らない。** エディタの scheme URL は ~ を展開せず文字どおりに
    // 扱うため必ず「存在しません」になる (実機で発生 — 対応表に ~ を書くのは自然な間違い)。
    // 拡張は home ディレクトリを知れないので展開はできず、直し方を言うところまで
    if (/^\/?~/.test(resolvedPath(this.settings, loc))) {
      this.toast(this.strings.editorTildePath, 10000);
      return;
    }
    // **プロジェクト相対のまま送らない。** エディタの scheme URL は絶対パスしか受けず、
    // 開いている作業フォルダは解決に使われないため必ず失敗する。
    if (needsPathMapping(this.settings, loc)) {
      const path = resolvedPath(this.settings, loc);
      // **対処を促してよいのは、その人が対処できるときだけ。** この拡張は Store で
      // 配るので、利用者は他人のサイトを見に来た人でありうる。そこで
      // 「ローカルの絶対パスを設定してください」と出しても実行できる人がいない
      // (ソースがそのマシンに無い)。自分の開発環境のときだけ設定へ誘導する
      if (looksLocalDev(host)) {
        const line = suggestMapping(path, host);
        this.toastAction(
          this.strings.editorNeedsMapping.replace('{path}', path).replace('{mapping}', line),
          this.strings.editorCopyMapping,
          () => void this.copyToClipboard(line, this.strings.editorMappingCopied),
          14000,
        );
      } else {
        this.toast(this.strings.editorRemoteSource.replace('{path}', path), 6000);
      }
      return;
    }
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

  /**
   * どの経路でも開けなかったとき、エディタ側で検索するための手がかりをコピーする
   * (セレクタ / クラス / テキスト / 勝っている CSS の所在)。「開けません」で
   * 終わらせない — 探す起点だけは必ず渡す。
   */
  copySearchHints(element: Element, css: { href: string | null; selector: string } | null) {
    return this.copyToClipboard(buildSearchHints(element, css), this.strings.editorHintsCopied);
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

  // ---- 温存サーフェス (render ヒートマップ / 統計 / 記録コントロール / ツリー) の描画は
  //      `render-bundle/overlayDebug.ts` へ分離した (issue #17)。クラスメソッドは
  //      tree-shake されないため、ここに置くと到達不能なまま出荷 JS に載り続ける。

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
