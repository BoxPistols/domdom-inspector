#!/bin/bash
# Wiki コンテンツを GitHub Wiki へプッシュするスクリプト
# 実行前提: https://github.com/BoxPistols/domdom-inspector/wiki で
# 「Create the first page」ボタンを押して初期化済みであること (済)
#
# 使い方: ./PUSH_WIKI.sh ["コミットメッセージ"]
#   メッセージ省略時は "docs: wiki update"。
#   クラウドセッション (Claude Code on the web) からは wiki リポジトリへの
#   credential が無いため push できない — ローカルで実行すること。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MSG="${1:-docs: wiki update}"
TOKEN=$(gh auth token)
TMP=$(mktemp -d)

git clone "https://${TOKEN}@github.com/BoxPistols/domdom-inspector.wiki.git" "$TMP"
cp "$SCRIPT_DIR"/*.md "$TMP/"
cd "$TMP"
git add .
if git diff --cached --quiet; then
  echo "変更なし — wiki は既に最新です"
else
  git commit -m "$MSG"
  git push
  echo "✅ Wiki pushed: https://github.com/BoxPistols/domdom-inspector/wiki"
fi
rm -rf "$TMP"
