import { describe, expect, it } from 'vitest';
import { classify } from './classify';

describe('classify', () => {
  it('ソースパスが @mui 配下なら mui', () => {
    expect(classify('Button', '/p/node_modules/@mui/material/Button/Button.js')).toBe('mui');
  });

  it('ソースパスが node_modules 配下 (非 MUI) なら third-party', () => {
    expect(classify('Select', '/p/node_modules/react-select/dist/index.js')).toBe('third-party');
  });

  it('ソースパスがアプリコードなら custom', () => {
    expect(classify('UserCard', '/p/src/components/UserCard.tsx')).toBe('custom');
  });

  it('ソース不明でも Mui* クラスがあれば mui', () => {
    expect(classify(null, null, ['MuiButton-root', 'css-abc'])).toBe('mui');
  });

  it('ソース不明・名前ありは custom、名前もなければ third-party', () => {
    expect(classify('MyWidget', null)).toBe('custom');
    expect(classify(null, null)).toBe('third-party');
  });
});
