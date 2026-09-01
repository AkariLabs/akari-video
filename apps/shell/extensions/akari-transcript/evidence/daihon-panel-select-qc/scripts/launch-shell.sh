#!/bin/zsh
# Usage: launch-shell.sh <projectDir> <cdpPort> <isoDir> <logFile> [keep]
set -eu
REPO=${AKARI_REPO_DIR:-${0:A:h:h:h:h:h:h:h:h}}
SHELL_DIR=${AKARI_SHELL_DIR:-$REPO/apps/shell}
ELECTRON=${AKARI_ELECTRON:-$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}
LAB_ROOT=$REPO/apps/shell/extensions/akari-transcript/evidence/daihon-panel-select-qc
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
