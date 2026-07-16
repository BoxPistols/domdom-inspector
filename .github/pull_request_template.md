<!-- DomDom Inspector PR テンプレート。回帰防止体制 (plans/20260717-worldclass-plan.plan.md §2) の一部。 -->

## 概要
<!-- 何を / なぜ を 1-3 行で -->

## 機械ゲート (全て green を確認)
- [ ] `pnpm wxt prepare`(locale/manifest を触った場合、型再生成のため先に実行)
- [ ] `pnpm test`(vitest 全 green)
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] `pnpm e2e`(playwright、`pnpm build` 後)

## framework 影響 (該当に ✅)
この変更が影響し得る環境。**Fiber/`_debug*`/dev 専用フィールドを読む経路を足した場合は特に注意**
(直近バグ a7346c5 は「React 前提の経路が生 DOM で誤答」が原因)。
- [ ] React (dev ビルド)
- [ ] React (production ビルド、`_debug*` 剥離)
- [ ] 非 React の生 DOM / HTML+CSS サイト
- [ ] MUI
- [ ] Tailwind / CSS Modules / 素の CSS

## ③目視 (人間しか判定できない項目)
- [ ] **React あり サイトと 素 HTML(非 React)サイトの両方で inspect を目視した**
      <!-- 今回のバグは React ありだけ見て非 React を見落とした類型。両方目視を必須とする -->
- [ ] 60fps のホバー追従 / 操作感に退行がない
- [ ] production ビルド(`_debug*` 剥離)でも design 計測が動く

## チェックリスト (該当時)
- [ ] i18n を触った → `src/types.ts` DEFAULT_STRINGS + `_locales/{en,ja}` を **3 箇所同期**(地雷1)
- [ ] design 計測経路(designStyle/cssVars/tokenDict/tokenLint/classify/overlayFormat)に
      Fiber 結合 import を足していない(`src/boundaries.test.ts` が機械検知)
- [ ] 新モードを足した → **4 点配線 + Esc**(wxt.config commands / background COMMANDS /
      bridge onMessage / inspector.content handler)を漏れなく(地雷3)
- [ ] `any` / `@ts-ignore` を足していない(例外: Fiber 内部のみ)/ `console.log` を commit していない
