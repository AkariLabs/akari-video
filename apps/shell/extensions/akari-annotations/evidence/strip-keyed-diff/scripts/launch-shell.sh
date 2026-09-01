#!/bin/zsh
# Copied in form from tasks/2026-08-19-wave1-integrated-latency-verify/out/evidence/scripts/launch.sh; source is read-only.
# Usage: launch-shell.sh <projectDir> <cdpPort> <isoDir> <logFile> [keep]
set -eu
SHELL_DIR=${AKARI_SHELL_DIR:-/Users/ryoma/_edit/30_products/akari-video-wt/timeline-strip-keyed-diff/apps/shell}
LAB_ROOT=/Users/ryoma/_edit/30_products/akari-video-wt/timeline-strip-keyed-diff/apps/shell/extensions/akari-annotations/evidence/strip-keyed-diff
PROJ="$1"; PORT="$2"; ISO="$3"; LOG="$4"; KEEP="${5:-fresh}"
case "$ISO" in
  "$LAB_ROOT"/evidence/runs/*) ;;
  */akari-timeline-bench/a-n*-run*) ;;
  *) print -u2 "refusing unsafe iso dir: $ISO"; exit 64 ;;
esac
if [ "$KEEP" != "keep" ]; then rm -rf "$ISO"; fi
mkdir -p "$ISO" "${LOG:h}"
THEIA_CONFIG_DIR="$ISO" nohup "$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$SHELL_DIR" "$PROJ" --remote-debugging-port="$PORT" --user-data-dir="$ISO" --no-sandbox \
  > "$LOG" 2>&1 &
echo $!
