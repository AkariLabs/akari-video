#!/bin/zsh
# Usage: launch-shell.sh <shellDir> <projectDir> <cdpPort> <isoDir> <logFile>
# L1 専用ランチャー（right-rail-regroup）。iso は /tmp/right-rail-regroup-l1/ 配下に限る。
set -eu
SHELL_DIR="$1"; PROJ="$2"; PORT="$3"; ISO="$4"; LOG="$5"
L1_ROOT=/tmp/right-rail-regroup-l1
case "$ISO" in
  "$L1_ROOT"/*) ;;
  *) print -u2 "refusing unsafe iso dir: $ISO"; exit 64 ;;
esac
ELECTRON="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
mkdir -p "$ISO" "${LOG:h}" "$L1_ROOT/akari-home"
cd "$SHELL_DIR"
AKARI_HOME="$L1_ROOT/akari-home" THEIA_CONFIG_DIR="$ISO" nohup "$ELECTRON" \
  "$SHELL_DIR" "$PROJ" --remote-debugging-port="$PORT" --user-data-dir="$ISO" --no-sandbox \
  > "$LOG" 2>&1 &
echo $!
