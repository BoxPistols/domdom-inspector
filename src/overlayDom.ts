/**
 * DOM 生成のボイラープレート (createElement → className → textContent) を 1 行に畳む薄いヘルパ。
 * style / addEventListener / title 等の追加設定は呼び出し側で行う。手書きと挙動は等価。
 * cls が falsy なら className 未設定、text が null/undefined なら textContent 未設定。
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
