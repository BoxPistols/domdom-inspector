# セキュリティ / Security — MUI Design Inspector

実務での採用判断に使えるよう、本拡張が「なぜ許可して安全か」をコード実測エビデンス付きで示す。

## TL;DR

**この拡張はページを「読む」が、「送らない・保存しない・外部コードを実行しない」。**
- ネットワーク送信コードは 1 行も無い(fetch/XHR/WebSocket/beacon 皆無)。
- リモートコード実行なし(動的コード評価・外部 script 皆無、MV3 準拠)。
- ページの内容(DOM/テキスト/入力値/props/スクショ)を保存・送信しない。保存するのは設定のみ。
- テレメトリなし。オープンソースで全コード監査可能。

## 何を読むか / 何をするか

インスペクト対象のページで:
- DOM 構造、`getComputedStyle`(色/余白/角丸/フォント等)、要素の class、React の内部
  フィールド(`__reactFiber$`, `memoizedProps` 等)を**読む**。
- 読んだ情報を **Shadow DOM オーバーレイに表示するだけ**(あなたの画面内で完結)。
- 設定(エディタ選択・パスマッピング等)を `chrome.storage.local` に保存。

> 注: `memoizedProps`(コンポーネントの props)も読むため、「構造だけ」ではなく props の値も
> 参照しうる。ただしそれらは**画面上のバッジに表示されるだけで、送信も保存もされない**。
> リスクは「自分の画面に表示される範囲」に限定される。

## コード実測エビデンス(監査手順)

誰でも再現できる (src / entrypoints を検索し、いずれもヒットしない):
```sh
# ① ネットワーク送信系 API の使用有無
grep -rniE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|axios" src entrypoints
# ② 動的コード評価・外部 script 注入の有無
grep -rniE "importScripts|createElement\(.script" src entrypoints
# ③ 外部ホスト参照(実通信はゼロ。唯一のヒットは source.ts のコメント内の例)
grep -rniE "https?://[a-z0-9.-]+" src entrypoints
# ④ 永続化するもの({settings} のみ)
grep -rnE "storage\.(local|sync)\.set" src entrypoints
```

## 権限の正当化(Chrome Web Store / IT 部門向け)

| 権限 | 目的 | 最小化 |
|------|------|--------|
| `storage` | 設定のローカル保存 | 設定のみ。ページ内容は保存しない |
| `activeTab` | ポップアップで現タブの origin を取得 | ユーザーがツールバーを開いた時のみ |
| `scripting` | 許可オリジンへインスペクタを動的注入 | ユーザー明示許可のオリジンのみ |
| `optional_host_permissions: *://*/*` | デプロイ済みサイトを検査可能にする | **既定では未付与**。localhost 以外はユーザーが「有効化」で明示許可した時のみ |

**単一目的**: React/MUI UI のデザイン・構造をローカルで検査・可視化する。それ以外の機能なし。

## 脅威モデル

- **ページ→拡張**: MAIN world は同一信頼境界。ページが postMessage を偽装しても発火するのは
  UI トグルのみ(特権操作なし)。ページデータの持ち出しは構造上不可能(送信コードが無い)。
- **拡張→外部**: 送信経路が存在しない。データ流出面ゼロ。
- **拡張→ページ**: 表示オーバーレイは closed Shadow DOM で隔離。ページを改変しない
  (読み取り専用のインスペクト)。
- **広い権限の悪用**: `*://*/*` は「読める」capability だが、送信も保存もしないため、
  悪用してもデータは端末外に出ない。opt-in + オープンソースで監査可能。

## 企業導入の推奨運用

- **限定配布(zip)**: この SECURITY.md + 上記 grep を IT/セキュリティ担当に提示すれば監査可能。
- **オリジン許可**: 機密サイトでは「必要なサイトだけ有効化」で最小権限運用。全サイト許可は任意。
- 疑義があればソース(公開リポジトリ)を直接監査可能。ビルド成果物も 40KB 程度で軽量。

## 報告

脆弱性・懸念はリポジトリの Issue へ。
