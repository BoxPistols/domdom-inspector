# セキュリティ / Security — DomDom Inspector

実務での採用判断に使えるよう、本拡張が「なぜ許可して安全か」をコード実測エビデンス付きで示す。

## TL;DR

**この拡張はページを「読む」が、「送らない・保存しない・外部コードを実行しない」。**
- ネットワーク送信経路は**オプトインの BYOK AI 監査 1 本のみ**(下記)。それ以外に
  fetch/XHR/WebSocket/beacon は皆無で、キー未設定なら送信コードは一切実行されない。
- BYOK AI 経路の条件: ユーザー自身の API キー + 毎回の明示 2 段操作(収集 → プレビュー →
  送信)+ 送信内容は集計済みスタイル値のみ(プレビュー = 送信内容そのもの)。宛先は
  ユーザーが選んだ公式エンドポイント(OpenAI / Gemini)だけで、ハード無効化トグルあり。
- リモートコード実行なし(動的コード評価・外部 script 皆無、MV3 準拠。AI 応答は
  テキストとして表示するだけでコードとして評価しない)。
- ページの内容(DOM/テキスト/入力値/スクショ)を保存・送信しない。保存するのは設定・
  ユーザーが貼り付けたデザイントークン・(AI 利用時の)API キーのみ。
- テレメトリなし。オープンソースで全コード監査可能。

## 脅威モデル

- **ページ→拡張**: MAIN world は同一信頼境界。ページが postMessage を偽装しても発火するのは
  UI トグルと自ページのスタイル集計のみ(特権操作なし)。API キーは bridge/MAIN world に
  一切流れないため、ページからの持ち出しは構造上不可能。
- **拡張→外部**: 送信経路は BYOK AI の 1 本のみ。background (SW) から公式エンドポイントへの
  直接 fetch で、ユーザーの明示操作起点でしか実行されず、内容は送信前プレビューに表示した
  集計スタイル値と完全一致する。キー未設定・ハード無効化時のデータ流出面はゼロ。
- **拡張→ページ**: 表示オーバーレイは closed Shadow DOM で隔離。ページを改変しない
  (読み取り専用のインスペクト)。
- **広い権限の悪用**: `*://*/*` は「読める」capability だが、送信も保存もしないため、
  悪用してもデータは端末外に出ない。opt-in + オープンソースで監査可能。

## 何を読むか / 何をするか

インスペクト対象のページで:
- DOM 構造と `getComputedStyle`(色/余白/角丸/フォント等)を**読む**(デザイン計測の本体)。
- ページが React の場合、コンポーネント名の補足表示のために React の内部フィールド
  (`__reactFiber$` 等)も**読む**。同梱コードには現バージョンで UI から到達できない
  React 解析機能(レンダー計測等、将来機能)も含まれるが、いずれも読み取り専用で、
  送信・保存経路を持たない。
- 読んだ情報を **Shadow DOM オーバーレイに表示するだけ**(あなたの画面内で完結)。
- 設定と貼り付けたデザイントークンを `chrome.storage.local` に保存。

> 注: 開発ビルドのページではコンポーネントの props も画面上のバッジに表示されうる。
> それらは**表示されるだけで、送信も保存もされない**。リスクは「自分の画面に表示される
> 範囲」に限定される。

## コード実測エビデンス(監査手順)

誰でも再現できる (src / entrypoints を検索):
```sh
# ① ネットワーク送信系 API の使用有無 — ヒットは entrypoints/background.ts の
#    BYOK AI ハンドラ (handleAiReview) 1 箇所のみ。ユーザー明示操作起点でしか呼ばれない
grep -rniE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|axios" src entrypoints
# ② 動的コード評価・外部 script 注入の有無 — ヒットなし
grep -rniE "importScripts|createElement\(.script" src entrypoints
# ③ 外部ホスト参照 — ヒットは src/aiProviders.ts の公式エンドポイント 2 つ
#    (api.openai.com / generativelanguage.googleapis.com) とコメント内の例のみ
grep -rniE "https?://[a-z0-9.-]+" src entrypoints
# ④ 永続化するもの(settings / tokenDict・tokenJson / aiConfig・aiKeys / popupDevOpen のみ)
grep -rnE "storage\.(local|sync)\.set" src entrypoints
```

CI では console.log の混入検知・型検査・テスト・ビルドを毎 push 実行している
(`.github/workflows/ci.yml`)。

## 権限の正当化(Chrome Web Store / IT 部門向け)

| 権限 | 目的 | 最小化 |
|------|------|--------|
| `storage` | 設定・デザイントークンのローカル保存 | ページ内容は保存しない |
| `activeTab` | ポップアップで現タブの origin を取得 | ユーザーがツールバーを開いた時のみ |
| `scripting` | 許可オリジンへインスペクタを動的注入 | ユーザー明示許可のオリジンのみ |
| `optional_host_permissions: *://*/*` | デプロイ済みサイトを検査可能にする | **既定では未付与**。localhost 以外はユーザーが「有効化」で明示許可した時のみ |
| 同上 (AI エンドポイント) | BYOK AI 監査の公式 API 呼び出し (`api.openai.com` / `generativelanguage.googleapis.com`) | **既定では未付与**。「AI に送信」を初めて押した gesture 内でのみ要求 |

**単一目的**: ページ要素のデザイン値(色/余白/角丸/タイポグラフィ)をローカルで計測・表示し、
ユーザーのデザイントークンと照合する(任意で、その集計結果への AI 講評を BYOK で取得できる)。
それ以外の目的なし。

## 企業導入の推奨運用

- **限定配布(zip)**: この SECURITY.md + 上記 grep を IT/セキュリティ担当に提示すれば監査可能。
- **オリジン許可**: 機密サイトでは「必要なサイトだけ有効化」で最小権限運用。全サイト許可は任意。
- 疑義があればソース(公開リポジトリ)を直接監査可能。ビルド成果物も 110KB 程度で軽量。

## 報告

脆弱性・懸念はリポジトリの Issue へ。
