export default defineBackground(() => {
  // キーボードショートカット (manifest commands) → アクティブタブへトグル指示 (FR-01)
  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'toggle-inspect') return;
    const tabId =
      tab?.id ??
      (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId != null) {
      browser.tabs.sendMessage(tabId, { type: 'toggle-inspect' }).catch(() => {
        // 対象外オリジン (content script 未注入) は無視
      });
    }
  });
});
