#!/bin/zsh
# Copied in form from evidence/chip-reachability/scripts/launch-shell.sh (read-only original);
# LAB_ROOT だけ本レーンへ向け直し、harness README の「webview の rAF が 5Hz に落ちる」対策として
# background throttling 無効化フラグを足してある。Electron 実体は worktree の hoist 済み node_modules（OSR tier 2）。
# Usage: launch-shell.sh <projectDir> <cdpPort> <isoDir> <logFile> [keep]
set -eu
WT=${AKARI_WT_DIR:-${0:A:h:h:h:h:h:h:h:h}}
SHELL_DIR=${AKARI_SHELL_DIR:-$WT/apps/shell}
ELECTRON=${AKARI_ELECTRON:-$WT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}
LAB_ROOT=$WT/apps/shell/extensions/akari-preview/evidence/caption-plate-drag-clamp
PROJ="$1"; PORT="$2"; ISO="$3"; LOG="$4"; KEEP="${5:-fresh}"
case "$ISO" in
  "$LAB_ROOT"/runs/*) ;;
  *) print -u2 "refusing unsafe iso dir: $ISO"; exit 64 ;;
esac
if [ "$KEEP" != "keep" ]; then rm -rf "$ISO"; fi
mkdir -p "$ISO" "${LOG:h}"
THEIA_CONFIG_DIR="$ISO" nohup "$ELECTRON" \
  "$SHELL_DIR" "$PROJ" --remote-debugging-port="$PORT" --user-data-dir="$ISO" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  > "$LOG" 2>&1 &
echo $!
