import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // storage: 設定保存 / activeTab: ポップアップから現タブ origin 取得 /
    // scripting: 許可オリジンへ MAIN world document_start フックを動的登録 (M1)
    // contextMenus: 右クリックから「この要素を検査 / ソースをエディタで開く」を出す。
    // 権限としての警告文は持たない (ユーザーに見える権限表示は増えない)
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
    // 任意オリジン (公開/デプロイ済み App) はユーザー明示許可でのみ有効化 (権限最小化)
    optional_host_permissions: ['*://*/*'],
    // v1 はデザイン計測 (inspect) のみ。コンポーネントツリー / レンダー可視化は
    // 本番ビルドで原理的に機能せず (React が名前を minify)、dev でも React DevTools が
    // 優れるため配線から外した。実装は温存 (issue #4/#5)。復活は CLAUDE.md 地雷3 の 4 点配線。
    commands: {
      'toggle-inspect': {
        suggested_key: { default: 'Alt+Shift+I' },
        description: '__MSG_cmdToggleInspect__',
      },
    },
  },
});
