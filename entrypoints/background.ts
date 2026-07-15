// 初回リリースはデザイン計測 (inspect) のみ。render/tree は issue #4-#9 で将来化
const COMMANDS = new Set(['toggle-inspect']);

export default defineBackground(() => {
  // キーボードショートカット (manifest commands) → アクティブタブへトグル指示 (FR-01)
  browser.commands.onCommand.addListener(async (command, tab) => {
    if (!COMMANDS.has(command)) return;
    const tabId =
      tab?.id ??
      (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId != null) {
      browser.tabs.sendMessage(tabId, { type: command }).catch(() => {
        // 対象外オリジン (content script 未注入) は無視
      });
    }
  });
});
