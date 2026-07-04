import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'MUI Design Inspector',
    description:
      'React/MUI コンポーネントをホバーで識別し、ソースコードへワンクリックでジャンプする開発者向けインスペクタ',
    permissions: ['storage'],
    commands: {
      'toggle-inspect': {
        suggested_key: { default: 'Alt+Shift+I' },
        description: 'インスペクトモードの切替',
      },
    },
  },
});
