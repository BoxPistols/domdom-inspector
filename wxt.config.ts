import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // storage: 設定保存 / activeTab: ポップアップから現タブ origin 取得 /
    // scripting: 許可オリジンへ MAIN world document_start フックを動的登録 (M1)
    permissions: ['storage', 'activeTab', 'scripting'],
    // 任意オリジン (公開/デプロイ済み App) はユーザー明示許可でのみ有効化 (権限最小化)
    optional_host_permissions: ['*://*/*'],
    commands: {
      'toggle-inspect': {
        suggested_key: { default: 'Alt+Shift+I' },
        description: '__MSG_cmdToggleInspect__',
      },
      'toggle-render': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: '__MSG_cmdToggleRender__',
      },
      'toggle-tree': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: '__MSG_cmdToggleTree__',
      },
    },
  },
});
