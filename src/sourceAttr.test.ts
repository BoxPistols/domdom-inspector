// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSearchHints, parseSourceRef, resolveSourceAttr } from './sourceAttr';

describe('parseSourceRef', () => {
  it('path:line:col を分解する', () => {
    expect(parseSourceRef('src/App.vue:12:3')).toEqual({
      fileName: 'src/App.vue',
      lineNumber: 12,
      columnNumber: 3,
    });
  });

  it('col 無し / line 無しは 1 に落ちる (path だけでも開ける)', () => {
    expect(parseSourceRef('views/index.ejs:42')).toEqual({
      fileName: 'views/index.ejs',
      lineNumber: 42,
      columnNumber: 1,
    });
    expect(parseSourceRef('views/index.ejs')).toEqual({
      fileName: 'views/index.ejs',
      lineNumber: 1,
      columnNumber: 1,
    });
  });

  it('ファイルらしくない値は拾わない (誤答しない)', () => {
    expect(parseSourceRef('')).toBeNull();
    expect(parseSourceRef('42')).toBeNull();
    expect(parseSourceRef('primary')).toBeNull();
  });
});

describe('resolveSourceAttr', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('vite-plugin-vue-inspector の data-v-inspector を読む', () => {
    const el = document.createElement('div');
    el.setAttribute('data-v-inspector', 'src/components/Hello.vue:7:3');
    expect(resolveSourceAttr(el)).toEqual({
      fileName: 'src/components/Hello.vue',
      lineNumber: 7,
      columnNumber: 3,
    });
  });

  it('react-dev-inspector の分割属性を読む', () => {
    const el = document.createElement('div');
    el.setAttribute('data-inspector-relative-path', 'src/Button.tsx');
    el.setAttribute('data-inspector-line', '21');
    el.setAttribute('data-inspector-column', '5');
    expect(resolveSourceAttr(el)).toEqual({
      fileName: 'src/Button.tsx',
      lineNumber: 21,
      columnNumber: 5,
    });
  });

  it('祖先の注釈を近い順で拾う', () => {
    const outer = document.createElement('section');
    outer.setAttribute('data-source', 'views/layout.ejs:5');
    const mid = document.createElement('div');
    mid.setAttribute('data-source', 'views/index.ejs:42');
    const leaf = document.createElement('span');
    outer.appendChild(mid);
    mid.appendChild(leaf);
    document.body.appendChild(outer);
    expect(resolveSourceAttr(leaf)?.fileName).toBe('views/index.ejs');
  });

  it('shadow 境界を越えてホストの注釈を拾う', () => {
    const host = document.createElement('div');
    host.setAttribute('data-source', 'views/widget.ejs:3');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    root.appendChild(inner);
    expect(resolveSourceAttr(inner)?.fileName).toBe('views/widget.ejs');
  });

  it('カスタム属性は既存規格より優先される', () => {
    const el = document.createElement('div');
    el.setAttribute('data-source', 'wrong.ejs:1');
    el.setAttribute('data-my-loc', 'right.ejs:9');
    expect(resolveSourceAttr(el, 'data-my-loc')?.fileName).toBe('right.ejs');
  });

  it('注釈が無ければ null (誤検出しない)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'button-primary'); // ソースではない data 属性
    document.body.appendChild(el);
    expect(resolveSourceAttr(el)).toBeNull();
  });
});

describe('buildSearchHints', () => {
  it('grep できる具体値を並べる', () => {
    const el = document.createElement('button');
    el.id = 'save';
    el.className = 'btn primary';
    el.textContent = '保存する';
    const hints = buildSearchHints(el, { href: 'http://localhost:3333/css/app.css', selector: '.btn' });
    expect(hints).toContain('selector: button#save.btn.primary');
    expect(hints).toContain('class: btn primary');
    expect(hints).toContain('text: 保存する');
    expect(hints).toContain('css: http://localhost:3333/css/app.css — .btn');
  });

  it('無いものは行ごと出さない (空欄の行でノイズを作らない)', () => {
    const el = document.createElement('div');
    const hints = buildSearchHints(el, null);
    expect(hints).toBe('selector: div');
  });
});
