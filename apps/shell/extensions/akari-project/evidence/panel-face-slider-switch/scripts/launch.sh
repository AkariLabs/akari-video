#!/bin/sh
# usage: launch.sh <apps/shell 絶対パス> <tag>  — 隔離 user-data / AKARI_HOME で Electron を CDP 9434 起動し PID を /tmp/pfss-l1/<tag>.pid へ
set -e
SHELL_DIR="$1"; TAG="$2"; ROOT=/tmp/pfss-l1
mkdir -p "$ROOT/$TAG/home" "$ROOT/$TAG/theia" "$ROOT/$TAG/ud"
[ -d "$ROOT/ws" ] || cp -R "$SHELL_DIR/../../templates/project-default" "$ROOT/ws"
[ -d "$ROOT/ws2" ] || cp -R "$SHELL_DIR/../../templates/project-default" "$ROOT/ws2"
AKARI_HOME="$ROOT/$TAG/home" THEIA_CONFIG_DIR="$ROOT/$TAG/theia" \
  "$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$SHELL_DIR" "$ROOT/ws" \
  --remote-debugging-port=${CDP_PORT:-9434} --user-data-dir="$ROOT/$TAG/ud" --no-sandbox --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling > "$ROOT/$TAG.log" 2>&1 &
echo $! > "$ROOT/$TAG.pid"; echo "pid $(cat $ROOT/$TAG.pid)"
