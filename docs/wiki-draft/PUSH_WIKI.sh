#!/bin/bash
# Wiki コンテンツを GitHub Wiki へプッシュするスクリプト
# 実行前提: https://github.com/BoxPistols/react-design-inspector/wiki で
# 「Create the first page」ボタンを押して初期化済みであること

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN=$(gh auth token)
TMP=$(mktemp -d)

git clone "https://${TOKEN}@github.com/BoxPistols/react-design-inspector.wiki.git" "$TMP"
cp "$SCRIPT_DIR"/*.md "$TMP/"
cd "$TMP"
git add .
git commit -m "docs: Wiki 初版 — 背景/デザイナー向け/エンジニア向け/競合/支援"
git push

echo "✅ Wiki pushed: https://github.com/BoxPistols/react-design-inspector/wiki"
rm -rf "$TMP"
