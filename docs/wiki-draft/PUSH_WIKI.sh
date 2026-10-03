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

if ! gh auth token >/dev/null 2>&1; then
  echo "Error: gh auth token が取れません。先に 'gh auth login' を実行してください" >&2
  exit 1
fi

TMP=$(mktemp -d)
ASKPASS=$(mktemp)
# 失敗しても一時ディレクトリ (clone とその認証情報) を残さない
trap 'rm -rf "$TMP" "$ASKPASS"' EXIT

# トークンを URL・引数・環境変数に載せない (ps / シェル履歴 / .git/config に残さない)。
# git が認証を求めた時だけ GIT_ASKPASS 経由で gh から直接渡す
printf '#!/bin/sh\nexec gh auth token\n' > "$ASKPASS"
chmod +x "$ASKPASS"

GIT_ASKPASS="$ASKPASS" git clone "https://x-access-token@github.com/BoxPistols/domdom-inspector.wiki.git" "$TMP"
cp "$SCRIPT_DIR"/*.md "$TMP/"
cd "$TMP"
git add .
if git diff --cached --quiet; then
  echo "変更なし — wiki は既に最新です"
else
  git commit -m "$MSG"
  GIT_ASKPASS="$ASKPASS" git push
  echo "✅ Wiki pushed: https://github.com/BoxPistols/domdom-inspector/wiki"
fi
