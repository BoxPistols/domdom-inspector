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
    // 初回リリースはデザイン計測 (inspect) のみ。render/tree コマンドは issue #4-#9 で将来化
    commands: {
      'toggle-inspect': {
        suggested_key: { default: 'Alt+Shift+I' },
        description: '__MSG_cmdToggleInspect__',
      },
    },
  },
});
