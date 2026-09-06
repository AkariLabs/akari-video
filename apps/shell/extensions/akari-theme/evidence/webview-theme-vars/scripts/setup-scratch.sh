#!/bin/bash
# webview-theme-vars L1: スクラッチ環境（THEIA_CONFIG_DIR / --user-data-dir / ワークスペース）を用意する。
#   使い方: setup-scratch.sh            -> 新しいスクラッチを作りパスを stdout に出す
# オーナーの ~/.theia は読むだけ（ditto で複製）。稼働中の /Applications/AKARI Video.app には触れない。
set -euo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)
REPO_DIR=$(CDPATH= cd -- "$SHELL_DIR/../.." && pwd)
# 既定はオーナーの deployedPlugins（読むだけ）。実測中の 2026-09-06 13:19 に
# オーナー側アプリが Codex 拡張を 26.5707.71524 -> 26.5901.22334 へ更新して
# 元ディレクトリが消えたため、BEFORE / AFTER で同じ版を使えるよう
# AKARI_WTV_PLUGIN_SRC で複製元を差し替えられるようにしてある。
PLUGIN_SRC="${AKARI_WTV_PLUGIN_SRC:-$HOME/.theia/deployedPlugins/openai.chatgpt-26.5707.71524}"

# 物理パス（/private/tmp）で持つ。/tmp は symlink なので、そのまま渡すと
# akari-preview の「ワークスペース内か」判定が realpath と食い違って
#「ワークスペース外の動画はプレビューできません」になる（実測）。
SCRATCH=$(cd -- "$(mktemp -d /tmp/akari-wtv.XXXXXX)" && pwd -P)
mkdir -p "$SCRATCH/config/deployedPlugins" "$SCRATCH/userdata" "$SCRATCH/ws/project"

cat > "$SCRATCH/config/settings.json" <<'JSON'
{
  "workbench.colorTheme": "dark",
  "webview.trace": "verbose",
  "security.workspace.trust.enabled": false
}
JSON

# Codex 拡張はオーナーの deployedPlugins から複製して使う（ログインしない・元は読むだけ）。
if [ -d "$PLUGIN_SRC" ]; then
  ditto "$PLUGIN_SRC" "$SCRATCH/config/deployedPlugins/$(basename "$PLUGIN_SRC")"
else
  echo "plugin source not found: $PLUGIN_SRC" >&2
  exit 1
fi

# ワークスペース = templates/project-default の複製 + プレビュー用 fixture。
# fixture は既存の dev-fixtures/preview-lut-chroma/b-lut-050（動画 1 本 320x180 2 s）をそのまま使う。
# akari-preview は動画ソースが無いと空状態カードを出すだけなので、回帰 (α) は
# 実際にフレームを描いている状態で測る。
cp -R "$REPO_DIR/templates/project-default/." "$SCRATCH/ws/project/"
cp "$REPO_DIR/dev-fixtures/preview-lut-chroma/b-lut-050/edit.json" "$SCRATCH/ws/project/edit.json"
mkdir -p "$SCRATCH/ws/project/media" "$SCRATCH/ws/project/exports"
cp "$REPO_DIR/dev-fixtures/preview-lut-chroma/b-lut-050/media/pattern.mp4" "$SCRATCH/ws/project/media/pattern.mp4"
cp "$REPO_DIR/dev-fixtures/preview-lut-chroma/b-lut-050/exports/reference.mp4" "$SCRATCH/ws/project/exports/reference.mp4"

echo "$SCRATCH"
