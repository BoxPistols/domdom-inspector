import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage'],
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
