import { DEV_MATCHES } from '../src/matches';
import { serialize } from '../src/serialize';

// v1 はデザイン計測のみ (tree/render は配線外し、実装は温存)
const COMMANDS = new Set(['toggle-inspect']);

/**
 * 右クリックメニュー。id はそのまま content script へ送るメッセージ型になる。
 * **要素は Chrome から渡されない** (contextMenus API は座標も要素も持たない) ため、
 * MAIN world 側が contextmenu イベントで対象要素を控えておき、それを使う。
 */
const CONTEXT_ITEMS = [
  { id: 'inspect-at-context', titleKey: 'ctxInspectElement' },
  { id: 'open-editor-at-context', titleKey: 'ctxOpenInEditor' },
] as const;

/**
 * メニューを出してよいページ = content script が**実際に動く**範囲。
 * http/https 全体に出すと、未許可オリジンで「メニューはあるが押しても無反応」になる
 * (この製品で一番わかりにくい壊れ方なので構造的に避ける)。
 */
async function menuPatterns(): Promise<string[]> {
  let origins: string[] = [];
  try {
    origins = (await browser.permissions.getAll()).origins ?? [];
  } catch {
    origins = [];
  }
  // 全サイト許可があれば個別オリジンは不要 (包含される)
  if (origins.some((o) => o === '*://*/*' || o === '<all_urls>')) return ['*://*/*'];
  // 静的注入される開発サーバ + 個別に許可されたオリジンだけ
  return [...DEV_MATCHES, ...origins];
}

/**
 * メニューを作り直す (重複 id で create が失敗するため removeAll してから)。
 *
 * **直列化が要る。** 呼び出し元は 5 つ (onInstalled / onStartup / SW 起動時の即時 /
 * permissions の追加・削除) で、SW 起動直後は複数が同時に走る。async なので
 * 「A が removeAll → B が removeAll → A が create → **B が create で重複**」と
 * 並び替わり、`Cannot create item with duplicate id` が実機で出ていた。
 *
 * **`create` のエラーは例外で来ない。** callback を渡さないと `runtime.lastError` が
 * 未確認のまま残り、拡張のエラーページに `Unchecked runtime.lastError` として溜まる。
 * try/catch では拾えないので、callback で明示的に読む。
 */
const createContextMenus = serialize(() => rebuildContextMenus());

async function rebuildContextMenus(): Promise<void> {
  const documentUrlPatterns = await menuPatterns();
  try {
    await browser.contextMenus.removeAll();
    for (const item of CONTEXT_ITEMS) {
      browser.contextMenus.create(
        {
          id: item.id,
          title: browser.i18n.getMessage(item.titleKey),
          documentUrlPatterns,
          contexts: ['all'],
        },
        () => {
          // 読むこと自体が目的 (未確認だとエラーページに積み上がる)。
          // 直列化してあるので通常は起きない = 起きたら別の原因なので握り潰さず残す
          const err = browser.runtime.lastError;
          if (err) console.warn('[domdom] contextMenus.create:', err.message);
        },
      );
    }
  } catch {
    // contextMenus が使えない環境では黙って諦める (他機能は動く)
  }
}

/**
 * メニュー選択をタブへ中継する。
 * 送信に失敗するのは「許可はあるが、そのタブは許可前から開いていて content script が
 * 入っていない」ケース (registerContentScripts は以後のロードにしか効かない)。
 * その場合だけ注入して 1 度だけ再送する — ここで諦めると無反応になる。
 */
async function relayToTab(tabId: number, frameId: number, type: string): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type }, { frameId });
    return;
  } catch {
    // 未注入の可能性 → 下で注入してから再送
  }
  try {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['/content-scripts/bridge.js'],
    });
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['/content-scripts/inspector.js'],
      world: 'MAIN',
    });
    await browser.tabs.sendMessage(tabId, { type }, { frameId });
  } catch {
    // 権限が無い等でここまで失敗したら諦める
    // (メニュー自体は許可済み範囲にしか出していないので、通常ここには来ない)
  }
}

/**
 * インスペクトモードの ON/OFF を **タブ内の全フレームへ配る** (issue #14)。
 *
 * Esc と モードピルの ✕ は押されたフレームにしか効かない (キーイベントも DOM も
 * フレームごとに独立している)。配らないと iframe が ON のまま残り、**iframe 内の
 * クリックが死んだまま**になる (インスペクタが capture で握りつぶすため)。
 * さらにショートカットを押すと親子で位相が反転し、何度押しても両方 OFF にできない。
 * 受け側 (`enableOnly` / `disableOnly`) は冪等なので、配り直しても反転しない。
 */
async function broadcastInspectState(tabId: number, on: boolean): Promise<void> {
  try {
    // frameId を指定しない = 全フレームの bridge に届く (ここでは意図的にそうする)
    await browser.tabs.sendMessage(tabId, { type: on ? 'inspect-on' : 'inspect-off' });
  } catch {
    // 未注入のフレームしか無い等は無視 (状態を配る相手が居ないだけ)
  }
}

// **AI 中継 (fetch) は v1 の配線から外した。** これが拡張内で唯一の fetch 発生源だったため、
// 外すと「ネットワークリクエストを 1 つも発行しない」が grep で再現証明できる状態になる
// (SECURITY.md / PRIVACY.md / STORE_LISTING.md の申告がこれに依存している)。
// 再導入するときは申告も同時に戻すこと: https://github.com/BoxPistols/domdom-inspector/issues/11
// 実装本体 (src/aiProviders.ts / aiPrompt.ts / aiCost.ts) は温存してある。

