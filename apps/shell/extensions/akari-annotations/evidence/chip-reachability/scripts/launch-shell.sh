#!/bin/zsh
# Copied in form from evidence/strip-keyed-diff/scripts/launch-shell.sh; SHELL_DIR と隔離ディレクトリのガードだけ
# この worktree（timeline-chip-reachability）へ向け直している。Electron 実体は worktree ルートの hoist 済み node_modules。
# Usage: launch-shell.sh <projectDir> <cdpPort> <isoDir> <logFile> [keep]
set -eu
WT=${AKARI_WT_DIR:-/Users/ryoma/_edit/30_products/akari-video-wt/timeline-chip-reachability}
SHELL_DIR=${AKARI_SHELL_DIR:-$WT/apps/shell}
ELECTRON=${AKARI_ELECTRON:-$WT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}
LAB_ROOT=$WT/apps/shell/extensions/akari-annotations/evidence/chip-reachability
PROJ="$1"; PORT="$2"; ISO="$3"; LOG="$4"; KEEP="${5:-fresh}"
case "$ISO" in
  "$LAB_ROOT"/runs/*) ;;
  *) print -u2 "refusing unsafe iso dir: $ISO"; exit 64 ;;
esac
if [ "$KEEP" != "keep" ]; then rm -rf "$ISO"; fi
mkdir -p "$ISO" "${LOG:h}"
THEIA_CONFIG_DIR="$ISO" nohup "$ELECTRON" \
  "$SHELL_DIR" "$PROJ" --remote-debugging-port="$PORT" --user-data-dir="$ISO" --no-sandbox \
  > "$LOG" 2>&1 &
echo $!
