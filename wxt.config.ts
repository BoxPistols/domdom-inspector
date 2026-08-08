import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    build: {
      // Vite が popup チャンクに注入する modulepreload polyfill は fetch( を含む。
      // 「送信 API の発生箇所ゼロ」を**出荷物に対しても** grep で再現証明できるよう外す。
      // minimum_chrome_version 119 は <link rel="modulepreload"> をネイティブ対応
      // (Chrome 66+) しているので polyfill は不要
      modulePreload: { polyfill: false },
    },
  }),
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // 依存 API の下限。**最大値を採る**: matchOriginAsFallback (Chrome 119、静的/動的登録の
    // 全箇所で使用) がボトルネックで、world:'MAIN' (111) / checkVisibility (105・ガード付き) /
    // storage.session (102・try/catch 付き) はこれより下。宣言しないと古い Chrome で
    // 「入るのに動かない」になる (審査提出物にも下限を書く義務がある)
    minimum_chrome_version: '119',
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
