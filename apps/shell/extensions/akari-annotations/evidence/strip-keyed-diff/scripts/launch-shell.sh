#!/bin/zsh
# Copied in form from the internal repo's 2026-08-19 wave1 integrated-latency-verify evidence launch.sh; source is read-only.
# Usage: launch-shell.sh <projectDir> <cdpPort> <isoDir> <logFile> [keep]
set -eu
# このスクリプトの位置（<lab>/scripts/）から導く。ローカルの worktree 配置は書かない。
LAB_ROOT=${0:A:h:h}
SHELL_DIR=${AKARI_SHELL_DIR:-${LAB_ROOT:h:h:h:h}}
PROJ="$1"; PORT="$2"; ISO="$3"; LOG="$4"; KEEP="${5:-fresh}"
case "$ISO" in
  "$LAB_ROOT"/evidence/runs/*) ;;
  */akari-timeline-bench/a-n*-run*) ;;
  *) print -u2 "refusing unsafe iso dir: $ISO"; exit 64 ;;
esac
if [ "$KEEP" != "keep" ]; then rm -rf "$ISO"; fi
mkdir -p "$ISO" "${LOG:h}"
# ELECTRON_RUN_AS_NODE が環境（zsh 起動ファイル等）に残っていると Electron が Node として起動して CDP が立たない。
# 2026-09-02: 本機で再現（launch-shell が "Node.js v20" を吐いて target unavailable）。exec 直前で必ず外す。
THEIA_CONFIG_DIR="$ISO" nohup env -u ELECTRON_RUN_AS_NODE "$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$SHELL_DIR" "$PROJ" --remote-debugging-port="$PORT" --user-data-dir="$ISO" --no-sandbox \
  > "$LOG" 2>&1 &
echo $!