/**
 * 許可済みオリジンへの content script 動的登録を復元する。
 *
 * **これが無いと「また有効化を押さないと動かない」が起きる。**
 * `permissions.request` で得た許可はブラウザ再起動をまたいで残るが、
 * `scripting.registerContentScripts` の登録は**拡張の再読込・更新で消える**。
 * その結果「許可はあるのにスクリプトが入らない」という無言の不整合が残り、
 * 利用者からは機能が止まったようにしか見えない。
 * 起動時と更新時に許可の実態から登録を作り直すことで、押し直しを不要にする。
 */
async function restoreRegistrations(): Promise<void> {
  let origins: string[] = [];
  try {
    const granted = await browser.permissions.getAll();
    origins = granted.origins ?? [];
  } catch {
    return;
  }
  if (!origins.length) return;

  const scripts: Parameters<typeof browser.scripting.registerContentScripts>[0] = [];
  const add = (id: string, matches: string[]) => {
    scripts.push(
      {
        id: `${id}_bridge`,
        matches,
        js: ['content-scripts/bridge.js'],
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
      {
        id: `${id}_inspector`,
        matches,
        js: ['content-scripts/inspector.js'],
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
      },
    );
  };

  // 全サイト許可があれば個別オリジンは不要 (包含されるため登録数を最小化する)
  if (origins.some((o) => o === '*://*/*' || o === '<all_urls>')) {
    add('all', ['*://*/*']);
  } else {
    for (const pattern of origins) {
      // popup が登録するのと同じ id 規則にし、二重登録・取り残しを防ぐ
      const origin = pattern.replace(/\/\*$/, '');
      const key = origin.replace(/[^a-z0-9]/gi, '_');
      add(`dyn_${key}`, [pattern]);
    }
  }
  if (!scripts.length) return;

  try {
    // 既存の登録は消してから作り直す (id 重複で全体が失敗するのを避ける)
    const existing = await browser.scripting.getRegisteredContentScripts();
    const ids = existing.map((s) => s.id).filter((id) => scripts.some((n) => n.id === id));
    if (ids.length) await browser.scripting.unregisterContentScripts({ ids });
    await browser.scripting.registerContentScripts(scripts);
  } catch {
    // 登録できない環境 (権限剥奪直後等) では黙って諦める。次の起動で再試行される
  }
}

export default defineBackground(() => {
  // 拡張の再読込・更新・ブラウザ起動のいずれでも登録を復元する
  browser.runtime.onInstalled.addListener(() => void restoreRegistrations());
  browser.runtime.onStartup.addListener(() => void restoreRegistrations());
  void restoreRegistrations();

  // 右クリックメニューは SW が起きるたびに作り直す (removeAll → create で冪等)。
  // onInstalled/onStartup だけに頼ると、そのイベントを取り逃した SW 起動でメニューが消える
  browser.runtime.onInstalled.addListener(() => void createContextMenus());
  browser.runtime.onStartup.addListener(() => void createContextMenus());
  void createContextMenus();
  // 許可の増減でメニューを出す範囲が変わる (許可した瞬間からそのサイトで使えるように)
  browser.permissions.onAdded.addListener(() => void createContextMenus());
  browser.permissions.onRemoved.addListener(() => void createContextMenus());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id == null) return;
    if (!CONTEXT_ITEMS.some((i) => i.id === info.menuItemId)) return;
    // **frameId を必ず指定する**: 未指定だと全フレームの bridge に配信され、
    // 右クリックしていない iframe 側でも検査が始まる (info.frameId は右クリックされたフレーム)
    void relayToTab(tab.id, info.frameId ?? 0, String(info.menuItemId));
  });

  // content script (bridge) からの状態通知 → 同じタブの全フレームへ配る
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'inspect-state' || typeof message.on !== 'boolean') return false;
    const tabId = sender.tab?.id;
    // popup など tab を持たない送信元からは受けない (配る相手が決まらない)
    if (tabId != null) void broadcastInspectState(tabId, message.on);
    return false;
  });

  // キーボードショートカット (manifest commands) → アクティブタブへトグル指示 (FR-01)
  browser.commands.onCommand.addListener(async (command, tab) => {
    if (!COMMANDS.has(command)) return;
    const tabId =
      tab?.id ??
      (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId == null) return;
    // **トグルはトップフレームだけに送る** (issue #14)。全フレームに送ると各フレームが
    // 独立に反転するため、後から挿入された iframe (まだ OFF) が居ると 1 回の押下で
    // 「親 OFF / 子 ON」の逆位相を作る。結果の状態は上の broadcastInspectState が
    // 全フレームへ配るので、決めるのは 1 フレームだけでよい。
    try {
      await browser.tabs.sendMessage(tabId, { type: command }, { frameId: 0 });
    } catch {
      // トップフレームに content script が入っていない (iframe 側だけ対象オリジン等)。
      // その場合に限り全フレームへ送る = 従来動作。1 フレームしか居なければ反転は起きない
      browser.tabs.sendMessage(tabId, { type: command }).catch(() => {
        // 対象外オリジン (content script 未注入) は無視
      });
    }
  });

});
